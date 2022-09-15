/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


import { createContainerProperties, startEventSeen, ResolverResult, getTunnelInformation, getDockerfilePath, getDockerContextPath, DockerResolverParameters, isDockerFileConfig, uriToWSLFsPath, WorkspaceConfiguration, getFolderImageName, inspectDockerImage, ensureDockerfileHasFinalStageName, logUMask } from './utils';
import { ContainerProperties, setupInContainer, ResolverProgress } from '../spec-common/injectHeadless';
import { ContainerError, toErrorText } from '../spec-common/errors';
import { ContainerDetails, listContainers, DockerCLIParameters, inspectContainers, dockerCLI, dockerPtyCLI, toPtyExecParameters, ImageDetails, toExecParameters } from '../spec-shutdown/dockerUtils';
import { DevContainerConfig, DevContainerFromDockerfileConfig, DevContainerFromImageConfig } from '../spec-configuration/configuration';
import { LogLevel, Log, makeLog } from '../spec-utils/log';
import { extendImage, getExtendImageBuildInfo, updateRemoteUserUID } from './containerFeatures';
import { Mount } from '../spec-configuration/containerFeaturesConfiguration';
import { getDevcontainerMetadata, getImageBuildInfoFromDockerfile, ImageMetadataEntry } from './imageMetadata';

export const hostFolderLabel = 'devcontainer.local_folder'; // used to label containers created from a workspace/folder

export async function openDockerfileDevContainer(params: DockerResolverParameters, config: DevContainerFromDockerfileConfig | DevContainerFromImageConfig, workspaceConfig: WorkspaceConfiguration, idLabels: string[]): Promise<ResolverResult> {
	const { common } = params;
	// let collapsedFeaturesConfig: () => Promise<CollapsedFeaturesConfig | undefined>;

	let container: ContainerDetails | undefined;
	let containerProperties: ContainerProperties | undefined;

	try {
		container = await findExistingContainer(params, idLabels);
		if (container) {
			// let _collapsedFeatureConfig: Promise<CollapsedFeaturesConfig | undefined>;
			// collapsedFeaturesConfig = async () => {
			// 	return _collapsedFeatureConfig || (_collapsedFeatureConfig = (async () => {
			// 		const allLabels = container?.Config.Labels || {};
			// 		const featuresConfig = await generateFeaturesConfig(params.common, (await createFeaturesTempFolder(params.common)), config, async () => allLabels, getContainerFeaturesFolder);
			// 		return collapseFeaturesConfig(featuresConfig);
			// 	})());
			// };
			await startExistingContainer(params, idLabels, container);
		} else {
			const res = await buildNamedImageAndExtend(params, config);
			const updatedImageName = await updateRemoteUserUID(params, config, res.updatedImageName[0], res.imageDetails, findUserArg(config.runArgs) || config.containerUser);

			// collapsedFeaturesConfig = async () => res.collapsedFeaturesConfig;

			try {
				await spawnDevContainer(params, config, res.imageMetadata, updatedImageName, idLabels, workspaceConfig.workspaceMount, res.imageDetails);
			} finally {
				// In 'finally' because 'docker run' can fail after creating the container.
				// Trying to get it here, so we can offer 'Rebuild Container' as an action later.
				container = await findDevContainer(params, idLabels);
			}
			if (!container) {
				return bailOut(common.output, 'Dev container not found.');
			}
		}

		containerProperties = await createContainerProperties(params, container.Id, workspaceConfig.workspaceFolder, config.remoteUser);
		return await setupContainer(container, params, containerProperties, config);

	} catch (e) {
		throw createSetupError(e, container, params, containerProperties, config);
	}
}

function createSetupError(originalError: any, container: ContainerDetails | undefined, params: DockerResolverParameters, containerProperties: ContainerProperties | undefined, config: DevContainerConfig | undefined): ContainerError {
	const err = originalError instanceof ContainerError ? originalError : new ContainerError({
		description: 'An error occurred setting up the container.',
		originalError
	});
	if (container) {
		err.manageContainer = true;
		err.params = params.common;
		err.containerId = container.Id;
		err.dockerParams = params;
	}
	if (containerProperties) {
		err.containerProperties = containerProperties;
	}
	if (config) {
		err.config = config;
	}
	return err;
}

async function setupContainer(container: ContainerDetails, params: DockerResolverParameters, containerProperties: ContainerProperties, config: DevContainerFromDockerfileConfig | DevContainerFromImageConfig): Promise<ResolverResult> {
	const { common } = params;
	const {
		remoteEnv: extensionHostEnv,
	} = await setupInContainer(common, containerProperties, config);

	return {
		params: common,
		properties: containerProperties,
		config,
		resolvedAuthority: {
			extensionHostEnv,
		},
		tunnelInformation: common.isLocalContainer ? getTunnelInformation(container) : {},
		dockerParams: params,
		dockerContainerId: container.Id,
	};
}

function getDefaultName(config: DevContainerFromDockerfileConfig | DevContainerFromImageConfig, params: DockerResolverParameters) {
	return 'image' in config ? config.image : getFolderImageName(params.common);
}
export async function buildNamedImageAndExtend(params: DockerResolverParameters, config: DevContainerFromDockerfileConfig | DevContainerFromImageConfig, argImageNames?: string[]) {
	const imageNames = argImageNames ?? [getDefaultName(config, params)];
	params.common.progress(ResolverProgress.BuildingImage);
	if (isDockerFileConfig(config)) {
		return await buildAndExtendImage(params, config, imageNames, params.buildNoCache ?? false);
	}
	// image-based dev container - extend
	return await extendImage(params, config, imageNames[0]);
}

async function buildAndExtendImage(buildParams: DockerResolverParameters, config: DevContainerFromDockerfileConfig, baseImageNames: string[], noCache: boolean) {
	const { cliHost, output } = buildParams.common;
	const dockerfileUri = getDockerfilePath(cliHost, config);
	const dockerfilePath = await uriToWSLFsPath(dockerfileUri, cliHost);
	if (!cliHost.isFile(dockerfilePath)) {
		throw new ContainerError({ description: `Dockerfile (${dockerfilePath}) not found.` });
	}

	let dockerfile = (await cliHost.readFile(dockerfilePath)).toString();
	const originalDockerfile = dockerfile;
	let baseName = 'dev_container_auto_added_stage_label';
	if (config.build?.target) {
		// Explictly set build target for the dev container build features on that
		baseName = config.build.target;
	} else {
		// Use the last stage in the Dockerfile
		// Find the last line that starts with "FROM" (possibly preceeded by white-space)
		const { lastStageName, modifiedDockerfile } = ensureDockerfileHasFinalStageName(dockerfile, baseName);
		baseName = lastStageName;
		if (modifiedDockerfile) {
			dockerfile = modifiedDockerfile;
		}
	}

	const imageBuildInfo = await getImageBuildInfoFromDockerfile(buildParams, originalDockerfile, buildParams.common.experimentalImageMetadata);
	const extendImageBuildInfo = await getExtendImageBuildInfo(buildParams, config, baseName, imageBuildInfo);

	let finalDockerfilePath = dockerfilePath;
	const additionalBuildArgs: string[] = [];
	if (extendImageBuildInfo) {
		const { featureBuildInfo } = extendImageBuildInfo;
		// We add a '# syntax' line at the start, so strip out any existing line
		const syntaxMatch = dockerfile.match(/^\s*#\s*syntax\s*=.*[\r\n]/g);
		if (syntaxMatch) {
			dockerfile = dockerfile.slice(syntaxMatch[0].length);
		}
		let finalDockerfileContent = `${featureBuildInfo.dockerfilePrefixContent}${dockerfile}\n${featureBuildInfo.dockerfileContent}`;
		finalDockerfilePath = cliHost.path.join(featureBuildInfo?.dstFolder, 'Dockerfile-with-features');
		await cliHost.writeFile(finalDockerfilePath, Buffer.from(finalDockerfileContent));

		// track additional build args to include below
		for (const buildContext in featureBuildInfo.buildKitContexts) {
			additionalBuildArgs.push('--build-context', `${buildContext}=${featureBuildInfo.buildKitContexts[buildContext]}`);
		}
		for (const buildArg in featureBuildInfo.buildArgs) {
			additionalBuildArgs.push('--build-arg', `${buildArg}=${featureBuildInfo.buildArgs[buildArg]}`);
		}
	}

	const args: string[] = [];
	if (!buildParams.buildKitVersion &&
		(buildParams.buildxPlatform || buildParams.buildxPush)) {
		throw new ContainerError({ description: '--platform or --push require BuildKit enabled.', data: { fileWithError: dockerfilePath } });
	}
	if (buildParams.buildKitVersion) {
		args.push('buildx', 'build');
		if (buildParams.buildxPlatform) {
			args.push('--platform', buildParams.buildxPlatform);
		}
		if (buildParams.buildxPush) {
			args.push('--push');
		} else {
			args.push('--load'); // (short for --output=docker, i.e. load into normal 'docker images' collection)
		}
		args.push('--build-arg', 'BUILDKIT_INLINE_CACHE=1');
	} else {
		args.push('build');
	}
	args.push('-f', finalDockerfilePath);

	baseImageNames.map(imageName => args.push('-t', imageName));

	const target = extendImageBuildInfo ? extendImageBuildInfo.featureBuildInfo.overrideTarget : config.build?.target;
	if (target) {
		args.push('--target', target);
	}
	if (noCache) {
		args.push('--no-cache');
		// `docker build --pull` pulls local image: https://github.com/devcontainers/cli/issues/60
		if (buildParams.buildKitVersion || !extendImageBuildInfo) {
			args.push('--pull');
		}
	} else {
		const configCacheFrom = config.build?.cacheFrom;
		if (buildParams.additionalCacheFroms.length || (configCacheFrom && (configCacheFrom === 'string' || configCacheFrom.length))) {
			await logUMask(buildParams);
		}
		buildParams.additionalCacheFroms.forEach(cacheFrom => args.push('--cache-from', cacheFrom));
		if (config.build && config.build.cacheFrom) {
			if (typeof config.build.cacheFrom === 'string') {
				args.push('--cache-from', config.build.cacheFrom);
			} else {
				for (let index = 0; index < config.build.cacheFrom.length; index++) {
					const cacheFrom = config.build.cacheFrom[index];
					args.push('--cache-from', cacheFrom);
				}
			}
		}
	}
	const buildArgs = config.build?.args;
	if (buildArgs) {
		for (const key in buildArgs) {
			args.push('--build-arg', `${key}=${buildArgs[key]}`);
		}
	}
	args.push(...additionalBuildArgs);
	args.push(await uriToWSLFsPath(getDockerContextPath(cliHost, config), cliHost));
	try {
		if (buildParams.isTTY) {
			const infoParams = { ...toPtyExecParameters(buildParams), output: makeLog(output, LogLevel.Info) };
			await dockerPtyCLI(infoParams, ...args);
		} else {
			const infoParams = { ...toExecParameters(buildParams), output: makeLog(output, LogLevel.Info), print: 'continuous' as 'continuous' };
			await dockerCLI(infoParams, ...args);
		}
	} catch (err) {
		throw new ContainerError({ description: 'An error occurred building the image.', originalError: err, data: { fileWithError: dockerfilePath } });
	}

	const imageDetails = () => inspectDockerImage(buildParams, baseImageNames[0], false);

	return {
		updatedImageName: baseImageNames,
		imageMetadata: [
			...imageBuildInfo.metadata,
			...getDevcontainerMetadata(extendImageBuildInfo?.collapsedFeaturesConfig.allFeatures || []),
		],
		imageDetails
	};
}

export function findUserArg(runArgs: string[] = []) {
	for (let i = runArgs.length - 1; i >= 0; i--) {
		const runArg = runArgs[i];
		if ((runArg === '-u' || runArg === '--user') && i + 1 < runArgs.length) {
			return runArgs[i + 1];
		}
		if (runArg.startsWith('-u=') || runArg.startsWith('--user=')) {
			return runArg.substr(runArg.indexOf('=') + 1);
		}
	}
	return undefined;
}

export async function findExistingContainer(params: DockerResolverParameters, labels: string[]) {
	const { common } = params;
	let container = await findDevContainer(params, labels);
	if (params.expectExistingContainer && !container) {
		throw new ContainerError({ description: 'The expected container does not exist.' });
	}
	if (container && (params.removeOnStartup === true || params.removeOnStartup === container.Id)) {
		const text = 'Removing Existing Container';
		const start = common.output.start(text);
		await dockerCLI(params, 'rm', '-f', container.Id);
		common.output.stop(text, start);
		container = undefined;
	}
	return container;
}

async function startExistingContainer(params: DockerResolverParameters, labels: string[], container: ContainerDetails) {
	const { common } = params;
	const start = container.State.Status !== 'running';
	if (start) {
		const starting = 'Starting container';
		const start = common.output.start(starting);
		await dockerCLI(params, 'start', container.Id);
		common.output.stop(starting, start);
		let startedContainer = await findDevContainer(params, labels);
		if (!startedContainer) {
			bailOut(common.output, 'Dev container not found.');
		}
	}
	return start;
}

export async function findDevContainer(params: DockerCLIParameters | DockerResolverParameters, labels: string[]): Promise<ContainerDetails | undefined> {
	const ids = await listContainers(params, true, labels);
	const details = await inspectContainers(params, ids);
	return details.filter(container => container.State.Status !== 'removing')[0];
}


export async function spawnDevContainer(params: DockerResolverParameters, config: DevContainerFromDockerfileConfig | DevContainerFromImageConfig, imageMetadata: ImageMetadataEntry[], imageName: string, labels: string[], workspaceMount: string | undefined, imageDetails: (() => Promise<ImageDetails>) | undefined) {
	const { common } = params;
	common.progress(ResolverProgress.StartingContainer);

	const appPort = config.appPort;
	const exposedPorts = typeof appPort === 'number' || typeof appPort === 'string' ? [appPort] : appPort || [];
	const exposed = (<string[]>[]).concat(...exposedPorts.map(port => ['-p', typeof port === 'number' ? `127.0.0.1:${port}:${port}` : port]));

	const cwdMount = workspaceMount ? ['--mount', workspaceMount] : [];

	const mounts = config.mounts ? ([] as string[]).concat(...config.mounts.map(m => ['--mount', m])) : [];

	const envObj = config.containerEnv;
	const containerEnv = envObj ? Object.keys(envObj)
		.reduce((args, key) => {
			args.push('-e', `${key}=${envObj[key]}`);
			return args;
		}, [] as string[]) : [];

	const containerUser = config.containerUser ? ['-u', config.containerUser] : [];

	const featureArgs: string[] = [];
	if (imageMetadata.some(f => f.init)) {
		featureArgs.push('--init');
	}
	if (imageMetadata.some(f => f.privileged)) {
		featureArgs.push('--privileged');
	}
	const caps = new Set(([] as string[]).concat(...imageMetadata
		.map(f => f.capAdd || [])));
	for (const cap of caps) {
		featureArgs.push('--cap-add', cap);
	}
	const securityOpts = new Set(([] as string[]).concat(...imageMetadata
		.map(f => f.securityOpt || [])));
	for (const securityOpt of securityOpts) {
		featureArgs.push('--security-opt', securityOpt);
	}

	const featureMounts = ([] as string[]).concat(
		...([] as Mount[]).concat(
			...imageMetadata
				.map(f => f.mounts)
				.filter(Boolean) as Mount[][],
			params.additionalMounts,
		).map(m => ['--mount', `type=${m.type},src=${m.source},dst=${m.target}`])
	);

	const customEntrypoints = imageMetadata
		.map(f => f.entrypoint)
		.filter(Boolean) as string[];
	const entrypoint = ['--entrypoint', '/bin/sh'];
	const cmd = ['-c', `echo Container started
trap "exit 0" 15
${customEntrypoints.join('\n')}
exec "$@"
while sleep 1 & wait $!; do :; done`, '-']; // `wait $!` allows for the `trap` to run (synchronous `sleep` would not).
	if (config.overrideCommand === false && imageDetails) {
		const details = await imageDetails();
		cmd.push(...details.Config.Entrypoint || []);
		cmd.push(...details.Config.Cmd || []);
	}

	const args = [
		'run',
		'--sig-proxy=false',
		'-a', 'STDOUT',
		'-a', 'STDERR',
		...exposed,
		...cwdMount,
		...mounts,
		...featureMounts,
		...getLabels(labels),
		...containerEnv,
		...containerUser,
		...(config.runArgs || []),
		...featureArgs,
		...entrypoint,
		imageName,
		...cmd
	];

	let cancel: () => void;
	const canceled = new Promise<void>((_, reject) => cancel = reject);
	const { started } = await startEventSeen(params, getLabelsAsRecord(labels), canceled, common.output, common.getLogLevel() === LogLevel.Trace);

	const text = 'Starting container';
	const start = common.output.start(text);

	const infoParams = { ...toPtyExecParameters(params), output: makeLog(params.common.output, LogLevel.Info) };
	const result = dockerPtyCLI(infoParams, ...args);
	result.then(cancel!, cancel!);

	await started;
	common.output.stop(text, start);
}

function getLabels(labels: string[]): string[] {
	let result: string[] = [];
	labels.forEach(each => result.push('-l', each));
	return result;
}

function getLabelsAsRecord(labels: string[]): Record<string, string> {
	let result: Record<string, string> = {};
	labels.forEach(each => {
		let pair = each.split('=');
		result[pair[0]] = pair[1];
	});
	return result;
}

export function bailOut(output: Log, message: string): never {
	output.write(toErrorText(message));
	throw new Error(message);
}

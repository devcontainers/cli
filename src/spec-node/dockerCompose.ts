/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as yaml from 'js-yaml';
import * as shellQuote from 'shell-quote';

import { createContainerProperties, startEventSeen, ResolverResult, getTunnelInformation, DockerResolverParameters, inspectDockerImage, ensureDockerfileHasFinalStageName } from './utils';
import { ContainerProperties, setupInContainer, ResolverProgress } from '../spec-common/injectHeadless';
import { ContainerError } from '../spec-common/errors';
import { Workspace } from '../spec-utils/workspaces';
import { equalPaths, parseVersion, isEarlierVersion, CLIHost } from '../spec-common/commonUtils';
import { ContainerDetails, inspectContainer, listContainers, DockerCLIParameters, dockerCLI, dockerComposeCLI, dockerComposePtyCLI, PartialExecParameters, DockerComposeCLI, ImageDetails, toExecParameters, toPtyExecParameters } from '../spec-shutdown/dockerUtils';
import { DevContainerFromDockerComposeConfig, getDockerComposeFilePaths } from '../spec-configuration/configuration';
import { Log, LogLevel, makeLog, terminalEscapeSequences } from '../spec-utils/log';
import { getExtendImageBuildInfo, updateRemoteUserUID } from './containerFeatures';
import { Mount } from '../spec-configuration/containerFeaturesConfiguration';
import path from 'path';
import { getDevcontainerMetadata, getImageBuildInfoFromDockerfile, ImageMetadataEntry } from './imageMetadata';

const projectLabel = 'com.docker.compose.project';
const serviceLabel = 'com.docker.compose.service';

export async function openDockerComposeDevContainer(params: DockerResolverParameters, workspace: Workspace, config: DevContainerFromDockerComposeConfig, idLabels: string[]): Promise<ResolverResult> {
	const { common, dockerCLI, dockerComposeCLI } = params;
	const { cliHost, env, output } = common;
	const buildParams: DockerCLIParameters = { cliHost, dockerCLI, dockerComposeCLI, env, output };
	return _openDockerComposeDevContainer(params, buildParams, workspace, config, getRemoteWorkspaceFolder(config), idLabels);
}

async function _openDockerComposeDevContainer(params: DockerResolverParameters, buildParams: DockerCLIParameters, workspace: Workspace, config: DevContainerFromDockerComposeConfig, remoteWorkspaceFolder: string, idLabels: string[]): Promise<ResolverResult> {
	const { common } = params;
	const { cliHost: buildCLIHost } = buildParams;

	let container: ContainerDetails | undefined;
	let containerProperties: ContainerProperties | undefined;
	try {

		const composeFiles = await getDockerComposeFilePaths(buildCLIHost, config, buildCLIHost.env, buildCLIHost.cwd);
		const cwdEnvFile = buildCLIHost.path.join(buildCLIHost.cwd, '.env');
		const envFile = Array.isArray(config.dockerComposeFile) && config.dockerComposeFile.length === 0 && await buildCLIHost.isFile(cwdEnvFile) ? cwdEnvFile : undefined;
		const projectName = await getProjectName(buildParams, workspace, composeFiles);
		const containerId = await findComposeContainer(params, projectName, config.service);
		if (params.expectExistingContainer && !containerId) {
			throw new ContainerError({ description: 'The expected container does not exist.' });
		}
		container = containerId ? await inspectContainer(params, containerId) : undefined;

		if (container && (params.removeOnStartup === true || params.removeOnStartup === container.Id)) {
			const text = 'Removing existing container.';
			const start = common.output.start(text);
			await dockerCLI(params, 'rm', '-f', container.Id);
			common.output.stop(text, start);
			container = undefined;
		}

		// let collapsedFeaturesConfig: CollapsedFeaturesConfig | undefined;
		if (!container || container.State.Status !== 'running') {
			const res = await startContainer(params, buildParams, config, projectName, composeFiles, envFile, container, idLabels);
			container = await inspectContainer(params, res.containerId);
			// 	collapsedFeaturesConfig = res.collapsedFeaturesConfig;
			// } else {
			// 	const labels = container.Config.Labels || {};
			// 	const featuresConfig = await generateFeaturesConfig(params.common, (await createFeaturesTempFolder(params.common)), config, async () => labels, getContainerFeaturesFolder);
			// 	collapsedFeaturesConfig = collapseFeaturesConfig(featuresConfig);
		}

		containerProperties = await createContainerProperties(params, container.Id, remoteWorkspaceFolder, config.remoteUser);

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
			composeProjectName: projectName,
		};

	} catch (originalError) {
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
		err.config = config;
		throw err;
	}
}

export function getRemoteWorkspaceFolder(config: DevContainerFromDockerComposeConfig) {
	return config.workspaceFolder || '/';
}

// exported for testing
export function getBuildInfoForService(composeService: any, cliHostPath: typeof path, localComposeFiles: string[]) {
	// composeService should taken from readDockerComposeConfig
	// the 'build' property can be a string or an object (https://docs.docker.com/compose/compose-file/build/#build-definition)

	const image = composeService.image as string | undefined;
	const composeBuild = composeService.build;
	if (!composeBuild) {
		return {
			image
		};
	}
	if (typeof (composeBuild) === 'string') {
		return {
			image,
			build: {
				context: composeBuild,
				dockerfilePath: 'Dockerfile'
			}
		};
	}
	return {
		image,
		build: {
			dockerfilePath: (composeBuild.dockerfile as string | undefined) ?? 'Dockerfile',
			context: (composeBuild.context as string | undefined) ?? cliHostPath.dirname(localComposeFiles[0]),
			target: composeBuild.target as string | undefined,
		}
	};
}

export async function buildAndExtendDockerCompose(config: DevContainerFromDockerComposeConfig, projectName: string, params: DockerResolverParameters, localComposeFiles: string[], envFile: string | undefined, composeGlobalArgs: string[], runServices: string[], noCache: boolean, overrideFilePath: string, overrideFilePrefix: string, additionalCacheFroms?: string[], noBuild?: boolean) {

	const { common, dockerCLI, dockerComposeCLI: dockerComposeCLIFunc } = params;
	const { cliHost, env, output } = common;

	const cliParams: DockerCLIParameters = { cliHost, dockerCLI, dockerComposeCLI: dockerComposeCLIFunc, env, output };
	const composeConfig = await readDockerComposeConfig(cliParams, localComposeFiles, envFile);
	const composeService = composeConfig.services[config.service];

	// determine base imageName for generated features build stage(s)
	let baseName = 'dev_container_auto_added_stage_label';
	let dockerfile: string;
	let originalDockerfile: string;
	const serviceInfo = getBuildInfoForService(composeService, cliHost.path, localComposeFiles);
	if (serviceInfo.build) {
		const { context, dockerfilePath, target } = serviceInfo.build;
		const resolvedDockerfilePath = cliHost.path.isAbsolute(dockerfilePath) ? dockerfilePath : path.resolve(context, dockerfilePath);
		dockerfile = originalDockerfile = (await cliHost.readFile(resolvedDockerfilePath)).toString();
		if (target) {
			// Explictly set build target for the dev container build features on that
			baseName = target;
		} else {
			// Use the last stage in the Dockerfile
			// Find the last line that starts with "FROM" (possibly preceeded by white-space)
			const { lastStageName, modifiedDockerfile } = ensureDockerfileHasFinalStageName(dockerfile, baseName);
			baseName = lastStageName;
			if (modifiedDockerfile) {
				dockerfile = modifiedDockerfile;
			}
		}
	} else {
		dockerfile = originalDockerfile = `FROM ${composeService.image} AS ${baseName}\n`;
	}

	// determine whether we need to extend with features
	const noBuildKitParams = { ...params, buildKitVersion: null }; // skip BuildKit -> can't set additional build contexts with compose
	const imageBuildInfo = await getImageBuildInfoFromDockerfile(params, originalDockerfile, common.experimentalImageMetadata);
	const extendImageBuildInfo = await getExtendImageBuildInfo(noBuildKitParams, config, baseName, imageBuildInfo);

	let buildOverrideContent = null;
	if (extendImageBuildInfo) {
		// Create overridden Dockerfile and generate docker-compose build override content
		buildOverrideContent = '    build:\n';
		const { featureBuildInfo } = extendImageBuildInfo;
		// We add a '# syntax' line at the start, so strip out any existing line
		const syntaxMatch = dockerfile.match(/^\s*#\s*syntax\s*=.*[\r\n]/g);
		if (syntaxMatch) {
			dockerfile = dockerfile.slice(syntaxMatch[0].length);
		}
		let finalDockerfileContent = `${featureBuildInfo.dockerfilePrefixContent}${dockerfile}\n${featureBuildInfo.dockerfileContent}`;
		const finalDockerfilePath = cliHost.path.join(featureBuildInfo?.dstFolder, 'Dockerfile-with-features');
		await cliHost.writeFile(finalDockerfilePath, Buffer.from(finalDockerfileContent));
		buildOverrideContent += `      dockerfile: ${finalDockerfilePath}\n`;
		// remove the target setting as we reference any previous target in the generated override content
		buildOverrideContent += `      target: ${featureBuildInfo.overrideTarget}\n`;

		if (!serviceInfo.build?.context) {
			// need to supply a context as we don't have one inherited
			const emptyDir = cliHost.path.join(await cliHost.tmpdir(), '__devcontainers_cli_empty__');
			await cliHost.mkdirp(emptyDir);
			buildOverrideContent += `      context: ${emptyDir}\n`;
		}
		// track additional build args to include
		if (Object.keys(featureBuildInfo.buildArgs).length > 0 || params.buildKitVersion) {
			buildOverrideContent += '      args:\n';
			if (params.buildKitVersion) {
				buildOverrideContent += '        - BUILDKIT_INLINE_CACHE=1\n';
			}
			for (const buildArg in featureBuildInfo.buildArgs) {
				buildOverrideContent += `        - ${buildArg}=${featureBuildInfo.buildArgs[buildArg]}\n`;
			}
		}
	}

	// Generate the docker-compose override and build
	const args = ['--project-name', projectName, ...composeGlobalArgs];
	const additionalComposeOverrideFiles: string[] = [];
	if (additionalCacheFroms && additionalCacheFroms.length > 0 || buildOverrideContent) {
		const composeFolder = cliHost.path.join(overrideFilePath, 'docker-compose');
		await cliHost.mkdirp(composeFolder);
		const composeOverrideFile = cliHost.path.join(composeFolder, `${overrideFilePrefix}-${Date.now()}.yml`);
		const cacheFromOverrideContent = (additionalCacheFroms && additionalCacheFroms.length > 0) ? `      cache_from:\n${additionalCacheFroms.map(cacheFrom => `        - ${cacheFrom}\n`).join('\n')}` : '';
		const composeOverrideContent = `services:
  ${config.service}:
${buildOverrideContent?.trimEnd()}
${cacheFromOverrideContent}
`;
		await cliHost.writeFile(composeOverrideFile, Buffer.from(composeOverrideContent));
		additionalComposeOverrideFiles.push(composeOverrideFile);
		args.push('-f', composeOverrideFile);
	}

	if (!noBuild) {
		args.push('build');
		if (noCache) {
			args.push('--no-cache');
			// `docker build --pull` pulls local image: https://github.com/devcontainers/cli/issues/60
			if (!extendImageBuildInfo) {
				args.push('--pull');
			}
		}
		if (runServices.length) {
			args.push(...runServices);
			if (runServices.indexOf(config.service) === -1) {
				args.push(config.service);
			}
		}
		try {
			if (params.isTTY) {
				const infoParams = { ...toPtyExecParameters(params, await dockerComposeCLIFunc()), output: makeLog(output, LogLevel.Info) };
				await dockerComposePtyCLI(infoParams, ...args);
			} else {
				const infoParams = { ...toExecParameters(params, await dockerComposeCLIFunc()), output: makeLog(output, LogLevel.Info), print: 'continuous' as 'continuous' };
				await dockerComposeCLI(infoParams, ...args);
			}
		} catch (err) {
			throw err instanceof ContainerError ? err : new ContainerError({ description: 'An error occurred building the Docker Compose images.', originalError: err, data: { fileWithError: localComposeFiles[0] } });
		}
	}

	return {
		imageMetadata: [
			...imageBuildInfo.metadata,
			...getDevcontainerMetadata(extendImageBuildInfo?.collapsedFeaturesConfig.allFeatures || []),
		],
		additionalComposeOverrideFiles,
	};
}

async function checkForPersistedFile(cliHost: CLIHost, output: Log, files: string[], prefix: string) {
	const file = files.find((f) => f.indexOf(prefix) > -1);
	if (file) {
		const composeFileExists = await cliHost.isFile(file);

		if (composeFileExists) {
			output.write(`Restoring ${file} from persisted storage`);
			return {
				foundLabel: true,
				fileExists: true,
				file
			};
		} else {
			output.write(`Expected ${file} to exist, but it did not`, LogLevel.Error);
			return {
				foundLabel: true,
				fileExists: false,
				file
			};
		}
	} else {
		output.write(`Expected to find a docker-compose file prefixed with ${prefix}, but did not.`, LogLevel.Error);
	}
	return {
		foundLabel: false
	};
}
async function startContainer(params: DockerResolverParameters, buildParams: DockerCLIParameters, config: DevContainerFromDockerComposeConfig, projectName: string, composeFiles: string[], envFile: string | undefined, container: ContainerDetails | undefined, idLabels: string[]) {
	const { common } = params;
	const { persistedFolder, output } = common;
	const { cliHost: buildCLIHost } = buildParams;
	const featuresBuildOverrideFilePrefix = 'docker-compose.devcontainer.build';
	const featuresStartOverrideFilePrefix = 'docker-compose.devcontainer.containerFeatures';

	common.progress(ResolverProgress.StartingContainer);

	const localComposeFiles = composeFiles;
	// If dockerComposeFile is an array, add -f <file> in order. https://docs.docker.com/compose/extends/#multiple-compose-files
	const composeGlobalArgs = ([] as string[]).concat(...localComposeFiles.map(composeFile => ['-f', composeFile]));
	if (envFile) {
		composeGlobalArgs.push('--env-file', envFile);
	}

	const infoOutput = makeLog(buildParams.output, LogLevel.Info);
	const composeConfig = await readDockerComposeConfig(buildParams, localComposeFiles, envFile);
	const services = Object.keys(composeConfig.services || {});
	if (services.indexOf(config.service) === -1) {
		throw new ContainerError({ description: `Service '${config.service}' configured in devcontainer.json not found in Docker Compose configuration.`, data: { fileWithError: composeFiles[0] } });
	}

	let cancel: () => void;
	const canceled = new Promise<void>((_, reject) => cancel = reject);
	const { started } = await startEventSeen(params, { [projectLabel]: projectName, [serviceLabel]: config.service }, canceled, common.output, common.getLogLevel() === LogLevel.Trace); // await getEvents, but only assign started.

	const service = composeConfig.services[config.service];
	const originalImageName = service.image || getDefaultImageName(await buildParams.dockerComposeCLI(), projectName, config.service);

	// Try to restore the 'third' docker-compose file and featuresConfig from persisted storage.
	// This file may have been generated upon a Codespace creation.
	const labels = container?.Config?.Labels;
	output.write(`PersistedPath=${persistedFolder}, ContainerHasLabels=${!!labels}`);

	let didRestoreFromPersistedShare = false;
	if (container) {
		if (labels) {
			// update args for `docker-compose up` to use cached overrides
			const configFiles = labels['com.docker.compose.project.config_files'];
			output.write(`Container was created with these config files: ${configFiles}`);

			// Parse out the full name of the 'containerFeatures' configFile
			const files = configFiles?.split(',') ?? [];
			const persistedBuildFile = await checkForPersistedFile(buildCLIHost, output, files, featuresBuildOverrideFilePrefix);
			const persistedStartFile = await checkForPersistedFile(buildCLIHost, output, files, featuresStartOverrideFilePrefix);
			if ((persistedBuildFile.fileExists || !persistedBuildFile.foundLabel) // require build file if in label
				&& persistedStartFile.fileExists // always require start file
			) {
				didRestoreFromPersistedShare = true;
				if (persistedBuildFile.fileExists) {
					composeGlobalArgs.push('-f', persistedBuildFile.file);
				}
				if (persistedStartFile.fileExists) {
					composeGlobalArgs.push('-f', persistedStartFile.file);
				}
			}
		}
	}

	if (!container || !didRestoreFromPersistedShare) {
		const noBuild = !!container; //if we have an existing container, just recreate override files but skip the build

		const infoParams = { ...params, common: { ...params.common, output: infoOutput } };
		const { imageMetadata, additionalComposeOverrideFiles } = await buildAndExtendDockerCompose(config, projectName, infoParams, localComposeFiles, envFile, composeGlobalArgs, config.runServices ?? [], params.buildNoCache ?? false, persistedFolder, featuresBuildOverrideFilePrefix, params.additionalCacheFroms, noBuild);
		additionalComposeOverrideFiles.forEach(overrideFilePath => composeGlobalArgs.push('-f', overrideFilePath));

		let cache: Promise<ImageDetails> | undefined;
		const imageDetails = () => cache || (cache = inspectDockerImage(params, originalImageName, true));
		const updatedImageName = noBuild ? originalImageName : await updateRemoteUserUID(params, config, originalImageName, imageDetails, service.user);

		// Save override docker-compose file to disk.
		// Persisted folder is a path that will be maintained between sessions
		// Note: As a fallback, persistedFolder is set to the build's tmpDir() directory
		const overrideFilePath = await writeFeaturesComposeOverrideFile(updatedImageName, originalImageName, imageMetadata, config, buildParams, composeFiles, imageDetails, service, idLabels, params.additionalMounts, persistedFolder, featuresStartOverrideFilePrefix, buildCLIHost, output);
		if (overrideFilePath) {
			// Add file path to override file as parameter
			composeGlobalArgs.push('-f', overrideFilePath);
		}
	}

	const args = ['--project-name', projectName, ...composeGlobalArgs];
	args.push('up', '-d');
	if (container || params.expectExistingContainer) {
		args.push('--no-recreate');
	}
	if (config.runServices && config.runServices.length) {
		args.push(...config.runServices);
		if (config.runServices.indexOf(config.service) === -1) {
			args.push(config.service);
		}
	}
	try {
		if (params.isTTY) {
			await dockerComposePtyCLI({ ...buildParams, output: infoOutput }, ...args);
		} else {
			await dockerComposeCLI({ ...buildParams, output: infoOutput }, ...args);
		}
	} catch (err) {
		cancel!();
		throw new ContainerError({ description: 'An error occurred starting Docker Compose up.', originalError: err, data: { fileWithError: localComposeFiles[0] } });
	}

	await started;
	return {
		containerId: (await findComposeContainer(params, projectName, config.service))!,
	};
}

export function getDefaultImageName(dockerComposeCLI: DockerComposeCLI, projectName: string, serviceName: string) {
	const version = parseVersion(dockerComposeCLI.version);
	const separator = version && isEarlierVersion(version, [2, 8, 0]) ? '_' : '-';
	return `${projectName}${separator}${serviceName}`;
}

async function writeFeaturesComposeOverrideFile(
	updatedImageName: string,
	originalImageName: string,
	imageMetadata: ImageMetadataEntry[],
	config: DevContainerFromDockerComposeConfig,
	buildParams: DockerCLIParameters,
	composeFiles: string[],
	imageDetails: () => Promise<ImageDetails>,
	service: any,
	additionalLabels: string[],
	additionalMounts: Mount[],
	overrideFilePath: string,
	overrideFilePrefix: string,
	buildCLIHost: CLIHost,
	output: Log,
) {
	const composeOverrideContent = await generateFeaturesComposeOverrideContent(updatedImageName, originalImageName, imageMetadata, config, buildParams, composeFiles, imageDetails, service, additionalLabels, additionalMounts);
	const overrideFileHasContents = !!composeOverrideContent && composeOverrideContent.length > 0 && composeOverrideContent.trim() !== '';
	if (overrideFileHasContents) {
		output.write(`Docker Compose override file:\n${composeOverrideContent}`, LogLevel.Trace);

		const fileName = `${overrideFilePrefix}-${Date.now()}.yml`;
		const composeFolder = buildCLIHost.path.join(overrideFilePath, 'docker-compose');
		const composeOverrideFile = buildCLIHost.path.join(composeFolder, fileName);
		output.write(`Writing ${fileName} to ${composeFolder}`);
		await buildCLIHost.mkdirp(composeFolder);
		await buildCLIHost.writeFile(composeOverrideFile, Buffer.from(composeOverrideContent));

		return composeOverrideFile;
	} else {
		output.write('Override file was generated, but was empty and thus not persisted or included in the docker-compose arguments.');
		return undefined;
	}
}

async function generateFeaturesComposeOverrideContent(
	updatedImageName: string,
	originalImageName: string,
	imageMetadata: ImageMetadataEntry[],
	config: DevContainerFromDockerComposeConfig,
	buildParams: DockerCLIParameters,
	composeFiles: string[],
	imageDetails: () => Promise<ImageDetails>,
	service: any,
	additionalLabels: string[],
	additionalMounts: Mount[],
) {

	const { cliHost: buildCLIHost } = buildParams;
	let composeOverrideContent: string = '';

	const overrideImage = updatedImageName !== originalImageName;

	const featureCaps = [...new Set(([] as string[]).concat(...imageMetadata
		.map(f => f.capAdd || [])))];
	const featureSecurityOpts = [...new Set(([] as string[]).concat(...imageMetadata
		.map(f => f.securityOpt || [])))];
	const featureMounts = ([] as Mount[]).concat(
		...imageMetadata
			.map(f => f.mounts)
			.filter(Boolean) as Mount[][],
		additionalMounts,
	);
	const volumeMounts = featureMounts.filter(m => m.type === 'volume');
	const customEntrypoints = imageMetadata
		.map(f => f.entrypoint)
		.filter(Boolean) as string[];
	const composeEntrypoint: string[] | undefined = typeof service.entrypoint === 'string' ? shellQuote.parse(service.entrypoint) : service.entrypoint;
	const composeCommand: string[] | undefined = typeof service.command === 'string' ? shellQuote.parse(service.command) : service.command;
	const userEntrypoint = config.overrideCommand ? [] : composeEntrypoint /* $ already escaped. */
		|| ((await imageDetails()).Config.Entrypoint || []).map(c => c.replace(/\$/g, '$$$$')); // $ > $$ to escape docker-compose.yml's interpolation.
	const userCommand = config.overrideCommand ? [] : composeCommand /* $ already escaped. */
		|| (composeEntrypoint ? [/* Ignore image CMD per docker-compose.yml spec. */] : ((await imageDetails()).Config.Cmd || []).map(c => c.replace(/\$/g, '$$$$'))); // $ > $$ to escape docker-compose.yml's interpolation.

	composeOverrideContent = `services:
  '${config.service}':${overrideImage ? `
    image: ${updatedImageName}` : ''}
    entrypoint: ["/bin/sh", "-c", "echo Container started\\n
trap \\"exit 0\\" 15\\n
${customEntrypoints.join('\\n\n')}\\n
exec \\"$$@\\"\\n
while sleep 1 & wait $$!; do :; done", "-"${userEntrypoint.map(a => `, ${JSON.stringify(a)}`).join('')}]${userCommand !== composeCommand ? `
    command: ${JSON.stringify(userCommand)}` : ''}${imageMetadata.some(f => f.init) ? `
    init: true` : ''}${imageMetadata.some(f => f.privileged) ? `
    privileged: true` : ''}${featureCaps.length ? `
    cap_add:${featureCaps.map(cap => `
      - ${cap}`).join('')}` : ''}${featureSecurityOpts.length ? `
    security_opt:${featureSecurityOpts.map(securityOpt => `
      - ${securityOpt}`).join('')}` : ''}${additionalLabels.length ? `
    labels:${additionalLabels.map(label => `
      - ${label.replace(/\$/g, '$$$$')}`).join('')}` : ''}${featureMounts.length ? `
    volumes:${featureMounts.map(m => `
      - ${m.source}:${m.target}`).join('')}` : ''}${volumeMounts.length ? `
volumes:${volumeMounts.map(m => `
  ${m.source}:${m.external ? '\n    external: true' : ''}`).join('')}` : ''}
`;
	const firstComposeFile = (await buildCLIHost.readFile(composeFiles[0])).toString();
	const version = (/^\s*(version:.*)$/m.exec(firstComposeFile) || [])[1];
	if (version) {
		composeOverrideContent = `${version}

${composeOverrideContent}`;
	}
	return composeOverrideContent;
}

export async function readDockerComposeConfig(params: DockerCLIParameters, composeFiles: string[], envFile: string | undefined) {
	try {
		const composeGlobalArgs = ([] as string[]).concat(...composeFiles.map(composeFile => ['-f', composeFile]));
		if (envFile) {
			composeGlobalArgs.push('--env-file', envFile);
		}
		const composeCLI = await params.dockerComposeCLI();
		if ((parseVersion(composeCLI.version) || [])[0] >= 2) {
			composeGlobalArgs.push('--profile', '*');
		}
		try {
			const partial = toExecParameters(params, 'dockerComposeCLI' in params ? await params.dockerComposeCLI() : undefined);
			const { stdout } = await dockerComposeCLI({ ...partial, print: 'onerror' }, ...composeGlobalArgs, 'config');
			const stdoutStr = stdout.toString();
			params.output.write(stdoutStr);
			return yaml.load(stdoutStr) || {} as any;
		} catch (err) {
			if (!Buffer.isBuffer(err?.stderr) || err?.stderr.toString().indexOf('UnicodeEncodeError') === -1) {
				throw err;
			}
			// Upstream issues. https://github.com/microsoft/vscode-remote-release/issues/5308
			if (params.cliHost.platform === 'win32') {
				const { cmdOutput } = await dockerComposePtyCLI({
					...params,
					output: makeLog({
						event: params.output.event,
						dimensions: {
							columns: 999999,
							rows: 1,
						},
					}, LogLevel.Info),
				}, ...composeGlobalArgs, 'config');
				return yaml.load(cmdOutput.replace(terminalEscapeSequences, '')) || {} as any;
			}
			const { stdout } = await dockerComposeCLI({
				...params,
				env: {
					...params.env,
					LANG: 'en_US.UTF-8',
					LC_CTYPE: 'en_US.UTF-8',
				}
			}, ...composeGlobalArgs, 'config');
			const stdoutStr = stdout.toString();
			params.output.write(stdoutStr);
			return yaml.load(stdoutStr) || {} as any;
		}
	} catch (err) {
		throw err instanceof ContainerError ? err : new ContainerError({ description: 'An error occurred retrieving the Docker Compose configuration.', originalError: err, data: { fileWithError: composeFiles[0] } });
	}
}

export async function findComposeContainer(params: DockerCLIParameters | DockerResolverParameters, projectName: string, serviceName: string): Promise<string | undefined> {
	const list = await listContainers(params, true, [
		`${projectLabel}=${projectName}`,
		`${serviceLabel}=${serviceName}`
	]);
	return list && list[0];
}

export async function getProjectName(params: DockerCLIParameters | DockerResolverParameters, workspace: Workspace, composeFiles: string[]) {
	const { cliHost } = 'cliHost' in params ? params : params.common;
	const newProjectName = await useNewProjectName(params);
	const envName = toProjectName(cliHost.env.COMPOSE_PROJECT_NAME || '', newProjectName);
	if (envName) {
		return envName;
	}
	try {
		const envPath = cliHost.path.join(cliHost.cwd, '.env');
		const buffer = await cliHost.readFile(envPath);
		const match = /^COMPOSE_PROJECT_NAME=(.+)$/m.exec(buffer.toString());
		const value = match && match[1].trim();
		const envFileName = toProjectName(value || '', newProjectName);
		if (envFileName) {
			return envFileName;
		}
	} catch (err) {
		if (!(err && (err.code === 'ENOENT' || err.code === 'EISDIR'))) {
			throw err;
		}
	}
	const configDir = workspace.configFolderPath;
	const workingDir = composeFiles[0] ? cliHost.path.dirname(composeFiles[0]) : cliHost.cwd; // From https://github.com/docker/compose/blob/79557e3d3ab67c3697641d9af91866d7e400cfeb/compose/config/config.py#L290
	if (equalPaths(cliHost.platform, workingDir, cliHost.path.join(configDir, '.devcontainer'))) {
		return toProjectName(`${cliHost.path.basename(configDir)}_devcontainer`, newProjectName);
	}
	return toProjectName(cliHost.path.basename(workingDir), newProjectName);
}

function toProjectName(basename: string, newProjectName: boolean) {
	// From https://github.com/docker/compose/blob/79557e3d3ab67c3697641d9af91866d7e400cfeb/compose/cli/command.py#L152
	if (!newProjectName) {
		return basename.toLowerCase().replace(/[^a-z0-9]/g, '');
	}
	return basename.toLowerCase().replace(/[^-_a-z0-9]/g, '');
}

async function useNewProjectName(params: DockerCLIParameters | DockerResolverParameters) {
	try {
		const version = parseVersion((await params.dockerComposeCLI()).version);
		if (!version) {
			return true; // Optimistically continue.
		}
		return !isEarlierVersion(version, [1, 21, 0]); // 1.21.0 changed allowed characters in project names (added hyphen and underscore).
	} catch (err) {
		return true; // Optimistically continue.
	}
}

export function dockerComposeCLIConfig(params: Omit<PartialExecParameters, 'cmd'>, dockerCLICmd: string, dockerComposeCLICmd: string) {
	let result: Promise<DockerComposeCLI>;
	return () => {
		return result || (result = (async () => {
			let v2 = false;
			let stdout: Buffer;
			try {
				stdout = (await dockerComposeCLI({
					...params,
					cmd: dockerComposeCLICmd,
				}, 'version', '--short')).stdout;
			} catch (err) {
				if (err?.code !== 'ENOENT') {
					throw err;
				}
				stdout = (await dockerComposeCLI({
					...params,
					cmd: dockerCLICmd,
				}, 'compose', 'version', '--short')).stdout;
				v2 = true;
			}
			const version = stdout.toString().trim();
			params.output.write(`Docker Compose version: ${version}`);
			return {
				version,
				cmd: v2 ? dockerCLICmd : dockerComposeCLICmd,
				args: v2 ? ['compose'] : [],
			};
		})());
	};
}

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';
import { StringDecoder } from 'string_decoder';
import * as tar from 'tar';

import { DevContainerConfig } from '../spec-configuration/configuration';
import { dockerCLI, dockerPtyCLI, ImageDetails, toExecParameters, toPtyExecParameters } from '../spec-shutdown/dockerUtils';
import { LogLevel, makeLog, toErrorText } from '../spec-utils/log';
import { FeaturesConfig, getContainerFeaturesFolder, getContainerFeaturesBaseDockerFile, getFeatureLayers, getFeatureMainValue, getFeatureValueObject, generateFeaturesConfig, getSourceInfoString, collapseFeaturesConfig, Feature, multiStageBuildExploration, V1_DEVCONTAINER_FEATURES_FILE_NAME } from '../spec-configuration/containerFeaturesConfiguration';
import { readLocalFile } from '../spec-utils/pfs';
import { includeAllConfiguredFeatures } from '../spec-utils/product';
import { createFeaturesTempFolder, DockerResolverParameters, getCacheFolder, getFolderImageName } from './utils';
import { isEarlierVersion, parseVersion } from '../spec-common/commonUtils';
import { getDevcontainerMetadata, getDevcontainerMetadataLabel, getImageBuildInfoFromImage, ImageBuildInfo } from './imageMetadata';

// Escapes environment variable keys.
//
// Environment variables must contain:
//      - alpha-numeric values, or
//      - the '_' character, and
//      - a number cannot be the first character 
export const getSafeId = (str: string) => str
	.replace(/[^\w_]/g, '_')
	.replace(/^[\d_]+/g, '_')
	.toUpperCase();

export async function extendImage(params: DockerResolverParameters, config: DevContainerConfig, imageName: string) {
	const { common } = params;
	const { cliHost, output } = common;

	const imageBuildInfo = await getImageBuildInfoFromImage(params, imageName, common.experimentalImageMetadata);
	const extendImageDetails = await getExtendImageBuildInfo(params, config, imageName, imageBuildInfo);
	if (!extendImageDetails || !extendImageDetails.featureBuildInfo) {
		// no feature extensions - return
		return {
			updatedImageName: [imageName],
			imageMetadata: imageBuildInfo.metadata,
			imageDetails: async () => imageBuildInfo.imageDetails,
		};
	}
	const { featureBuildInfo, collapsedFeaturesConfig } = extendImageDetails;

	// Got feature extensions -> build the image
	const dockerfilePath = cliHost.path.join(featureBuildInfo.dstFolder, 'Dockerfile.extended');
	await cliHost.writeFile(dockerfilePath, Buffer.from(featureBuildInfo.dockerfilePrefixContent + featureBuildInfo.dockerfileContent));
	const folderImageName = getFolderImageName(common);
	const updatedImageName = `${imageName.startsWith(folderImageName) ? imageName : folderImageName}-features`;

	const args: string[] = [];
	if (params.buildKitVersion) {
		args.push(
			'buildx', 'build',
			'--load', // (short for --output=docker, i.e. load into normal 'docker images' collection)
		);
		for (const buildContext in featureBuildInfo.buildKitContexts) {
			args.push('--build-context', `${buildContext}=${featureBuildInfo.buildKitContexts[buildContext]}`);
		}
	} else {
		args.push(
			'build',
		);
	}
	for (const buildArg in featureBuildInfo.buildArgs) {
		args.push('--build-arg', `${buildArg}=${featureBuildInfo.buildArgs[buildArg]}`);
	}
	// Once this is step merged with the user Dockerfile (or working against the base image),
	// the path will be the dev container context
	// Set empty dir under temp path as the context for now to ensure we don't have dependencies on the features content
	const emptyTempDir = cliHost.path.join(await cliHost.tmpdir(), '__dev-containers-build-empty');
	cliHost.mkdirp(emptyTempDir);
	args.push(
		'--target', featureBuildInfo.overrideTarget,
		'-t', updatedImageName,
		'-f', dockerfilePath,
		emptyTempDir
	);

	if (params.isTTY) {
		const infoParams = { ...toPtyExecParameters(params), output: makeLog(output, LogLevel.Info) };
		await dockerPtyCLI(infoParams, ...args);
	} else {
		const infoParams = { ...toExecParameters(params), output: makeLog(output, LogLevel.Info), print: 'continuous' as 'continuous' };
		await dockerCLI(infoParams, ...args);
	}
	return {
		updatedImageName: [ updatedImageName ],
		imageMetadata: [
			...imageBuildInfo.metadata,
			...getDevcontainerMetadata(collapsedFeaturesConfig.allFeatures),
		],
		imageDetails: async () => imageBuildInfo.imageDetails,
	};
}

export async function getExtendImageBuildInfo(params: DockerResolverParameters, config: DevContainerConfig, baseName: string, imageBuildInfo: ImageBuildInfo) {

	// Creates the folder where the working files will be setup.
	const tempFolder = await createFeaturesTempFolder(params.common);

	// Extracts the local cache of features.
	await createLocalFeatures(params, tempFolder);

	// Processes the user's configuration.
	const featuresConfig = await generateFeaturesConfig(params.common, tempFolder, config, getContainerFeaturesFolder);
	if (!featuresConfig) {
		return null;
	}

	// Generates the end configuration.
	const collapsedFeaturesConfig = collapseFeaturesConfig(featuresConfig);
	const featureBuildInfo = await getContainerFeaturesBuildInfo(params, featuresConfig, baseName, imageBuildInfo);
	if (!featureBuildInfo) {
		return null;
	}
	return { featureBuildInfo, collapsedFeaturesConfig };

}

// NOTE: only exported to enable testing. Not meant to be called outside file.
export function generateContainerEnvs(featuresConfig: FeaturesConfig) {
	let result = '';
	for (const fSet of featuresConfig.featureSets) {
		// We only need to generate this ENV references for the initial features specification.
		if (fSet.internalVersion !== '2')
		{
			result += '\n';
			result += fSet.features
				.filter(f => (includeAllConfiguredFeatures || f.included) && f.value)
				.reduce((envs, f) => envs.concat(Object.keys(f.containerEnv || {})
					.map(k => `ENV ${k}=${f.containerEnv![k]}`)), [] as string[])
				.join('\n');
		}
	}
	return result;
}

async function createLocalFeatures(params: DockerResolverParameters, dstFolder: string)
{
	const { common } = params;
	const { cliHost, output } = common;

	// Name of the local cache folder inside the working directory
	const localCacheBuildFolderName = 'local-cache';

	const srcFolder = getContainerFeaturesFolder(common.extensionPath);
	output.write(`local container features stored at: ${srcFolder}`);
	await cliHost.mkdirp(`${dstFolder}/${localCacheBuildFolderName}`);
	const create = tar.c({
		cwd: srcFolder,
		filter: path => (path !== './Dockerfile' && path !== `./${V1_DEVCONTAINER_FEATURES_FILE_NAME}`),
	}, ['.']);
	const createExit = new Promise((resolve, reject) => {
		create.on('error', reject);
		create.on('finish', resolve);
	});
	const extract = await cliHost.exec({
		cmd: 'tar',
		args: [
			'--no-same-owner',
			'-x',
			'-f', '-',
		],
		cwd: `${dstFolder}/${localCacheBuildFolderName}`,
		output,
	});
	const stdoutDecoder = new StringDecoder();
	extract.stdout.on('data', (chunk: Buffer) => {
		output.write(stdoutDecoder.write(chunk));
	});
	const stderrDecoder = new StringDecoder();
	extract.stderr.on('data', (chunk: Buffer) => {
		output.write(toErrorText(stderrDecoder.write(chunk)));
	});
	create.pipe(extract.stdin);
	await extract.exit;
	await createExit; // Allow errors to surface.
}

async function getContainerFeaturesBuildInfo(params: DockerResolverParameters, featuresConfig: FeaturesConfig, baseName: string, imageBuildInfo: ImageBuildInfo): Promise<{ dstFolder: string; dockerfileContent: string; overrideTarget: string; dockerfilePrefixContent: string; buildArgs: Record<string, string>; buildKitContexts: Record<string, string> } | null> {
	const { common } = params;
	const { cliHost, output } = common;
	const { dstFolder } = featuresConfig;

	if (!dstFolder || dstFolder === '') {
		output.write('dstFolder is undefined or empty in addContainerFeatures', LogLevel.Error);
		return null;
	}

	const buildStageScripts = await Promise.all(featuresConfig.featureSets
		.map(featureSet => multiStageBuildExploration ? featureSet.features
			.filter(f => (includeAllConfiguredFeatures || f.included) && f.value)
			.reduce(async (binScripts, feature) => {
				const binPath = cliHost.path.join(dstFolder, getSourceInfoString(featureSet.sourceInformation), 'features', feature.id, 'bin');
				const hasAcquire = cliHost.isFile(cliHost.path.join(binPath, 'acquire'));
				const hasConfigure = cliHost.isFile(cliHost.path.join(binPath, 'configure'));
				const map = await binScripts;
				map[feature.id] = {
					hasAcquire: await hasAcquire,
					hasConfigure: await hasConfigure,
				};
				return map;
			}, Promise.resolve({}) as Promise<Record<string, { hasAcquire: boolean; hasConfigure: boolean } | undefined>>) : Promise.resolve({})));

	// With Buildkit (0.8.0 or later), we can supply an additional build context to provide access to
	// the container-features content.
	// For non-Buildkit, we build a temporary image to hold the container-features content in a way
	// that is accessible from the docker build for non-BuiltKit builds
	// TODO generate an image name that is specific to this dev container?
	const buildKitVersionParsed = params.buildKitVersion ? parseVersion(params.buildKitVersion) : null;
	const minRequiredVersion = [0, 8, 0];
	const useBuildKitBuildContexts = buildKitVersionParsed ? !isEarlierVersion(buildKitVersionParsed, minRequiredVersion) : false;
	const buildContentImageName = 'dev_container_feature_content_temp';

	// When copying via buildkit, the content is accessed via '.' (i.e. in the context root)
	// When copying via temp image, the content is in '/tmp/build-features'
	const contentSourceRootPath = useBuildKitBuildContexts ? '.' : '/tmp/build-features/';
	const dockerfile = getContainerFeaturesBaseDockerFile()
		.replace('#{nonBuildKitFeatureContentFallback}', useBuildKitBuildContexts ? '' : `FROM ${buildContentImageName} as dev_containers_feature_content_source`)
		.replace('{contentSourceRootPath}', contentSourceRootPath)
		.replace('#{featureBuildStages}', getFeatureBuildStages(featuresConfig, buildStageScripts, contentSourceRootPath))
		.replace('#{featureLayer}', getFeatureLayers(featuresConfig))
		.replace('#{containerEnv}', generateContainerEnvs(featuresConfig))
		.replace('#{copyFeatureBuildStages}', getCopyFeatureBuildStages(featuresConfig, buildStageScripts))
		.replace('#{devcontainerMetadata}', getDevcontainerMetadataLabel(imageBuildInfo.metadata, featuresConfig, common.experimentalImageMetadata))
		;
	const dockerfilePrefixContent = `${useBuildKitBuildContexts ? '# syntax=docker/dockerfile:1.4' : ''}
ARG _DEV_CONTAINERS_BASE_IMAGE=placeholder
`;

	// Build devcontainer-features.env file(s) for each features source folder
	for await (const fSet of featuresConfig.featureSets) {
		let i = 0;
		if(fSet.internalVersion === '2')
		{
			for await (const fe of fSet.features) {
				if (fe.cachePath)
				{
					fe.internalVersion = '2';
					const envPath = cliHost.path.join(fe.cachePath, 'devcontainer-features.env');
					const variables = getFeatureEnvVariables(fe);
					await cliHost.writeFile(envPath, Buffer.from(variables.join('\n')));
				}
			}
		} else {
			const featuresEnv = ([] as string[]).concat(
				...fSet.features
					.filter(f => (includeAllConfiguredFeatures|| f.included) && f.value && !buildStageScripts[i][f.id]?.hasAcquire)
					.map(getFeatureEnvVariables)
			).join('\n');
			const envPath = cliHost.path.join(fSet.features[0].cachePath!, 'devcontainer-features.env');
			await Promise.all([
				cliHost.writeFile(envPath, Buffer.from(featuresEnv)),
				...fSet.features
				.filter(f => (includeAllConfiguredFeatures || f.included) && f.value && buildStageScripts[i][f.id]?.hasAcquire)
				.map(f => {
						const featuresEnv = [
							...getFeatureEnvVariables(f),
							`_BUILD_ARG_${getSafeId(f.id)}_TARGETPATH=${path.posix.join('/usr/local/devcontainer-features', getSourceInfoString(fSet.sourceInformation), f.id)}`
						]
							.join('\n');
						const envPath = cliHost.path.join(dstFolder, getSourceInfoString(fSet.sourceInformation), 'features', f.id, 'devcontainer-features.env'); // next to bin/acquire
						return cliHost.writeFile(envPath, Buffer.from(featuresEnv));
					})
			]);
		}
		i++;
	}

	// For non-BuildKit, build the temporary image for the container-features content
	if (!useBuildKitBuildContexts) {
		const buildContentDockerfile = `
	FROM scratch
	COPY . /tmp/build-features/
	`;
		const buildContentDockerfilePath = cliHost.path.join(dstFolder, 'Dockerfile.buildContent');
		await cliHost.writeFile(buildContentDockerfilePath, Buffer.from(buildContentDockerfile));
		const buildContentArgs = [
			'build',
			'-t', buildContentImageName,
			'-f', buildContentDockerfilePath,
		];
		buildContentArgs.push(dstFolder);

		if (params.isTTY) {
			const buildContentInfoParams = { ...toPtyExecParameters(params), output: makeLog(output, LogLevel.Info) };
			await dockerPtyCLI(buildContentInfoParams, ...buildContentArgs);
		} else {
			const buildContentInfoParams = { ...toExecParameters(params), output: makeLog(output, LogLevel.Info), print: 'continuous' as 'continuous' };
			await dockerCLI(buildContentInfoParams, ...buildContentArgs);
		}
	}
	return {
		dstFolder,
		dockerfileContent: dockerfile,
		overrideTarget: 'dev_containers_target_stage',
		dockerfilePrefixContent,
		buildArgs: {
			_DEV_CONTAINERS_BASE_IMAGE: baseName,
			_DEV_CONTAINERS_IMAGE_USER: imageBuildInfo.user,
			_DEV_CONTAINERS_FEATURE_CONTENT_SOURCE: buildContentImageName,
		},
		buildKitContexts: useBuildKitBuildContexts ? { dev_containers_feature_content_source: dstFolder } : {},
	};
}

function getFeatureBuildStages(featuresConfig: FeaturesConfig, buildStageScripts: Record<string, { hasAcquire: boolean; hasConfigure: boolean } | undefined>[], contentSourceRootPath: string) {
	return ([] as string[]).concat(...featuresConfig.featureSets
		.map((featureSet, i) => featureSet.features
			.filter(f => (includeAllConfiguredFeatures || f.included) && f.value && buildStageScripts[i][f.id]?.hasAcquire)
			.map(f => `FROM mcr.microsoft.com/vscode/devcontainers/base:0-focal as ${getSourceInfoString(featureSet.sourceInformation)}_${f.id}
COPY --from=dev_containers_feature_content_source ${path.posix.join(contentSourceRootPath, getSourceInfoString(featureSet.sourceInformation), 'features', f.id)} ${path.posix.join('/tmp/build-features', getSourceInfoString(featureSet.sourceInformation), 'features', f.id)}
COPY --from=dev_containers_feature_content_source ${path.posix.join(contentSourceRootPath, getSourceInfoString(featureSet.sourceInformation), 'common')} ${path.posix.join('/tmp/build-features', getSourceInfoString(featureSet.sourceInformation), 'common')}
RUN cd ${path.posix.join('/tmp/build-features', getSourceInfoString(featureSet.sourceInformation), 'features', f.id)} && set -a && . ./devcontainer-features.env && set +a && ./bin/acquire`
			)
		)
	).join('\n\n');
}

function getCopyFeatureBuildStages(featuresConfig: FeaturesConfig, buildStageScripts: Record<string, { hasAcquire: boolean; hasConfigure: boolean } | undefined>[]) {
	return ([] as string[]).concat(...featuresConfig.featureSets
		.map((featureSet, i) => featureSet.features
			.filter(f => (includeAllConfiguredFeatures || f.included) && f.value && buildStageScripts[i][f.id]?.hasAcquire)
			.map(f => {
				const featurePath = path.posix.join('/usr/local/devcontainer-features', getSourceInfoString(featureSet.sourceInformation), f.id);
				return `COPY --from=${getSourceInfoString(featureSet.sourceInformation)}_${f.id} ${featurePath} ${featurePath}${buildStageScripts[i][f.id]?.hasConfigure ? `
RUN cd ${path.posix.join('/tmp/build-features', getSourceInfoString(featureSet.sourceInformation), 'features', f.id)} && set -a && . ./devcontainer-features.env && set +a && ./bin/configure` : ''}`;
			})
		)
	).join('\n\n');
}


function getFeatureEnvVariables(f: Feature) {
	const values = getFeatureValueObject(f);
	const idSafe = getSafeId(f.id);
	const variables = [];
	
	if(f.internalVersion !== '2')
	{
		if (values) {
			variables.push(...Object.keys(values)
				.map(name => `_BUILD_ARG_${idSafe}_${getSafeId(name)}="${values[name]}"`));
			variables.push(`_BUILD_ARG_${idSafe}=true`);
		}
		if (f.buildArg) {
			variables.push(`${f.buildArg}=${getFeatureMainValue(f)}`);
		}
		return variables;
	} else {
		if (values) {
			variables.push(...Object.keys(values)
				.map(name => `${getSafeId(name)}="${values[name]}"`));
		}
		if (f.buildArg) {
			variables.push(`${f.buildArg}=${getFeatureMainValue(f)}`);
		}
		return variables;
	}	
}


export async function getRemoteUserUIDUpdateDetails(params: DockerResolverParameters, config: DevContainerConfig, imageName: string, imageDetails: () => Promise<ImageDetails>, runArgsUser: string | undefined) {
	const { common } = params;
	const { cliHost } = common;
	if (params.updateRemoteUserUIDDefault === 'never' || !(typeof config.updateRemoteUserUID === 'boolean' ? config.updateRemoteUserUID : params.updateRemoteUserUIDDefault === 'on') || !(cliHost.platform === 'linux' || params.updateRemoteUserUIDOnMacOS && cliHost.platform === 'darwin')) {
		return null;
	}
	const imageUser = (await imageDetails()).Config.User || 'root';
	const remoteUser = config.remoteUser || runArgsUser || imageUser;
	if (remoteUser === 'root' || /^\d+$/.test(remoteUser)) {
		return null;
	}
	const folderImageName = getFolderImageName(common);
	const fixedImageName = `${imageName.startsWith(folderImageName) ? imageName : folderImageName}-uid`;

	return {
		imageName: fixedImageName,
		remoteUser,
		imageUser,
	};
}
export async function updateRemoteUserUID(params: DockerResolverParameters, config: DevContainerConfig, imageName: string, imageDetails: () => Promise<ImageDetails>, runArgsUser: string | undefined) {
	const { common } = params;
	const { cliHost } = common;

	const updateDetails = await getRemoteUserUIDUpdateDetails(params, config, imageName, imageDetails, runArgsUser);
	if (!updateDetails) {
		return imageName;
	}
	const { imageName: fixedImageName, remoteUser, imageUser } = updateDetails;

	const dockerfileName = 'updateUID.Dockerfile';
	const srcDockerfile = path.join(common.extensionPath, 'scripts', dockerfileName);
	const version = common.package.version;
	const destDockerfile = cliHost.path.join(await getCacheFolder(cliHost), `${dockerfileName}-${version}`);
	const tmpDockerfile = `${destDockerfile}-${Date.now()}`;
	await cliHost.mkdirp(cliHost.path.dirname(tmpDockerfile));
	await cliHost.writeFile(tmpDockerfile, await readLocalFile(srcDockerfile));
	await cliHost.rename(tmpDockerfile, destDockerfile);
	const args = [
		'build',
		'-f', destDockerfile,
		'-t', fixedImageName,
		'--build-arg', `BASE_IMAGE=${imageName}`,
		'--build-arg', `REMOTE_USER=${remoteUser}`,
		'--build-arg', `NEW_UID=${await cliHost.getuid()}`,
		'--build-arg', `NEW_GID=${await cliHost.getgid()}`,
		'--build-arg', `IMAGE_USER=${imageUser}`,
		cliHost.path.dirname(destDockerfile)
	];
	if (params.isTTY) {
		await dockerPtyCLI(params, ...args);
	} else {
		await dockerCLI(params, ...args);
	}
	return fixedImageName;
}

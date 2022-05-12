/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';
import { StringDecoder } from 'string_decoder';
import * as tar from 'tar';

import { DevContainerConfig } from '../spec-configuration/configuration';
import { dockerPtyCLI, ImageDetails, toPtyExecParameters } from '../spec-shutdown/dockerUtils';
import { LogLevel, makeLog, toErrorText } from '../spec-utils/log';
import { FeaturesConfig, getContainerFeaturesFolder, getContainerFeaturesBaseDockerFile, getFeatureLayers, getFeatureMainValue, getFeatureValueObject, generateFeaturesConfig, getSourceInfoString, collapseFeaturesConfig, Feature, multiStageBuildExploration } from '../spec-configuration/containerFeaturesConfiguration';
import { readLocalFile } from '../spec-utils/pfs';
import { includeAllConfiguredFeatures } from '../spec-utils/product';
import { createFeaturesTempFolder, DockerResolverParameters, getFolderImageName, inspectDockerImage } from './utils';
import { CLIHost } from '../spec-common/cliHost';

export async function extendImage(params: DockerResolverParameters, config: DevContainerConfig, imageName: string, pullImageOnError: boolean) {
	let cache: Promise<ImageDetails> | undefined;
	const imageDetails = () => cache || (cache = inspectDockerImage(params, imageName, pullImageOnError));
	const imageLabelDetails = async () => {
		const labels = (await imageDetails()).Config.Labels  || {};
		return {
			definition : labels['com.visualstudio.code.devcontainers.id'],
			version : labels['version'],
		};
	};
	const featuresConfig = await generateFeaturesConfig(params.common, (await createFeaturesTempFolder(params.common)), config, imageLabelDetails, getContainerFeaturesFolder);
	const collapsedFeaturesConfig = collapseFeaturesConfig(featuresConfig);
	const updatedImageName = await addContainerFeatures(params, featuresConfig, imageName, async () => (await imageDetails()).Config.User || 'root');
	return { updatedImageName, collapsedFeaturesConfig, imageDetails };
}

// NOTE: only exported to enable testing. Not meant to be called outside file.
export function generateContainerEnvs(featuresConfig: FeaturesConfig) {
	let result = '';
	for (const fSet of featuresConfig.featureSets) {
		result += fSet.features
			.filter(f => (includeAllConfiguredFeatures || f.included) && f.value)
			.reduce((envs, f) => envs.concat(Object.keys(f.containerEnv || {})
				.map(k => `ENV ${k}=${f.containerEnv![k]}`)), [] as string[])
			.join('\n');
	}
	return result;
}

async function addContainerFeatures(params: DockerResolverParameters, featuresConfig: FeaturesConfig | undefined, imageName: string, containerUser: () => Promise<string>) {
	const { common } = params;
	const { cliHost, output } = common;
	if (!featuresConfig) {
		return imageName;
	}
	
	const { dstFolder } = featuresConfig;
	
	if (!dstFolder || dstFolder === '') {
		output.write('dstFolder is undefined or empty in addContainerFeatures', LogLevel.Error);
		return imageName;
	}

	// Calculate name of the build folder where localcache has been copied to.
	const localCacheBuildFolderName = getSourceInfoString({ type : 'local-cache'});
	const imageUser = await containerUser();
	const folderImageName = getFolderImageName(common);
	const updatedImageName = `${imageName.startsWith(folderImageName) ? imageName : folderImageName}-features`;

	const srcFolder = getContainerFeaturesFolder(common.extensionPath);
	output.write(`local container features stored at: ${srcFolder}`);
	await cliHost.mkdirp(`${dstFolder}/${localCacheBuildFolderName}`);
	const create = tar.c({
		cwd: srcFolder,
		filter: path => (path !== './Dockerfile' && path !== './devcontainer-features.json'),
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

	const dockerfile = getContainerFeaturesBaseDockerFile()
		.replace('#{featureBuildStages}', getFeatureBuildStages(cliHost, featuresConfig, buildStageScripts))
		.replace('#{featureLayer}', getFeatureLayers(featuresConfig))
		.replace('#{containerEnv}', generateContainerEnvs(featuresConfig))
		.replace('#{copyFeatureBuildStages}', getCopyFeatureBuildStages(featuresConfig, buildStageScripts))
	;

	await cliHost.writeFile(cliHost.path.join(dstFolder, 'Dockerfile'), Buffer.from(dockerfile));

	// Build devcontainer-features.env file(s) for each features source folder
	await Promise.all([...featuresConfig.featureSets].map(async (featureSet, i) => {
		const featuresEnv = ([] as string[]).concat(
			...featureSet.features
				.filter(f => (includeAllConfiguredFeatures || f.included) && f.value && !buildStageScripts[i][f.id]?.hasAcquire)
				.map(getFeatureEnvVariables)
		).join('\n');
		const envPath = cliHost.path.join(dstFolder, getSourceInfoString(featureSet.sourceInformation), 'devcontainer-features.env'); // next to install.sh
		await Promise.all([
			cliHost.writeFile(envPath, Buffer.from(featuresEnv)),
			...featureSet.features
			.filter(f => (includeAllConfiguredFeatures || f.included) && f.value && buildStageScripts[i][f.id]?.hasAcquire)
			.map(f => {
					const featuresEnv = [
						...getFeatureEnvVariables(f),
						`_BUILD_ARG_${getFeatureSafeId(f)}_TARGETPATH=${path.posix.join('/usr/local/devcontainer-features', getSourceInfoString(featureSet.sourceInformation), f.id)}`
					]
						.join('\n');
					const envPath = cliHost.path.join(dstFolder, getSourceInfoString(featureSet.sourceInformation), 'features', f.id, 'devcontainer-features.env'); // next to bin/acquire
					return cliHost.writeFile(envPath, Buffer.from(featuresEnv));
				})
		]);
	}));

	const args = [
		'build',
		'-t', updatedImageName,
		'--build-arg', `_DEV_CONTAINERS_BASE_IMAGE=${imageName}`,
		'--build-arg', `_DEV_CONTAINERS_IMAGE_USER=${imageUser}`,
		dstFolder,
	];
	const infoParams = { ...toPtyExecParameters(params), output: makeLog(output, LogLevel.Info) };
	await dockerPtyCLI(infoParams, ...args);
	return updatedImageName;
}

function getFeatureBuildStages(cliHost: CLIHost, featuresConfig: FeaturesConfig, buildStageScripts: Record<string, { hasAcquire: boolean; hasConfigure: boolean } | undefined>[]) {
	return ([] as string[]).concat(...featuresConfig.featureSets
		.map((featureSet, i) => featureSet.features
			.filter(f => (includeAllConfiguredFeatures || f.included) && f.value && buildStageScripts[i][f.id]?.hasAcquire)
			.map(f => `FROM mcr.microsoft.com/vscode/devcontainers/base:0-focal as ${getSourceInfoString(featureSet.sourceInformation)}_${f.id}
COPY ${cliHost.path.join('.', getSourceInfoString(featureSet.sourceInformation), 'features', f.id)} ${path.posix.join('/tmp/build-features', getSourceInfoString(featureSet.sourceInformation), 'features', f.id)}
COPY ${cliHost.path.join('.', getSourceInfoString(featureSet.sourceInformation), 'common')} ${path.posix.join('/tmp/build-features', getSourceInfoString(featureSet.sourceInformation), 'common')}
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
	const idSafe = getFeatureSafeId(f);
	const variables = [];
	if (values) {
		variables.push(...Object.keys(values)
			.map(name => `_BUILD_ARG_${idSafe}_${name.toUpperCase()}="${values[name]}"`));
		variables.push(`_BUILD_ARG_${idSafe}=true`);
	}
	if (f.buildArg) {
		variables.push(`${f.buildArg}=${getFeatureMainValue(f)}`);
	}
	return variables;
}

function getFeatureSafeId(f: Feature) {
	return f.id
		.replace(/[/-]/g, '_') // Slashes and dashes are not allowed in an env. variable key
		.toUpperCase();
}

export async function updateRemoteUserUID(params: DockerResolverParameters, config: DevContainerConfig, imageName: string, imageDetails: () => Promise<ImageDetails>, runArgsUser: string | undefined) {
	const { common } = params;
	const { cliHost } = common;
	if (params.updateRemoteUserUIDDefault === 'never' || !(typeof config.updateRemoteUserUID === 'boolean' ? config.updateRemoteUserUID : params.updateRemoteUserUIDDefault === 'on') || !(cliHost.platform === 'linux' || params.updateRemoteUserUIDOnMacOS && cliHost.platform === 'darwin')) {
		return imageName;
	}
	const imageUser = (await imageDetails()).Config.User || 'root';
	const remoteUser = config.remoteUser || runArgsUser || imageUser;
	if (remoteUser === 'root' || /^\d+$/.test(remoteUser)) {
		return imageName;
	}
	const folderImageName = getFolderImageName(common);
	const fixedImageName = `${imageName.startsWith(folderImageName) ? imageName : folderImageName}-uid`;

	const dockerfileName = 'updateUID.Dockerfile';
	const srcDockerfile = path.join(common.extensionPath, 'scripts', dockerfileName);
	const version = common.package.version;
	const destDockerfile = cliHost.path.join(await cliHost.tmpdir(), 'vsch', `${dockerfileName}-${version}`);
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
	await dockerPtyCLI(params, ...args);
	return fixedImageName;
}

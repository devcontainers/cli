/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ContainerError } from '../spec-common/errors';
import { DevContainerConfig, DevContainerConfigCommand, DevContainerFromDockerfileConfig, DevContainerFromImageConfig, getDockerComposeFilePaths, getDockerfilePath, HostRequirements, isDockerFileConfig, PortAttributes, UserEnvProbe } from '../spec-configuration/configuration';
import { Feature, FeaturesConfig, Mount } from '../spec-configuration/containerFeaturesConfiguration';
import { ContainerDetails, DockerCLIParameters, ImageDetails } from '../spec-shutdown/dockerUtils';
import { Log } from '../spec-utils/log';
import { getBuildInfoForService, readDockerComposeConfig } from './dockerCompose';
import { SubstituteConfig, SubstitutedConfig, DockerResolverParameters, findBaseImage, findUserStatement, inspectDockerImage, uriToWSLFsPath } from './utils';

const pickConfigProperties: (keyof DevContainerConfig & keyof ImageMetadataEntry)[] = [
	'onCreateCommand',
	'updateContentCommand',
	'postCreateCommand',
	'postStartCommand',
	'postAttachCommand',
	'waitFor',
	'customizations',
	'remoteUser',
	'userEnvProbe',
	'remoteEnv',
	'overrideCommand',
	'portsAttributes',
	'otherPortsAttributes',
	'forwardPorts',
	'shutdownAction',
	'updateRemoteUserUID',
	'hostRequirements',
];

const pickSingleContainerConfigProperties: (keyof DevContainerFromImageConfig & keyof DevContainerFromDockerfileConfig & keyof ImageMetadataEntry)[] = [
	'mounts',
	'containerUser',
	'containerEnv',
	...pickConfigProperties,
];

const pickFeatureProperties: (keyof Feature & keyof ImageMetadataEntry)[] = [
	'id',
	'init',
	'privileged',
	'capAdd',
	'securityOpt',
	'entrypoint',
	'mounts',
	'customizations',
];

export interface ImageMetadataEntry {
	id?: string;
	init?: boolean;
	privileged?: boolean;
	capAdd?: string[];
	securityOpt?: string[];
	entrypoint?: string;
	mounts?: (Mount | string)[];
	customizations?: Record<string, any>;
	onCreateCommand?: string | string[];
	updateContentCommand?: string | string[];
	postCreateCommand?: string | string[];
	postStartCommand?: string | string[];
	postAttachCommand?: string | string[];
	waitFor?: DevContainerConfigCommand;
	remoteUser?: string;
	containerUser?: string;
	userEnvProbe?: UserEnvProbe;
	remoteEnv?: Record<string, string | null>;
	containerEnv?: Record<string, string>;
	overrideCommand?: boolean;
	portsAttributes?: Record<string, PortAttributes>;
	otherPortsAttributes?: PortAttributes;
	forwardPorts?: (number | string)[];
	shutdownAction?: 'none' | 'stopContainer' | 'stopCompose';
	updateRemoteUserUID?: boolean;
	hostRequirements?: HostRequirements;
}

export function getDevcontainerMetadata(baseImageMetadata: SubstitutedConfig<ImageMetadataEntry[]>, devContainerConfig: SubstitutedConfig<DevContainerConfig>, featuresConfig: FeaturesConfig | Feature[]): SubstitutedConfig<ImageMetadataEntry[]> {
	const features = Array.isArray(featuresConfig) ? featuresConfig : ([] as Feature[]).concat(
		...featuresConfig.featureSets
			.map(x => x.features)
	);
	const raw = features.map(feature => pick(feature, pickFeatureProperties));
	return {
		config: [
			...baseImageMetadata.config,
			...raw.map(devContainerConfig.substitute),
			'dockerComposeFile' in devContainerConfig.config ?
				pick(devContainerConfig.config, pickConfigProperties) :
				pick(devContainerConfig.config, pickSingleContainerConfigProperties),
		].filter(config => Object.keys(config).length),
		raw: [
			...baseImageMetadata.raw,
			...raw,
			'dockerComposeFile' in devContainerConfig.raw ?
				pick(devContainerConfig.raw, pickConfigProperties) :
				pick(devContainerConfig.raw, pickSingleContainerConfigProperties),
		].filter(config => Object.keys(config).length),
		substitute: devContainerConfig.substitute,
	};
}

function pick<T, K extends keyof T>(obj: T, keys: K[]) {
	return keys.reduce((res, key) => {
		if (key in obj) {
			res[key] = obj[key];
		}
		return res;
	}, {} as Pick<T, K>);
}

export interface ImageBuildInfo {
	user: string;
	metadata: SubstitutedConfig<ImageMetadataEntry[]>;
}

export async function getImageBuildInfo(params: DockerResolverParameters | DockerCLIParameters, configWithRaw: SubstitutedConfig<DevContainerConfig>, experimentalImageMetadata: boolean): Promise<ImageBuildInfo> {
	const { dockerCLI, dockerComposeCLI } = params;
	const { cliHost, output } = 'cliHost' in params ? params : params.common;

	const { config } = configWithRaw;
	if (isDockerFileConfig(config)) {

		const dockerfileUri = getDockerfilePath(cliHost, config);
		const dockerfilePath = await uriToWSLFsPath(dockerfileUri, cliHost);
		if (!cliHost.isFile(dockerfilePath)) {
			throw new ContainerError({ description: `Dockerfile (${dockerfilePath}) not found.` });
		}
		const dockerfile = (await cliHost.readFile(dockerfilePath)).toString();
		return getImageBuildInfoFromDockerfile(params, dockerfile, config.build?.args || {}, configWithRaw.substitute, experimentalImageMetadata);

	} else if ('dockerComposeFile' in config) {

		const cwdEnvFile = cliHost.path.join(cliHost.cwd, '.env');
		const envFile = Array.isArray(config.dockerComposeFile) && config.dockerComposeFile.length === 0 && await cliHost.isFile(cwdEnvFile) ? cwdEnvFile : undefined;
		const composeFiles = await getDockerComposeFilePaths(cliHost, config, cliHost.env, cliHost.cwd);
		const buildParams: DockerCLIParameters = { cliHost, dockerCLI, dockerComposeCLI, env: cliHost.env, output };

		const composeConfig = await readDockerComposeConfig(buildParams, composeFiles, envFile);
		const services = Object.keys(composeConfig.services || {});
		if (services.indexOf(config.service) === -1) {
			throw new Error(`Service '${config.service}' configured in devcontainer.json not found in Docker Compose configuration.`);
		}

		const composeService = composeConfig.services[config.service];
		const serviceInfo = getBuildInfoForService(composeService, cliHost.path, composeFiles);
		if (serviceInfo.build) {
			const { context, dockerfilePath } = serviceInfo.build;
			const resolvedDockerfilePath = cliHost.path.isAbsolute(dockerfilePath) ? dockerfilePath : cliHost.path.resolve(context, dockerfilePath);
			const dockerfile = (await cliHost.readFile(resolvedDockerfilePath)).toString();
			return getImageBuildInfoFromDockerfile(params, dockerfile, serviceInfo.build.args || {}, configWithRaw.substitute, experimentalImageMetadata);
		} else {
			return getImageBuildInfoFromImage(params, composeService.image, configWithRaw.substitute, experimentalImageMetadata);
		}

	} else {

		return getImageBuildInfoFromImage(params, config.image, configWithRaw.substitute, experimentalImageMetadata);

	}
}

export async function getImageBuildInfoFromImage(params: DockerResolverParameters | DockerCLIParameters, imageName: string, substitute: SubstituteConfig, experimentalImageMetadata: boolean): Promise<ImageBuildInfo & { imageDetails: ImageDetails }> {
	const imageDetails = await inspectDockerImage(params, imageName, true);
	const user = imageDetails.Config.User || 'root';
	const { output } = 'output' in params ? params : params.common;
	const metadata = getImageMetadata(imageDetails, substitute, experimentalImageMetadata, output);
	return {
		user,
		metadata,
		imageDetails,
	};
}

export async function getImageBuildInfoFromDockerfile(params: DockerResolverParameters | DockerCLIParameters, dockerfile: string, dockerBuildArgs: Record<string, string>, substitute: SubstituteConfig, experimentalImageMetadata: boolean) {
	const { output } = 'output' in params ? params : params.common;
	return internalGetImageBuildInfoFromDockerfile(imageName => inspectDockerImage(params, imageName, true), dockerfile, dockerBuildArgs, substitute, experimentalImageMetadata, output);
}

export async function internalGetImageBuildInfoFromDockerfile(inspectDockerImage: (imageName: string) => Promise<ImageDetails>, dockerfile: string, dockerBuildArgs: Record<string, string>, substitute: SubstituteConfig, experimentalImageMetadata: boolean, output: Log): Promise<ImageBuildInfo> {
	// TODO: Other targets.
	const dockerfileUser = findUserStatement(dockerfile, dockerBuildArgs);
	const baseImage = findBaseImage(dockerfile, dockerBuildArgs);
	const imageDetails = baseImage && await inspectDockerImage(baseImage) || undefined;
	const user = dockerfileUser || imageDetails?.Config.User || 'root';
	const metadata = imageDetails ? getImageMetadata(imageDetails, substitute, experimentalImageMetadata, output) : { config: [], raw: [], substitute };
	return {
		user,
		metadata,
	};
}

export const imageMetadataLabel = 'devcontainer.metadata';

export function getImageMetadataFromContainer(containerDetails: ContainerDetails, devContainerConfig: SubstitutedConfig<DevContainerConfig>, featuresConfig: FeaturesConfig | Feature[], experimentalImageMetadata: boolean, output: Log): SubstitutedConfig<ImageMetadataEntry[]> {
	if (!experimentalImageMetadata) {
		return getDevcontainerMetadata({ config: [], raw: [], substitute: devContainerConfig.substitute }, devContainerConfig, featuresConfig);
	}
	return internalGetImageMetadata(containerDetails, devContainerConfig.substitute, experimentalImageMetadata, output);
}

export function getImageMetadata(imageDetails: ImageDetails, substitute: SubstituteConfig, experimentalImageMetadata: boolean, output: Log) {
	return internalGetImageMetadata(imageDetails, substitute, experimentalImageMetadata, output);
}

function internalGetImageMetadata(imageDetails: ImageDetails | ContainerDetails, substitute: SubstituteConfig, experimentalImageMetadata: boolean, output: Log): SubstitutedConfig<ImageMetadataEntry[]> {
	const raw = internalGetImageMetadata0(imageDetails, experimentalImageMetadata, output);
	return {
		config: raw.map(substitute),
		raw,
		substitute,
	};
}

function internalGetImageMetadata0(imageDetails: ImageDetails | ContainerDetails, experimentalImageMetadata: boolean, output: Log) {
	if (!experimentalImageMetadata) {
		return [];
	}
	const str = (imageDetails.Config.Labels || {})[imageMetadataLabel];
	if (str) {
		try {
			const obj = JSON.parse(str);
			if (Array.isArray(obj)) {
				return obj as ImageMetadataEntry[];
			}
			if (obj && typeof obj === 'object') {
				return [obj as ImageMetadataEntry];
			}
			output.write(`Invalid image metadata: ${str}`);
		} catch (err) {
			output.write(`Error parsing image metadata: ${err?.message || err}`);
		}
	}
	return [];
}

export function getDevcontainerMetadataLabel(baseImageMetadata: SubstitutedConfig<ImageMetadataEntry[]>, devContainerConfig: SubstitutedConfig<DevContainerConfig>, featuresConfig: FeaturesConfig | Feature[], experimentalImageMetadata: boolean) {
	if (!experimentalImageMetadata) {
		return '';
	}
	const metadata = getDevcontainerMetadata(baseImageMetadata, devContainerConfig, featuresConfig).raw;
	if (!metadata.length) {
		return '';
	}
	const imageMetadataLabelValue = metadata.length !== 1
		? `[${metadata
			.map(feature => ` \\\n${toLabelString(feature)}`)
			.join(',')} \\\n]`
		: toLabelString(metadata[0]);
	return `LABEL ${imageMetadataLabel}="${imageMetadataLabelValue}"`;
}

function toLabelString(obj: object) {
	return JSON.stringify(obj)
		.replace(/(?=["\\$])/g, '\\');
}

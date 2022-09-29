/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ContainerError } from '../spec-common/errors';
import { DevContainerConfig, DevContainerConfigCommand, DevContainerFromDockerComposeConfig, DevContainerFromDockerfileConfig, DevContainerFromImageConfig, getDockerComposeFilePaths, getDockerfilePath, HostRequirements, isDockerFileConfig, PortAttributes, UserEnvProbe } from '../spec-configuration/configuration';
import { Feature, FeaturesConfig, Mount } from '../spec-configuration/containerFeaturesConfiguration';
import { ContainerDetails, DockerCLIParameters, ImageDetails } from '../spec-shutdown/dockerUtils';
import { Log } from '../spec-utils/log';
import { getBuildInfoForService, readDockerComposeConfig } from './dockerCompose';
import { extractDockerfile, findBaseImage, findUserStatement } from './dockerfileUtils';
import { SubstituteConfig, SubstitutedConfig, DockerResolverParameters, inspectDockerImage, uriToWSLFsPath } from './utils';

const pickConfigProperties: (keyof DevContainerConfig & keyof ImageMetadataEntry)[] = [
	'onCreateCommand',
	'updateContentCommand',
	'postCreateCommand',
	'postStartCommand',
	'postAttachCommand',
	'waitFor',
	'customizations',
	'mounts',
	'containerEnv',
	'containerUser',
	'init',
	'privileged',
	'capAdd',
	'securityOpt',
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

export type MergedDevContainerConfig = MergedConfig<DevContainerFromImageConfig> | MergedConfig<DevContainerFromDockerfileConfig> | MergedConfig<DevContainerFromDockerComposeConfig>;

type MergedConfig<T extends DevContainerConfig> = Omit<T, typeof replaceProperties[number]> & UpdatedConfigProperties;

const replaceProperties = [
	'customizations',
	'entrypoint',
	'onCreateCommand',
	'updateContentCommand',
	'postCreateCommand',
	'postStartCommand',
	'postAttachCommand',
	'shutdownAction'
] as const;

interface UpdatedConfigProperties {
	customizations?: Record<string, any[]>;
	entrypoints?: string[];
	onCreateCommands?: (string | string[])[];
	updateContentCommands?: (string | string[])[];
	postCreateCommands?: (string | string[])[];
	postStartCommands?: (string | string[])[];
	postAttachCommands?: (string | string[])[];
	shutdownAction?: 'none' | 'stopContainer' | 'stopCompose';
}

export function mergeConfiguration(config: DevContainerConfig, imageMetadata: ImageMetadataEntry[]): MergedDevContainerConfig {
	const customizations = imageMetadata.reduce((obj, entry) => {
		for (const key in entry.customizations) {
			if (key in obj) {
				obj[key].push(entry.customizations[key]);
			} else {
				obj[key] = [entry.customizations[key]];
			}
		}
		return obj;
	}, {} as Record<string, any[]>);
	const reversed = imageMetadata.slice().reverse();
	const copy = { ...config };
	replaceProperties.forEach(property => delete (copy as any)[property]);
	const merged: MergedDevContainerConfig = {
		...copy,
		init: imageMetadata.some(entry => entry.init),
		privileged: imageMetadata.some(entry => entry.privileged),
		capAdd: unionOrUndefined(imageMetadata.map(entry => entry.capAdd)),
		securityOpt: unionOrUndefined(imageMetadata.map(entry => entry.securityOpt)),
		entrypoints: collectOrUndefined(imageMetadata, 'entrypoint'),
		mounts: concatOrUndefined(imageMetadata.map(entry => entry.mounts)),
		customizations: Object.keys(customizations).length ? customizations : undefined,
		onCreateCommands: collectOrUndefined(imageMetadata, 'onCreateCommand'),
		updateContentCommands: collectOrUndefined(imageMetadata, 'updateContentCommand'),
		postCreateCommands: collectOrUndefined(imageMetadata, 'postCreateCommand'),
		postStartCommands: collectOrUndefined(imageMetadata, 'postStartCommand'),
		postAttachCommands: collectOrUndefined(imageMetadata, 'postAttachCommand'),
		waitFor: reversed.find(entry => entry.waitFor)?.waitFor,
		remoteUser: reversed.find(entry => entry.remoteUser)?.remoteUser,
		containerUser: reversed.find(entry => entry.containerUser)?.containerUser,
		userEnvProbe: reversed.find(entry => entry.userEnvProbe)?.userEnvProbe,
		remoteEnv: Object.assign({}, ...imageMetadata.map(entry => entry.remoteEnv)),
		containerEnv: Object.assign({}, ...imageMetadata.map(entry => entry.containerEnv)),
		overrideCommand: reversed.find(entry => typeof entry.overrideCommand === 'boolean')?.overrideCommand,
		portsAttributes: Object.assign({}, ...imageMetadata.map(entry => entry.portsAttributes)),
		otherPortsAttributes: reversed.find(entry => entry.otherPortsAttributes)?.otherPortsAttributes,
		forwardPorts: mergeForwardPorts(imageMetadata),
		shutdownAction: reversed.find(entry => entry.shutdownAction)?.shutdownAction,
		updateRemoteUserUID: reversed.find(entry => entry.updateRemoteUserUID)?.updateRemoteUserUID,
		hostRequirements: mergeHostRequirements(imageMetadata),
	};
	return merged;
}

function mergeForwardPorts(imageMetadata: ImageMetadataEntry[]): (number | string)[] | undefined {
	const forwardPorts = [
		...new Set(
			([] as (number | string)[]).concat(...imageMetadata.map(entry => entry.forwardPorts || []))
				.map(port => typeof port === 'number' ? `localhost:${port}` : port)
		)
	].map(port => /localhost:\d+/.test(port) ? parseInt(port.substring('localhost:'.length)) : port);
	return forwardPorts.length ? forwardPorts : undefined;
}

function mergeHostRequirements(imageMetadata: ImageMetadataEntry[]) {
	const cpus = Math.max(...imageMetadata.map(m => m.hostRequirements?.cpus || 0));
	const memory = Math.max(...imageMetadata.map(m => parseBytes(m.hostRequirements?.memory || '0')));
	const storage = Math.max(...imageMetadata.map(m => parseBytes(m.hostRequirements?.storage || '0')));
	return cpus || memory || storage ? {
		cpus,
		memory: memory ? `${memory}` : undefined,
		storage: storage ? `${storage}` : undefined,
	} : undefined;
}

function parseBytes(str: string) {
	const m = /^(\d+)([tgmk]b)?$/.exec(str);
	if (m) {
		const [, strn, stru] = m;
		const n = parseInt(strn, 10);
		const u = stru && { t: 2 ** 40, g: 2 ** 30, m: 2 ** 20, k: 2 ** 10 }[stru[0]] || 1;
		return n * u;
	}
	return 0;
}

function concatOrUndefined<T>(entries: (T[] | undefined)[]): T[] | undefined {
	const values = ([] as T[]).concat(...entries.filter(entry => !!entry) as T[][]);
	return values.length ? values : undefined;
}

function unionOrUndefined<T>(entries: (T[] | undefined)[]): T[] | undefined {
	const values = [...new Set(([] as T[]).concat(...entries.filter(entry => !!entry) as T[][]))];
	return values.length ? values : undefined;
}

function collectOrUndefined<T, K extends keyof T>(entries: T[], property: K): NonNullable<T[K]>[] | undefined {
	const values = entries.map(entry => entry[property])
		.filter(value => !!value) as NonNullable<T[K]>[];
	return values.length ? values : undefined;
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
			pick(devContainerConfig.config, pickConfigProperties),
		].filter(config => Object.keys(config).length),
		raw: [
			...baseImageMetadata.raw,
			...raw,
			pick(devContainerConfig.raw, pickConfigProperties),
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
		return getImageBuildInfoFromDockerfile(params, dockerfile, config.build?.args || {}, config.build?.target, configWithRaw.substitute, experimentalImageMetadata);

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
			return getImageBuildInfoFromDockerfile(params, dockerfile, serviceInfo.build.args || {}, serviceInfo.build.target, configWithRaw.substitute, experimentalImageMetadata);
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

export async function getImageBuildInfoFromDockerfile(params: DockerResolverParameters | DockerCLIParameters, dockerfile: string, dockerBuildArgs: Record<string, string>, targetStage: string | undefined, substitute: SubstituteConfig, experimentalImageMetadata: boolean) {
	const { output } = 'output' in params ? params : params.common;
	return internalGetImageBuildInfoFromDockerfile(imageName => inspectDockerImage(params, imageName, true), dockerfile, dockerBuildArgs, targetStage, substitute, experimentalImageMetadata, output);
}

export async function internalGetImageBuildInfoFromDockerfile(inspectDockerImage: (imageName: string) => Promise<ImageDetails>, dockerfile: string, dockerBuildArgs: Record<string, string>, targetStage: string | undefined, substitute: SubstituteConfig, experimentalImageMetadata: boolean, output: Log): Promise<ImageBuildInfo> {
	const extracted = extractDockerfile(dockerfile);
	const dockerfileUser = findUserStatement(extracted, dockerBuildArgs, targetStage);
	const baseImage = findBaseImage(extracted, dockerBuildArgs, targetStage);
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

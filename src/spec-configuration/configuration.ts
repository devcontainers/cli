/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';
import { URI } from 'vscode-uri';
import { FileHost, parentURI, uriToFsPath } from './configurationCommonUtils';
import { RemoteDocuments } from './editableFiles';

export type DevContainerConfig = DevContainerFromImageConfig | DevContainerFromDockerfileConfig | DevContainerFromDockerComposeConfig;

export interface PortAttributes {
	label: string | undefined;
	onAutoForward: string | undefined;
	elevateIfNeeded: boolean | undefined;
}

export type UserEnvProbe = 'none' | 'loginInteractiveShell' | 'interactiveShell' | 'loginShell';

export type DevContainerConfigCommand = 'initializeCommand' | 'onCreateCommand' | 'updateContentCommand' | 'postCreateCommand' | 'postStartCommand' | 'postAttachCommand';

export interface HostRequirements {
	cpus?: number;
	memory?: string;
	storage?: string;
}

export interface DevContainerFromImageConfig {
	configFilePath: URI;
	image: string;
	name?: string;
	forwardPorts?: (number | string)[];
	appPort?: number | string | (number | string)[];
	portsAttributes?: Record<string, PortAttributes>;
	otherPortsAttributes?: PortAttributes;
	runArgs?: string[];
	shutdownAction?: 'none' | 'stopContainer';
	overrideCommand?: boolean;
	initializeCommand?: string | string[];
	onCreateCommand?: string | string[];
	updateContentCommand?: string | string[];
	postCreateCommand?: string | string[];
	postStartCommand?: string | string[];
	postAttachCommand?: string | string[];
	waitFor?: DevContainerConfigCommand;
	/** remote path to folder or workspace */
	workspaceFolder?: string;
	workspaceMount?: string;
	mounts?: string[];
	containerEnv?: Record<string, string>;
	remoteEnv?: Record<string, string | null>;
	containerUser?: string;
	remoteUser?: string;
	updateRemoteUserUID?: boolean;
	userEnvProbe?: UserEnvProbe;
	features?: Record<string, string | boolean | Record<string, string | boolean>>;
	hostRequirements?: HostRequirements;
}

export type DevContainerFromDockerfileConfig = {
	configFilePath: URI;
	name?: string;
	forwardPorts?: (number | string)[];
	appPort?: number | string | (number | string)[];
	portsAttributes?: Record<string, PortAttributes>;
	otherPortsAttributes?: PortAttributes;
	runArgs?: string[];
	shutdownAction?: 'none' | 'stopContainer';
	overrideCommand?: boolean;
	initializeCommand?: string | string[];
	onCreateCommand?: string | string[];
	updateContentCommand?: string | string[];
	postCreateCommand?: string | string[];
	postStartCommand?: string | string[];
	postAttachCommand?: string | string[];
	waitFor?: DevContainerConfigCommand;
	/** remote path to folder or workspace */
	workspaceFolder?: string;
	workspaceMount?: string;
	mounts?: string[];
	containerEnv?: Record<string, string>;
	remoteEnv?: Record<string, string | null>;
	containerUser?: string;
	remoteUser?: string;
	updateRemoteUserUID?: boolean;
	userEnvProbe?: UserEnvProbe;
	features?: Record<string, string | boolean | Record<string, string | boolean>>;
	hostRequirements?: HostRequirements;
} & (
	{
		dockerFile: string;
		context?: string;
		build?: {
			target?: string;
			args?: Record<string, string>;
			cacheFrom?: string | string[];
		};
	}
	|
	{
		build: {
			dockerfile: string;
			context?: string;
			target?: string;
			args?: Record<string, string>;
			cacheFrom?: string | string[];
		};
	}
);

export interface DevContainerFromDockerComposeConfig {
	configFilePath: URI;
	dockerComposeFile: string | string[];
	service: string;
	workspaceFolder: string;
	name?: string;
	forwardPorts?: (number | string)[];
	portsAttributes?: Record<string, PortAttributes>;
	otherPortsAttributes?: PortAttributes;
	shutdownAction?: 'none' | 'stopCompose';
	overrideCommand?: boolean;
	initializeCommand?: string | string[];
	onCreateCommand?: string | string[];
	updateContentCommand?: string | string[];
	postCreateCommand?: string | string[];
	postStartCommand?: string | string[];
	postAttachCommand?: string | string[];
	waitFor?: DevContainerConfigCommand;
	runServices?: string[];
	remoteEnv?: Record<string, string | null>;
	remoteUser?: string;
	updateRemoteUserUID?: boolean;
	userEnvProbe?: UserEnvProbe;
	features?: Record<string, string | boolean | Record<string, string | boolean>>;
	hostRequirements?: HostRequirements;
}

interface DevContainerVSCodeConfig {
	extensions?: string[];
	settings?: object;
	devPort?: number;
}

export const enum ExtendBehavior {
	MERGE,
	REPLACE,
	SKIP
}
type DevContainerConfigKey = keyof (DevContainerFromImageConfig & DevContainerFromDockerfileConfig & DevContainerFromDockerComposeConfig);
export type DevContainerExtendConfig = { [key in DevContainerConfigKey]: ExtendBehavior };

export function updateFromOldProperties<T extends DevContainerConfig & DevContainerVSCodeConfig & { customizations?: { vscode?: DevContainerVSCodeConfig } }>(original: T): T {
	// https://github.com/microsoft/dev-container-spec/issues/1
	if (!(original.extensions || original.settings || original.devPort !== undefined)) {
		return original;
	}
	const copy = { ...original };
	const customizations = copy.customizations || (copy.customizations = {});
	const vscode = customizations.vscode || (customizations.vscode = {});
	if (copy.extensions) {
		vscode.extensions = (vscode.extensions || []).concat(copy.extensions);
		delete copy.extensions;
	}
	if (copy.settings) {
		vscode.settings = {
			...copy.settings,
			...(vscode.settings || {}),
		};
		delete copy.settings;
	}
	if (copy.devPort !== undefined && vscode.devPort === undefined) {
		vscode.devPort = copy.devPort;
		delete copy.devPort;
	}
	return copy;
}

export function getConfigFilePath(cliHost: { platform: NodeJS.Platform }, config: { configFilePath: URI }, relativeConfigFilePath: string) {
	return resolveConfigFilePath(cliHost, config.configFilePath, relativeConfigFilePath);
}

export function resolveConfigFilePath(cliHost: { platform: NodeJS.Platform }, configFilePath: URI, relativeConfigFilePath: string) {
	const folder = parentURI(configFilePath);
	return configFilePath.with({
		path: path.posix.resolve(folder.path, (cliHost.platform === 'win32' && configFilePath.scheme !== RemoteDocuments.scheme) ? (path.win32.isAbsolute(relativeConfigFilePath) ? '/' : '') + relativeConfigFilePath.replace(/\\/g, '/') : relativeConfigFilePath)
	});
}

export function isDockerFileConfig(config: DevContainerConfig): config is DevContainerFromDockerfileConfig {
	return 'dockerFile' in config || ('build' in config && 'dockerfile' in config.build);
}

export function getDockerfilePath(cliHost: { platform: NodeJS.Platform }, config: DevContainerFromDockerfileConfig) {
	return getConfigFilePath(cliHost, config, getDockerfile(config));
}

export function getDockerfile(config: DevContainerFromDockerfileConfig) {
	return 'dockerFile' in config ? config.dockerFile : config.build.dockerfile;
}

export async function getDockerComposeFilePaths(cliHost: FileHost, config: DevContainerFromDockerComposeConfig, envForComposeFile?: NodeJS.ProcessEnv, cwdForDefaultFiles?: string) {
	if (Array.isArray(config.dockerComposeFile)) {
		if (config.dockerComposeFile.length) {
			return config.dockerComposeFile.map(composeFile => uriToFsPath(getConfigFilePath(cliHost, config, composeFile), cliHost.platform));
		}
	} else if (typeof config.dockerComposeFile === 'string') {
		return [uriToFsPath(getConfigFilePath(cliHost, config, config.dockerComposeFile), cliHost.platform)];
	}
	if (cwdForDefaultFiles) {
		const envComposeFile = envForComposeFile?.COMPOSE_FILE;
		if (envComposeFile) {
			return envComposeFile.split(cliHost.path.delimiter)
				.map(composeFile => cliHost.path.resolve(cwdForDefaultFiles, composeFile));
		}

		try {
			const envPath = cliHost.path.join(cwdForDefaultFiles, '.env');
			const buffer = await cliHost.readFile(envPath);
			const match = /^COMPOSE_FILE=(.+)$/m.exec(buffer.toString());
			const envFileComposeFile = match && match[1].trim();
			if (envFileComposeFile) {
				return envFileComposeFile.split(cliHost.path.delimiter)
					.map(composeFile => cliHost.path.resolve(cwdForDefaultFiles, composeFile));
			}
		} catch (err) {
			if (!(err && (err.code === 'ENOENT' || err.code === 'EISDIR'))) {
				throw err;
			}
		}

		const defaultFiles = [cliHost.path.resolve(cwdForDefaultFiles, 'docker-compose.yml')];
		const override = cliHost.path.resolve(cwdForDefaultFiles, 'docker-compose.override.yml');
		if (await cliHost.isFile(override)) {
			defaultFiles.push(override);
		}
		return defaultFiles;
	}
	return [];
}

export function buildExtendBehaviorTable(customBehaviors?: Partial<DevContainerExtendConfig>): DevContainerExtendConfig {
	const defaultBehaviors: DevContainerExtendConfig = {
		configFilePath: ExtendBehavior.REPLACE,
		name: ExtendBehavior.REPLACE,
		forwardPorts: ExtendBehavior.REPLACE,
		portsAttributes: ExtendBehavior.REPLACE,
		otherPortsAttributes: ExtendBehavior.REPLACE,
		shutdownAction: ExtendBehavior.REPLACE,
		overrideCommand: ExtendBehavior.REPLACE,
		initializeCommand: ExtendBehavior.REPLACE,
		onCreateCommand: ExtendBehavior.REPLACE,
		updateContentCommand: ExtendBehavior.REPLACE,
		postCreateCommand: ExtendBehavior.REPLACE,
		postStartCommand: ExtendBehavior.REPLACE,
		postAttachCommand: ExtendBehavior.REPLACE,
		waitFor: ExtendBehavior.REPLACE,
		workspaceFolder: ExtendBehavior.REPLACE,
		remoteEnv: ExtendBehavior.REPLACE,
		remoteUser: ExtendBehavior.REPLACE,
		updateRemoteUserUID: ExtendBehavior.REPLACE,
		userEnvProbe: ExtendBehavior.REPLACE,
		features: ExtendBehavior.REPLACE,
		hostRequirements: ExtendBehavior.REPLACE,
		image: ExtendBehavior.MERGE,
		appPort: ExtendBehavior.MERGE,
		runArgs: ExtendBehavior.MERGE,
		workspaceMount: ExtendBehavior.MERGE,
		mounts: ExtendBehavior.MERGE,
		containerEnv: ExtendBehavior.MERGE,
		containerUser: ExtendBehavior.MERGE,
		build: ExtendBehavior.MERGE,
		dockerComposeFile: ExtendBehavior.MERGE,
		service: ExtendBehavior.MERGE,
		runServices: ExtendBehavior.MERGE
	};
	
	return {
		...defaultBehaviors,
		...customBehaviors
	};
}

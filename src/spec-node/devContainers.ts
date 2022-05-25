/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';
import * as crypto from 'crypto';

import { DockerResolverParameters, getPackageConfig, DevContainerAuthority, UpdateRemoteUserUIDDefault, BindMountConsistency } from './utils';
import { createNullPostCreate, finishBackgroundTasks, ResolverParameters, UserEnvProbe } from '../spec-common/injectHeadless';
import { getCLIHost, loadNativeModule } from '../spec-common/commonUtils';
import { resolve } from './configContainer';
import { URI } from 'vscode-uri';
import { promisify } from 'util';
import { LogLevel, LogDimensions, toErrorText, createCombinedLog, createTerminalLog, Log, makeLog, LogFormat, createJSONLog } from '../spec-utils/log';
import { dockerComposeCLIConfig } from './dockerCompose';
import { Mount } from '../spec-configuration/containerFeaturesConfiguration';
import { PackageConfiguration } from '../spec-utils/product';
import { dockerBuildKitVersion } from '../spec-shutdown/dockerUtils';

export interface ProvisionOptions {
	dockerPath: string | undefined;
	dockerComposePath: string | undefined;
	containerDataFolder: string | undefined;
	containerSystemDataFolder: string | undefined;
	workspaceFolder: string | undefined;
	workspaceMountConsistency?: BindMountConsistency;
	mountWorkspaceGitRoot: boolean;
	idLabels: string[];
	configFile: URI | undefined;
	overrideConfigFile: URI | undefined;
	logLevel: LogLevel;
	logFormat: LogFormat;
	log: (text: string) => void;
	terminalDimensions: LogDimensions | undefined;
	defaultUserEnvProbe: UserEnvProbe;
	removeExistingContainer: boolean;
	buildNoCache: boolean;
	expectExistingContainer: boolean;
	postCreateEnabled: boolean;
	skipNonBlocking: boolean;
	prebuild: boolean;
	persistedFolder: string | undefined;
	additionalMounts: Mount[];
	updateRemoteUserUIDDefault: UpdateRemoteUserUIDDefault;
	remoteEnv: Record<string, string>;
	additionalCacheFroms: string[];
	useBuildKit: 'auto' | 'never';
	omitLoggerHeader?: boolean | undefined;
}

export async function launch(options: ProvisionOptions, disposables: (() => Promise<unknown> | undefined)[]) {
	const params = await createDockerParams(options, disposables);
	const output = params.common.output;
	const text = 'Resolving Remote';
	const start = output.start(text);

	const result = await resolve(params, options.configFile, options.overrideConfigFile, options.idLabels);
	output.stop(text, start);
	const { dockerContainerId, composeProjectName } = result;
	return {
		containerId: dockerContainerId!,
		composeProjectName,
		remoteUser: result.properties.user,
		remoteWorkspaceFolder: result.properties.remoteWorkspaceFolder,
		finishBackgroundTasks: async () => {
			try {
				await finishBackgroundTasks(result.params.backgroundTasks);
			} catch (err) {
				output.write(toErrorText(String(err && (err.stack || err.message) || err)));
			}
		},
	};
}

export async function createDockerParams(options: ProvisionOptions, disposables: (() => Promise<unknown> | undefined)[]): Promise<DockerResolverParameters> {
	const { persistedFolder, additionalMounts, updateRemoteUserUIDDefault, containerDataFolder, containerSystemDataFolder, workspaceMountConsistency, mountWorkspaceGitRoot, remoteEnv } = options;
	let parsedAuthority: DevContainerAuthority | undefined;
	if (options.workspaceFolder) {
		parsedAuthority = { hostPath: options.workspaceFolder } as DevContainerAuthority;
	}
	const extensionPath = path.join(__dirname, '..', '..');
	const sessionStart = new Date();
	const pkg = await getPackageConfig(extensionPath);
	const output = createLog(options, pkg, sessionStart, disposables, options.omitLoggerHeader);

	const appRoot = undefined;
	const cwd = options.workspaceFolder || process.cwd();
	const cliHost = await getCLIHost(cwd, loadNativeModule);
	const sessionId = (await promisify(crypto.randomBytes)(20)).toString('hex'); // TODO: Somehow enable correlation.

	const common: ResolverParameters = {
		prebuild: options.prebuild,
		computeExtensionHostEnv: false,
		package: pkg,
		containerDataFolder,
		containerSystemDataFolder,
		appRoot,
		extensionPath, // TODO: rename to packagePath
		sessionId,
		sessionStart,
		cliHost,
		env: cliHost.env,
		cwd,
		isLocalContainer: false,
		progress: () => { },
		output,
		allowSystemConfigChange: true,
		defaultUserEnvProbe: options.defaultUserEnvProbe,
		postCreate: createNullPostCreate(options.postCreateEnabled, options.skipNonBlocking, output),
		getLogLevel: () => options.logLevel,
		onDidChangeLogLevel: () => ({ dispose() { } }),
		loadNativeModule,
		shutdowns: [],
		backgroundTasks: [],
		persistedFolder: persistedFolder || await cliHost.tmpdir(), // Fallback to tmpDir(), even though that isn't 'persistent'
		remoteEnv,
	};

	const dockerPath = options.dockerPath || 'docker';
	const dockerComposePath = options.dockerComposePath || 'docker-compose';
	const dockerComposeCLI = dockerComposeCLIConfig({
		exec: cliHost.exec,
		env: cliHost.env,
		output: common.output,
	}, dockerPath, dockerComposePath);
	const buildKitVersion = options.useBuildKit === 'never' ? null : (await dockerBuildKitVersion({
		cliHost,
		dockerCLI: dockerPath,
		dockerComposeCLI,
		env: cliHost.env,
		output
	}));
	return {
		common,
		parsedAuthority,
		dockerCLI: dockerPath,
		dockerComposeCLI: dockerComposeCLI,
		dockerEnv: cliHost.env,
		workspaceMountConsistencyDefault: workspaceMountConsistency,
		mountWorkspaceGitRoot,
		updateRemoteUserUIDOnMacOS: false,
		cacheMount: 'bind',
		removeOnStartup: options.removeExistingContainer,
		buildNoCache: options.buildNoCache,
		expectExistingContainer: options.expectExistingContainer,
		additionalMounts,
		userRepositoryConfigurationPaths: [],
		updateRemoteUserUIDDefault,
		additionalCacheFroms: options.additionalCacheFroms,
		buildKitVersion,
		isTTY: process.stdin.isTTY || options.logFormat === 'json',
	};
}

export interface LogOptions {
	logLevel: LogLevel;
	logFormat: LogFormat;
	log: (text: string) => void;
	terminalDimensions: LogDimensions | undefined;
}

export function createLog(options: LogOptions, pkg: PackageConfiguration, sessionStart: Date, disposables: (() => Promise<unknown> | undefined)[], omitHeader?: boolean) {
	const header = omitHeader ? undefined : `${pkg.name} ${pkg.version}.`;
	const output = createLogFrom(options, sessionStart, header);
	output.dimensions = options.terminalDimensions;
	disposables.push(() => output.join());
	return output;
}

function createLogFrom({ log: write, logLevel, logFormat }: LogOptions, sessionStart: Date, header: string | undefined = undefined): Log & { join(): Promise<void> } {
	const handler = logFormat === 'json' ? createJSONLog(write, () => logLevel, sessionStart) : createTerminalLog(write, () => logLevel, sessionStart);
	const log = {
		...makeLog(createCombinedLog([handler], header)),
		join: async () => {
			// TODO: wait for write() to finish.
		},
	};
	return log;
}

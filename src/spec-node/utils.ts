/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';
import * as crypto from 'crypto';
import * as os from 'os';

import { ContainerError, toErrorText } from '../spec-common/errors';
import { CLIHost, runCommandNoPty, runCommand, getLocalUsername } from '../spec-common/commonUtils';
import { Log, LogLevel, makeLog, nullLog } from '../spec-utils/log';

import { ContainerProperties, getContainerProperties, ResolverParameters } from '../spec-common/injectHeadless';
import { Workspace } from '../spec-utils/workspaces';
import { URI } from 'vscode-uri';
import { ShellServer } from '../spec-common/shellServer';
import { inspectContainer, inspectImage, getEvents, ContainerDetails, DockerCLIParameters, dockerExecFunction, dockerPtyCLI, dockerPtyExecFunction, toDockerImageName, DockerComposeCLI, ImageDetails, dockerCLI } from '../spec-shutdown/dockerUtils';
import { getRemoteWorkspaceFolder } from './dockerCompose';
import { findGitRootFolder } from '../spec-common/git';
import { parentURI, uriToFsPath } from '../spec-configuration/configurationCommonUtils';
import { DevContainerConfig, DevContainerFromDockerfileConfig, getConfigFilePath, getDockerfilePath } from '../spec-configuration/configuration';
import { StringDecoder } from 'string_decoder';
import { Event } from '../spec-utils/event';
import { Mount } from '../spec-configuration/containerFeaturesConfiguration';
import { PackageConfiguration } from '../spec-utils/product';
import { ImageMetadataEntry } from './imageMetadata';
import { fetchRegistryAuthToken, getManifest, getRef, HEADERS } from '../spec-configuration/containerCollectionsOCI';
import { request } from '../spec-utils/httpRequest';

export { getConfigFilePath, getDockerfilePath, isDockerFileConfig, resolveConfigFilePath } from '../spec-configuration/configuration';
export { uriToFsPath, parentURI } from '../spec-configuration/configurationCommonUtils';
export { CLIHostDocuments, Documents, createDocuments, Edit, fileDocuments, RemoteDocuments } from '../spec-configuration/editableFiles';


export type BindMountConsistency = 'consistent' | 'cached' | 'delegated' | undefined;

export async function uriToWSLFsPath(uri: URI, cliHost: CLIHost): Promise<string> {
	if (uri.scheme === 'file' && cliHost.type === 'wsl') {
		// convert local path (e.g. repository-container Dockerfile) to WSL path
		const { stdout } = await runCommandNoPty({
			exec: cliHost.exec,
			cmd: 'wslpath',
			args: ['-u', uri.fsPath],
			output: nullLog,
		});
		const cliHostPath = stdout.toString().trim();
		return cliHostPath;
	}
	return uriToFsPath(uri, cliHost.platform);
}

export async function logUMask(params: DockerResolverParameters): Promise<string | undefined> {
	// process.umask() is deprecated: https://nodejs.org/api/process.html#processumask
	const { common } = params;
	const { cliHost, output } = common;
	if (cliHost.platform === 'win32') {
		return undefined;
	}
	try {
		const { stdout } = await runCommandNoPty({
			exec: cliHost.exec,
			cmd: 'umask',
			cwd: cliHost.cwd,
			env: cliHost.env,
			output,
			print: true,
		});
		return stdout.toString().trim();
	} catch {
		return undefined;
	}
}

export type ParsedAuthority = DevContainerAuthority;

export type UpdateRemoteUserUIDDefault = 'never' | 'on' | 'off';

export interface DockerResolverParameters {
	common: ResolverParameters;
	parsedAuthority: ParsedAuthority | undefined;
	dockerCLI: string;
	dockerComposeCLI: () => Promise<DockerComposeCLI>;
	dockerEnv: NodeJS.ProcessEnv;
	workspaceMountConsistencyDefault: BindMountConsistency;
	mountWorkspaceGitRoot: boolean;
	updateRemoteUserUIDOnMacOS: boolean;
	cacheMount: 'volume' | 'bind' | 'none';
	removeOnStartup?: boolean | string;
	buildNoCache?: boolean;
	expectExistingContainer?: boolean;
	userRepositoryConfigurationPaths: string[];
	additionalMounts: Mount[];
	updateRemoteUserUIDDefault: UpdateRemoteUserUIDDefault;
	additionalCacheFroms: string[];
	buildKitVersion: string | null;
	isTTY: boolean;
	buildxPlatform: string | undefined;
	buildxPush: boolean;
	buildxOutput: string | undefined;
}

export interface ResolverResult {
	params: ResolverParameters;
	properties: ContainerProperties;
	config: DevContainerConfig | undefined;
	resolvedAuthority: { extensionHostEnv?: { [key: string]: string | null } };
	tunnelInformation: { environmentTunnels?: { remoteAddress: { port: number; host: string }; localAddress: string }[] };
	isTrusted?: boolean;
	dockerParams: DockerResolverParameters | undefined;
	dockerContainerId: string | undefined;
	composeProjectName?: string;
}

export interface SubstitutedConfig<T> {
	config: T;
	raw: T;
	substitute: SubstituteConfig;
}

export type SubstituteConfig = <U extends DevContainerConfig | ImageMetadataEntry>(value: U) => U;

export function addSubstitution<T>(config: SubstitutedConfig<T>, substitute: SubstituteConfig): SubstitutedConfig<T> {
	const substitute0 = config.substitute;
	return {
		config: substitute(config.config),
		raw: config.raw,
		substitute: value => substitute(substitute0(value)),
	};
}

export async function startEventSeen(params: DockerResolverParameters, labels: Record<string, string>, canceled: Promise<void>, output: Log, trace: boolean) {
	const eventsProcess = await getEvents(params, { event: ['start'] });
	return {
		started: new Promise<void>((resolve, reject) => {
			canceled.catch(err => {
				eventsProcess.terminate();
				reject(err);
			});
			const decoder = new StringDecoder('utf8');
			let startPart = '';
			eventsProcess.stdout.on('data', async chunk => {
				if (chunk) {
					const part = decoder.write(chunk);
					if (trace) {
						output.write(`Log: startEventSeen#data ${part.trim().replace(/\r?\n/g, '\r\n')}\r\n`);
					}
					const lines = (startPart + part).split('\n');
					startPart = lines.pop()!;
					for (const line of lines) {
						if (line.trim()) {
							try {
								const info = JSON.parse(line);
								// Docker uses 'status', Podman 'Status'.
								if ((info.status || info.Status) === 'start' && await hasLabels(params, info, labels)) {
									eventsProcess.terminate();
									resolve();
								}
							} catch (e) {
								// Ignore invalid JSON.
								console.error(e);
								console.error(line);
							}
						}
					}
				}
			});
		})
	};
}

async function hasLabels(params: DockerResolverParameters, info: any, expectedLabels: Record<string, string>) {
	const actualLabels = info.Actor?.Attributes
		// Docker uses 'id', Podman 'ID'.
		|| (await inspectContainer(params, info.id || info.ID)).Config.Labels
		|| {};
	return Object.keys(expectedLabels)
		.every(name => actualLabels[name] === expectedLabels[name]);
}

export async function checkDockerSupportForGPU(params: DockerCLIParameters | DockerResolverParameters): Promise<Boolean> {
	const result = await dockerCLI(params, 'info', '-f', '{{.Runtimes.nvidia}}');
	const runtimeFound = result.stdout.includes('nvidia-container-runtime');
	return runtimeFound;
}

export async function inspectDockerImage(params: DockerResolverParameters | DockerCLIParameters, imageName: string, pullImageOnError: boolean) {
	try {
		return await inspectImage(params, imageName);
	} catch (err) {
		if (!pullImageOnError) {
			throw err;
		}
		const output = 'cliHost' in params ? params.output : params.common.output;
		try {
			return await inspectImageInRegistry(output, imageName);
		} catch (err2) {
			output.write(`Error fetching image details: ${err2?.message}`);
		}
		try {
			await dockerPtyCLI(params, 'pull', imageName);
		} catch (_err) {
			if (err.stdout) {
				output.write(err.stdout.toString());
			}
			if (err.stderr) {
				output.write(toErrorText(err.stderr.toString()));
			}
			throw err;
		}
		return inspectImage(params, imageName);
	}
}

export async function inspectImageInRegistry(output: Log, name: string, authToken?: string): Promise<ImageDetails> {
	const resourceAndVersion = qualifyImageName(name);
	const ref = getRef(output, resourceAndVersion);
	if (!ref) {
		throw new Error(`Could not parse image name '${name}'`);
	}
	const auth = authToken ?? await fetchRegistryAuthToken(output, ref.registry, ref.path, process.env, 'pull');

	const registryServer = ref.registry === 'docker.io' ? 'registry-1.docker.io' : ref.registry;
	const manifestUrl = `https://${registryServer}/v2/${ref.path}/manifests/${ref.version}`;
	output.write(`manifest url: ${manifestUrl}`, LogLevel.Trace);
	const manifest = await getManifest(output, process.env, manifestUrl, ref, auth || false, 'application/vnd.docker.distribution.manifest.v2+json');
	if (!manifest) {
		throw new Error(`No manifest found for ${resourceAndVersion}.`);
	}

	const blobUrl = `https://${registryServer}/v2/${ref.path}/blobs/${manifest.config.digest}`;
	output.write(`blob url: ${blobUrl}`, LogLevel.Trace);

	const headers: HEADERS = {
		'user-agent': 'devcontainer',
	};

	if (auth) {
		headers['authorization'] = `Bearer ${auth}`;
	}

	const options = {
		type: 'GET',
		url: blobUrl,
		headers: headers
	};

	const blob = await request(options, output);
	const obj = JSON.parse(blob.toString());
	return {
		Id: manifest.config.digest,
		Config: obj.config,
	};
}

export function qualifyImageName(name: string) {
	const segments = name.split('/');
	if (segments.length === 1) {
		return `docker.io/library/${name}`;
	} else if (segments.length === 2) {
		if (name.startsWith('docker.io/')) {
			return `docker.io/library/${segments[1]}`;
		} else {
			return `docker.io/${name}`;
		}
	} else {
		return name;
	}
}

export interface DevContainerAuthority {
	hostPath: string; // local path of the folder or workspace file
}

export function isDevContainerAuthority(authority: ParsedAuthority): authority is DevContainerAuthority {
	return (authority as DevContainerAuthority).hostPath !== undefined;
}

export async function getHostMountFolder(cliHost: CLIHost, folderPath: string, mountWorkspaceGitRoot: boolean, output: Log): Promise<string> {
	return mountWorkspaceGitRoot && await findGitRootFolder(cliHost, folderPath, output) || folderPath;
}

export interface WorkspaceConfiguration {
	workspaceMount: string | undefined;
	workspaceFolder: string | undefined;
}

export async function getWorkspaceConfiguration(cliHost: CLIHost, workspace: Workspace | undefined, config: DevContainerConfig, mountWorkspaceGitRoot: boolean, output: Log, consistency?: BindMountConsistency): Promise<WorkspaceConfiguration> {
	if ('dockerComposeFile' in config) {
		return {
			workspaceFolder: getRemoteWorkspaceFolder(config),
			workspaceMount: undefined,
		};
	}
	let { workspaceFolder, workspaceMount } = config;
	if (workspace && (!workspaceFolder || !('workspaceMount' in config))) {
		const hostMountFolder = await getHostMountFolder(cliHost, workspace.rootFolderPath, mountWorkspaceGitRoot, output);
		if (!workspaceFolder) {
			const rel = cliHost.path.relative(cliHost.path.dirname(hostMountFolder), workspace.rootFolderPath);
			workspaceFolder = `/workspaces/${cliHost.platform === 'win32' ? rel.replace(/\\/g, '/') : rel}`;
		}
		if (!('workspaceMount' in config)) {
			const containerMountFolder = `/workspaces/${cliHost.path.basename(hostMountFolder)}`;
			const cons = cliHost.platform !== 'linux' ? `,consistency=${consistency || 'consistent'}` : ''; // Podman does not tolerate consistency=
			const srcQuote = hostMountFolder.indexOf(',') !== -1 ? '"' : '';
			const tgtQuote = containerMountFolder.indexOf(',') !== -1 ? '"' : '';
			workspaceMount = `type=bind,${srcQuote}source=${hostMountFolder}${srcQuote},${tgtQuote}target=${containerMountFolder}${tgtQuote}${cons}`;
		}
	}
	return {
		workspaceFolder,
		workspaceMount,
	};
}

export function getTunnelInformation(container: ContainerDetails) /*: vscode.TunnelInformation */ {
	return {
		environmentTunnels: container.Ports.filter(staticPort => !!staticPort.PublicPort)
			.map((port) => {
				return {
					remoteAddress: {
						port: port.PrivatePort,
						host: port.IP
					},
					localAddress: port.IP + ':' + port.PublicPort
				};
			})
	};
}

export function getDockerContextPath(cliHost: { platform: NodeJS.Platform }, config: DevContainerFromDockerfileConfig) {
	const context = 'dockerFile' in config ? config.context : config.build.context;
	if (context) {
		return getConfigFilePath(cliHost, config, context);
	}
	return parentURI(getDockerfilePath(cliHost, config));
}

export async function createContainerProperties(params: DockerResolverParameters, containerId: string, remoteWorkspaceFolder: string | undefined, remoteUser: string | undefined, rootShellServer?: ShellServer) {
	const { common } = params;
	const inspecting = 'Inspecting container';
	const start = common.output.start(inspecting);
	const containerInfo = await inspectContainer(params, containerId);
	common.output.stop(inspecting, start);
	const containerUser = remoteUser || containerInfo.Config.User || 'root';
	const [, user, , group] = /([^:]*)(:(.*))?/.exec(containerUser) as (string | undefined)[];
	const containerEnv = envListToObj(containerInfo.Config.Env);
	const remoteExec = dockerExecFunction(params, containerId, containerUser);
	const remotePtyExec = await dockerPtyExecFunction(params, containerId, containerUser, common.loadNativeModule);
	const remoteExecAsRoot = dockerExecFunction(params, containerId, 'root');
	return getContainerProperties({
		params: common,
		createdAt: containerInfo.Created,
		startedAt: containerInfo.State.StartedAt,
		remoteWorkspaceFolder,
		containerUser: user === '0' ? 'root' : user,
		containerGroup: group,
		containerEnv,
		remoteExec,
		remotePtyExec,
		remoteExecAsRoot,
		rootShellServer,
	});
}

export function envListToObj(list: string[] | null | undefined) {
	// Handle Env is null (https://github.com/microsoft/vscode-remote-release/issues/2058).
	return (list || []).reduce((obj, pair) => {
		const i = pair.indexOf('=');
		if (i !== -1) {
			obj[pair.substring(0, i)] = pair.substring(i + 1);
		}
		return obj;
	}, {} as Record<string, string>);
}

export async function runUserCommand(params: DockerResolverParameters, command: string | string[] | undefined, onDidInput?: Event<string>) {
	if (!command) {
		return;
	}
	const { common, dockerEnv } = params;
	const { cliHost, output } = common;
	const isWindows = cliHost.platform === 'win32';
	const shell = isWindows ? [cliHost.env.ComSpec || 'cmd.exe', '/c'] : ['/bin/sh', '-c'];
	const updatedCommand = isWindows && Array.isArray(command) && command.length ?
		[(command[0] || '').replace(/\//g, '\\'), ...command.slice(1)] :
		command;
	const args = typeof updatedCommand === 'string' ? [...shell, updatedCommand] : updatedCommand;
	if (!args.length) {
		return;
	}
	const postCommandName = 'initializeCommand';
	const infoOutput = makeLog(output, LogLevel.Info);
	try {
		infoOutput.raw(`\x1b[1mRunning the ${postCommandName} from devcontainer.json...\x1b[0m\r\n\r\n`);
		await runCommand({
			ptyExec: cliHost.ptyExec,
			cmd: args[0],
			args: args.slice(1),
			env: dockerEnv,
			output: infoOutput,
			onDidInput,
		});
		infoOutput.raw('\r\n');
	} catch (err) {
		if (err && (err.code === 130 || err.signal === 2)) { // SIGINT seen on darwin as code === 130, would also make sense as signal === 2.
			infoOutput.raw(`\r\n\x1b[1m${postCommandName} interrupted.\x1b[0m\r\n\r\n`);
		} else {
			throw new ContainerError({
				description: `The ${postCommandName} in the devcontainer.json failed.`,
				originalError: err,
			});
		}
	}
}

export function getFolderImageName(params: ResolverParameters | DockerCLIParameters) {
	const { cwd } = 'cwd' in params ? params : params.cliHost;
	const folderHash = getFolderHash(cwd);
	const baseName = path.basename(cwd);
	return toDockerImageName(`vsc-${baseName}-${folderHash}`);
}

export function getFolderHash(fsPath: string): string {
	return crypto.createHash('md5').update(fsPath).digest('hex');
}

export async function createFeaturesTempFolder(params: { cliHost: CLIHost; package: PackageConfiguration }): Promise<string> {
	const { cliHost } = params;
	const { version } = params.package;
	// Create temp folder
	const tmpFolder: string = cliHost.path.join(await getCacheFolder(cliHost), 'container-features', `${version}-${Date.now()}`);
	await cliHost.mkdirp(tmpFolder);
	return tmpFolder;
}

export async function getCacheFolder(cliHost: CLIHost): Promise<string> {
	return cliHost.path.join(await cliHost.tmpdir(), cliHost.platform === 'linux' ? `devcontainercli-${await cliHost.getUsername()}` : 'devcontainercli');
}

export async function getLocalCacheFolder() {
	return path.join(os.tmpdir(), process.platform === 'linux' ? `devcontainercli-${await getLocalUsername()}` : 'devcontainercli');
}

export function getEmptyContextFolder(common: ResolverParameters) {
	return common.cliHost.path.join(common.persistedFolder, 'empty-folder');
}

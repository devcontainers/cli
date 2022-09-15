/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';
import * as fs from 'fs';
import { StringDecoder } from 'string_decoder';
import * as crypto from 'crypto';
import { promisify } from 'util';

import { ContainerError, toErrorText, toWarningText } from './errors';
import { launch, ShellServer } from './shellServer';
import { ExecFunction, CLIHost, PtyExecFunction, isFile } from './commonUtils';
import { Event, NodeEventEmitter } from '../spec-utils/event';
import { PackageConfiguration } from '../spec-utils/product';
import { URI } from 'vscode-uri';
import { containerSubstitute } from './variableSubstitution';
import { delay } from './async';
import { Log, LogEvent, LogLevel, makeLog, nullLog } from '../spec-utils/log';
import { buildProcessTrees, findProcesses, Process, processTreeToString } from './proc';

export enum ResolverProgress {
	Begin,
	CloningRepository,
	BuildingImage,
	StartingContainer,
	InstallingServer,
	StartingServer,
	End,
}

export interface ResolverParameters {
	prebuild?: boolean;
	computeExtensionHostEnv: boolean;
	package: PackageConfiguration;
	containerDataFolder: string | undefined;
	containerSystemDataFolder: string | undefined;
	appRoot: string | undefined;
	extensionPath: string;
	sessionId: string;
	sessionStart: Date;
	cliHost: CLIHost;
	env: NodeJS.ProcessEnv;
	cwd: string;
	isLocalContainer: boolean;
	progress: (current: ResolverProgress) => void;
	output: Log;
	allowSystemConfigChange: boolean;
	defaultUserEnvProbe: UserEnvProbe;
	postCreate: PostCreate;
	getLogLevel: () => LogLevel;
	onDidChangeLogLevel: Event<LogLevel>;
	loadNativeModule: <T>(moduleName: string) => Promise<T | undefined>;
	shutdowns: (() => Promise<void>)[];
	backgroundTasks: (Promise<void> | (() => Promise<void>))[];
	persistedFolder: string; // A path where config can be persisted and restored at a later time. Should default to tmpdir() folder if not provided.
	remoteEnv: Record<string, string>;
	buildxPlatform: string | undefined;
	buildxPush: boolean;
	skipFeatureAutoMapping: boolean;
	experimentalImageMetadata: boolean;
}

export interface PostCreate {
	enabled: boolean;
	skipNonBlocking: boolean;
	output: Log;
	onDidInput: Event<string>;
	done: () => void;
}

export function createNullPostCreate(enabled: boolean, skipNonBlocking: boolean, output: Log): PostCreate {
	function listener(data: Buffer) {
		emitter.fire(data.toString());
	}
	const emitter = new NodeEventEmitter<string>({
		on: () => process.stdin.on('data', listener),
		off: () => process.stdin.off('data', listener),
	});
	process.stdin.setEncoding('utf8');
	return {
		enabled,
		skipNonBlocking,
		output: makeLog({
			...output,
			get dimensions() {
				return output.dimensions;
			},
			event: e => output.event({
				...e,
				channel: 'postCreate',
			}),
		}),
		onDidInput: emitter.event,
		done: () => { },
	};
}

export interface PortAttributes {
	label: string | undefined;
	onAutoForward: string | undefined;
	elevateIfNeeded: boolean | undefined;
}

export type UserEnvProbe = 'none' | 'loginInteractiveShell' | 'interactiveShell' | 'loginShell';

export type DevContainerConfigCommand = 'initializeCommand' | 'onCreateCommand' | 'updateContentCommand' | 'postCreateCommand' | 'postStartCommand' | 'postAttachCommand';

const defaultWaitFor: DevContainerConfigCommand = 'updateContentCommand';

export interface CommonDevContainerConfig {
	configFilePath?: URI;
	remoteEnv?: Record<string, string | null>;
	forwardPorts?: (number | string)[];
	portsAttributes?: Record<string, PortAttributes>;
	otherPortsAttributes?: PortAttributes;
	features?: Record<string, string | boolean | Record<string, string | boolean>>;
	onCreateCommand?: string | string[];
	updateContentCommand?: string | string[];
	postCreateCommand?: string | string[];
	postStartCommand?: string | string[];
	postAttachCommand?: string | string[];
	waitFor?: DevContainerConfigCommand;
	userEnvProbe?: UserEnvProbe;
}

export interface OSRelease {
	hardware: string;
	id: string;
	version: string;
}

export interface ContainerProperties {
	createdAt: string | undefined;
	startedAt: string | undefined;
	osRelease: OSRelease;
	user: string;
	gid: string | undefined;
	env: NodeJS.ProcessEnv;
	shell: string;
	homeFolder: string;
	userDataFolder: string;
	remoteWorkspaceFolder?: string;
	remoteExec: ExecFunction;
	remotePtyExec: PtyExecFunction;
	remoteExecAsRoot?: ExecFunction;
	shellServer: ShellServer;
	launchRootShellServer?: () => Promise<ShellServer>;
}

export async function getContainerProperties(options: {
	params: ResolverParameters;
	createdAt: string | undefined;
	startedAt: string | undefined;
	remoteWorkspaceFolder: string | undefined;
	containerUser: string | undefined;
	containerGroup: string | undefined;
	containerEnv: NodeJS.ProcessEnv | undefined;
	remoteExec: ExecFunction;
	remotePtyExec: PtyExecFunction;
	remoteExecAsRoot: ExecFunction | undefined;
	rootShellServer: ShellServer | undefined;
}) {
	let { params, createdAt, startedAt, remoteWorkspaceFolder, containerUser, containerGroup, containerEnv, remoteExec, remotePtyExec, remoteExecAsRoot, rootShellServer } = options;
	let shellServer: ShellServer;
	if (rootShellServer && containerUser === 'root') {
		shellServer = rootShellServer;
	} else {
		shellServer = await launch(remoteExec, params.output, params.sessionId);
	}
	if (!containerEnv) {
		const PATH = (await shellServer.exec('echo $PATH')).stdout.trim();
		containerEnv = PATH ? { PATH } : {};
	}
	if (!containerUser) {
		containerUser = await getUser(shellServer);
	}
	if (!remoteExecAsRoot && containerUser === 'root') {
		remoteExecAsRoot = remoteExec;
	}
	const osRelease = await getOSRelease(shellServer);
	const passwdUser = await getUserFromEtcPasswd(shellServer, containerUser);
	if (!passwdUser) {
		params.output.write(toWarningText(`User ${containerUser} not found in /etc/passwd.`));
	}
	const shell = await getUserShell(containerEnv, passwdUser);
	const homeFolder = await getHomeFolder(containerEnv, passwdUser);
	const userDataFolder = getUserDataFolder(homeFolder, params);
	let rootShellServerP: Promise<ShellServer> | undefined;
	if (rootShellServer) {
		rootShellServerP = Promise.resolve(rootShellServer);
	} else if (containerUser === 'root') {
		rootShellServerP = Promise.resolve(shellServer);
	}
	const containerProperties: ContainerProperties = {
		createdAt,
		startedAt,
		osRelease,
		user: containerUser,
		gid: containerGroup || passwdUser?.gid,
		env: containerEnv,
		shell,
		homeFolder,
		userDataFolder,
		remoteWorkspaceFolder,
		remoteExec,
		remotePtyExec,
		remoteExecAsRoot,
		shellServer,
	};
	if (rootShellServerP || remoteExecAsRoot) {
		containerProperties.launchRootShellServer = () => rootShellServerP || (rootShellServerP = launch(remoteExecAsRoot!, params.output));
	}
	return containerProperties;
}

export async function getUser(shellServer: ShellServer) {
	return (await shellServer.exec('id -un')).stdout.trim();
}

export async function getHomeFolder(containerEnv: NodeJS.ProcessEnv, passwdUser: PasswdUser | undefined) {
	return containerEnv.HOME || (passwdUser && passwdUser.home) || '/root';
}

async function getUserShell(containerEnv: NodeJS.ProcessEnv, passwdUser: PasswdUser | undefined) {
	return containerEnv.SHELL || (passwdUser && passwdUser.shell) || '/bin/sh';
}

export async function getUserFromEtcPasswd(shellServer: ShellServer, userNameOrId: string) {
	const { stdout } = await shellServer.exec('cat /etc/passwd', { logOutput: false });
	return findUserInEtcPasswd(stdout, userNameOrId);
}

export interface PasswdUser {
	name: string;
	uid: string;
	gid: string;
	home: string;
	shell: string;
}

export function findUserInEtcPasswd(etcPasswd: string, nameOrId: string): PasswdUser | undefined {
	const users = etcPasswd
		.split(/\r?\n/)
		.map(line => line.split(':'))
		.map(row => ({
			name: row[0],
			uid: row[2],
			gid: row[3],
			home: row[5],
			shell: row[6]
		}));
	return users.find(user => user.name === nameOrId || user.uid === nameOrId);
}

export function getUserDataFolder(homeFolder: string, params: ResolverParameters) {
	return path.posix.resolve(homeFolder, params.containerDataFolder || '.devcontainer');
}

export function getSystemVarFolder(params: ResolverParameters): string {
	return params.containerSystemDataFolder || '/var/devcontainer';
}

export async function setupInContainer(params: ResolverParameters, containerProperties: ContainerProperties, config: CommonDevContainerConfig) {
	await patchEtcEnvironment(params, containerProperties);
	await patchEtcProfile(params, containerProperties);
	const computeRemoteEnv = params.computeExtensionHostEnv || params.postCreate.enabled;
	const updatedConfig = containerSubstitute(params.cliHost.platform, config.configFilePath, containerProperties.env, config);
	const remoteEnv = computeRemoteEnv ? probeRemoteEnv(params, containerProperties, updatedConfig) : Promise.resolve({});
	if (params.postCreate.enabled) {
		await runPostCreateCommands(params, containerProperties, updatedConfig, remoteEnv, false);
	}
	return {
		remoteEnv: params.computeExtensionHostEnv ? await remoteEnv : {},
	};
}

export function probeRemoteEnv(params: ResolverParameters, containerProperties: ContainerProperties, config: CommonDevContainerConfig) {
	return probeUserEnv(params, containerProperties, config)
		.then<Record<string, string>>(shellEnv => ({
			...shellEnv,
			...params.remoteEnv,
			...config.remoteEnv,
		} as Record<string, string>));
}

export async function runPostCreateCommands(params: ResolverParameters, containerProperties: ContainerProperties, config: CommonDevContainerConfig, remoteEnv: Promise<Record<string, string>>, stopForPersonalization: boolean): Promise<'skipNonBlocking' | 'prebuild' | 'stopForPersonalization' | 'done'> {
	const skipNonBlocking = params.postCreate.skipNonBlocking;
	const waitFor = config.waitFor || defaultWaitFor;
	if (skipNonBlocking && waitFor === 'initializeCommand') {
		return 'skipNonBlocking';
	}

	await runPostCreateCommand(params, containerProperties, config, 'onCreateCommand', remoteEnv, false);
	if (skipNonBlocking && waitFor === 'onCreateCommand') {
		return 'skipNonBlocking';
	}

	await runPostCreateCommand(params, containerProperties, config, 'updateContentCommand', remoteEnv, !!params.prebuild);
	if (skipNonBlocking && waitFor === 'updateContentCommand') {
		return 'skipNonBlocking';
	}

	if (params.prebuild) {
		return 'prebuild';
	}

	await runPostCreateCommand(params, containerProperties, config, 'postCreateCommand', remoteEnv, false);
	if (skipNonBlocking && waitFor === 'postCreateCommand') {
		return 'skipNonBlocking';
	}

	if (stopForPersonalization) {
		return 'stopForPersonalization';
	}

	await runPostStartCommand(params, containerProperties, config, remoteEnv);
	if (skipNonBlocking && waitFor === 'postStartCommand') {
		return 'skipNonBlocking';
	}

	await runPostAttachCommand(params, containerProperties, config, remoteEnv);
	return 'done';
}

export async function getOSRelease(shellServer: ShellServer) {
	let hardware = 'unknown';
	let id = 'unknown';
	let version = 'unknown';
	try {
		hardware = (await shellServer.exec('uname -m')).stdout.trim();
		const { stdout } = await shellServer.exec('(cat /etc/os-release || cat /usr/lib/os-release) 2>/dev/null');
		id = (stdout.match(/^ID=([^\u001b\r\n]*)/m) || [])[1] || 'notfound';
		version = (stdout.match(/^VERSION_ID=([^\u001b\r\n]*)/m) || [])[1] || 'notfound';
	} catch (err) {
		console.error(err);
		// Optimistically continue.
	}
	return { hardware, id, version };
}

async function runPostCreateCommand(params: ResolverParameters, containerProperties: ContainerProperties, config: CommonDevContainerConfig, postCommandName: 'onCreateCommand' | 'updateContentCommand' | 'postCreateCommand', remoteEnv: Promise<Record<string, string>>, rerun: boolean) {
	const markerFile = path.posix.join(containerProperties.userDataFolder, `.${postCommandName}Marker`);
	const doRun = !!containerProperties.createdAt && await updateMarkerFile(containerProperties.shellServer, markerFile, containerProperties.createdAt) || rerun;
	await runPostCommand(params, containerProperties, config, postCommandName, remoteEnv, doRun);
}

async function runPostStartCommand(params: ResolverParameters, containerProperties: ContainerProperties, config: CommonDevContainerConfig, remoteEnv: Promise<Record<string, string>>) {
	const markerFile = path.posix.join(containerProperties.userDataFolder, '.postStartCommandMarker');
	const doRun = !!containerProperties.startedAt && await updateMarkerFile(containerProperties.shellServer, markerFile, containerProperties.startedAt);
	await runPostCommand(params, containerProperties, config, 'postStartCommand', remoteEnv, doRun);
}

async function updateMarkerFile(shellServer: ShellServer, location: string, content: string) {
	try {
		await shellServer.exec(`mkdir -p '${path.posix.dirname(location)}' && CONTENT="$(cat '${location}' 2>/dev/null || echo ENOENT)" && [ "\${CONTENT:-${content}}" != '${content}' ] && echo '${content}' > '${location}'`);
		return true;
	} catch (err) {
		return false;
	}
}

async function runPostAttachCommand(params: ResolverParameters, containerProperties: ContainerProperties, config: CommonDevContainerConfig, remoteEnv: Promise<Record<string, string>>) {
	await runPostCommand(params, containerProperties, config, 'postAttachCommand', remoteEnv, true);
}

async function runPostCommand({ postCreate }: ResolverParameters, containerProperties: ContainerProperties, config: CommonDevContainerConfig, postCommandName: 'onCreateCommand' | 'updateContentCommand' | 'postCreateCommand' | 'postStartCommand' | 'postAttachCommand', remoteEnv: Promise<Record<string, string>>, doRun: boolean) {
	const postCommand = config[postCommandName];
	if (doRun && postCommand && (typeof postCommand === 'string' ? postCommand.trim() : postCommand.length)) {
		const progressName = `Running ${postCommandName}...`;
		const progressDetail = typeof postCommand === 'string' ? postCommand : postCommand.join(' ');
		const infoOutput = makeLog({
			event(e: LogEvent) {
				postCreate.output.event(e);
				if (e.type === 'raw' && e.text.includes('::endstep::')) {
					postCreate.output.event({
						type: 'progress',
						name: progressName,
						status: 'running',
						stepDetail: ''
					});
				}
				if (e.type === 'raw' && e.text.includes('::step::')) {
					postCreate.output.event({
						type: 'progress',
						name: progressName,
						status: 'running',
						stepDetail: `${e.text.split('::step::')[1].split('\r\n')[0]}`
					});
				}
			},
			get dimensions() {
				return postCreate.output.dimensions;
			},
			onDidChangeDimensions: postCreate.output.onDidChangeDimensions,
		}, LogLevel.Info);
		try {
			infoOutput.event({
				type: 'progress',
				name: progressName,
				status: 'running',
				stepDetail: progressDetail
			});
			const remoteCwd = containerProperties.remoteWorkspaceFolder || containerProperties.homeFolder;
			infoOutput.raw(`\x1b[1mRunning the ${postCommandName} from devcontainer.json...\x1b[0m\r\n\r\n`);
			await runRemoteCommand({ ...postCreate, output: infoOutput }, containerProperties, typeof postCommand === 'string' ? ['/bin/sh', '-c', postCommand] : postCommand, remoteCwd, { remoteEnv: await remoteEnv, print: 'continuous' });
			infoOutput.raw('\r\n');
			infoOutput.event({
				type: 'progress',
				name: progressName,
				status: 'succeeded',
			});
		} catch (err) {
			infoOutput.event({
				type: 'progress',
				name: progressName,
				status: 'failed',
			});
			if (err && (err.code === 130 || err.signal === 2)) { // SIGINT seen on darwin as code === 130, would also make sense as signal === 2.
				infoOutput.raw(`\r\n\x1b[1m${postCommandName} interrupted.\x1b[0m\r\n\r\n`);
			} else {
				if (err?.code) {
					infoOutput.write(toErrorText(`${postCommandName} failed with exit code ${err.code}. Skipping any further user-provided commands.`));
				}
				throw new ContainerError({
					description: `The ${postCommandName} in the devcontainer.json failed.`,
					originalError: err,
				});
			}
		}
	}
}

async function createFile(shellServer: ShellServer, location: string) {
	try {
		await shellServer.exec(createFileCommand(location));
		return true;
	} catch (err) {
		return false;
	}
}

function createFileCommand(location: string) {
	return `test ! -f '${location}' && set -o noclobber && mkdir -p '${path.posix.dirname(location)}' && { > '${location}' ; } 2> /dev/null`;
}

export async function runRemoteCommand(params: { output: Log; onDidInput?: Event<string> }, { remotePtyExec }: { remotePtyExec: PtyExecFunction }, cmd: string[], cwd?: string, options: { remoteEnv?: NodeJS.ProcessEnv; stdin?: Buffer | fs.ReadStream; silent?: boolean; print?: 'off' | 'continuous' | 'end'; resolveOn?: RegExp } = {}) {
	const print = options.print || (options.silent ? 'off' : 'end');
	const p = await remotePtyExec({
		env: options.remoteEnv,
		cwd,
		cmd: cmd[0],
		args: cmd.slice(1),
		output: options.silent ? nullLog : params.output,
	});
	let cmdOutput = '';
	let doResolveEarly: () => void;
	const resolveEarly = new Promise<void>(resolve => {
		doResolveEarly = resolve;
	});
	p.onData(chunk => {
		cmdOutput += chunk;
		if (print === 'continuous') {
			params.output.raw(chunk);
		}
		if (options.resolveOn && options.resolveOn.exec(cmdOutput)) {
			doResolveEarly();
		}
	});
	const sub = params.onDidInput && params.onDidInput(data => p.write(data));
	const exit = await Promise.race([p.exit, resolveEarly]);
	if (sub) {
		sub.dispose();
	}
	if (print === 'end') {
		params.output.raw(cmdOutput);
	}
	if (exit && (exit.code || exit.signal)) {
		return Promise.reject({
			message: `Command failed: ${cmd.join(' ')}`,
			cmdOutput,
			code: exit.code,
			signal: exit.signal,
		});
	}
	return {
		cmdOutput,
	};
}

async function runRemoteCommandNoPty(params: { output: Log }, { remoteExec }: { remoteExec: ExecFunction }, cmd: string[], cwd?: string, options: { remoteEnv?: NodeJS.ProcessEnv; stdin?: Buffer | fs.ReadStream; silent?: boolean; print?: 'off' | 'continuous' | 'end'; resolveOn?: RegExp } = {}) {
	const print = options.print || (options.silent ? 'off' : 'end');
	const p = await remoteExec({
		env: options.remoteEnv,
		cwd,
		cmd: cmd[0],
		args: cmd.slice(1),
		output: options.silent ? nullLog : params.output,
	});
	const stdout: Buffer[] = [];
	const stderr: Buffer[] = [];
	const stdoutDecoder = new StringDecoder();
	const stderrDecoder = new StringDecoder();
	let stdoutStr = '';
	let stderrStr = '';
	let doResolveEarly: () => void;
	let doRejectEarly: (err: any) => void;
	const resolveEarly = new Promise<void>((resolve, reject) => {
		doResolveEarly = resolve;
		doRejectEarly = reject;
	});
	p.stdout.on('data', (chunk: Buffer) => {
		stdout.push(chunk);
		const str = stdoutDecoder.write(chunk);
		if (print === 'continuous') {
			params.output.write(str.replace(/\r?\n/g, '\r\n'));
		}
		stdoutStr += str;
		if (options.resolveOn && options.resolveOn.exec(stdoutStr)) {
			doResolveEarly();
		}
	});
	p.stderr.on('data', (chunk: Buffer) => {
		stderr.push(chunk);
		stderrStr += stderrDecoder.write(chunk);
	});
	if (options.stdin instanceof Buffer) {
		p.stdin.write(options.stdin, err => {
			if (err) {
				doRejectEarly(err);
			}
		});
		p.stdin.end();
	} else if (options.stdin instanceof fs.ReadStream) {
		options.stdin.pipe(p.stdin);
	}
	const exit = await Promise.race([p.exit, resolveEarly]);
	const stdoutBuf = Buffer.concat(stdout);
	const stderrBuf = Buffer.concat(stderr);
	if (print === 'end') {
		params.output.write(stdoutStr.replace(/\r?\n/g, '\r\n'));
		params.output.write(toErrorText(stderrStr));
	}
	const cmdOutput = `${stdoutStr}\n${stderrStr}`;
	if (exit && (exit.code || exit.signal)) {
		return Promise.reject({
			message: `Command failed: ${cmd.join(' ')}`,
			cmdOutput,
			stdout: stdoutBuf,
			stderr: stderrBuf,
			code: exit.code,
			signal: exit.signal,
		});
	}
	return {
		cmdOutput,
		stdout: stdoutBuf,
		stderr: stderrBuf,
	};
}

async function patchEtcEnvironment(params: ResolverParameters, containerProperties: ContainerProperties) {
	const markerFile = path.posix.join(getSystemVarFolder(params), `.patchEtcEnvironmentMarker`);
	if (params.allowSystemConfigChange && containerProperties.launchRootShellServer && !(await isFile(containerProperties.shellServer, markerFile))) {
		const rootShellServer = await containerProperties.launchRootShellServer();
		if (await createFile(rootShellServer, markerFile)) {
			await rootShellServer.exec(`cat >> /etc/environment <<'etcEnvrionmentEOF'
${Object.keys(containerProperties.env).map(k => `\n${k}="${containerProperties.env[k]}"`).join('')}
etcEnvrionmentEOF
`);
		}
	}
}

async function patchEtcProfile(params: ResolverParameters, containerProperties: ContainerProperties) {
	const markerFile = path.posix.join(getSystemVarFolder(params), `.patchEtcProfileMarker`);
	if (params.allowSystemConfigChange && containerProperties.launchRootShellServer && !(await isFile(containerProperties.shellServer, markerFile))) {
		const rootShellServer = await containerProperties.launchRootShellServer();
		if (await createFile(rootShellServer, markerFile)) {
			await rootShellServer.exec(`sed -i -E 's/((^|\\s)PATH=)([^\\$]*)$/\\1\${PATH:-\\3}/g' /etc/profile || true`);
		}
	}
}

async function probeUserEnv(params: { defaultUserEnvProbe: UserEnvProbe; allowSystemConfigChange: boolean; output: Log }, containerProperties: { shell: string; remoteExec: ExecFunction; installFolder?: string; env?: NodeJS.ProcessEnv; shellServer?: ShellServer; launchRootShellServer?: (() => Promise<ShellServer>); user?: string }, config?: { userEnvProbe?: UserEnvProbe }) {
	const env = await runUserEnvProbe(params, containerProperties, config, 'cat /proc/self/environ', '\0');
	if (env) {
		return env;
	}
	params.output.write('userEnvProbe: falling back to printenv');
	const env2 = await runUserEnvProbe(params, containerProperties, config, 'printenv', '\n');
	return env2 || {};
}

async function runUserEnvProbe(params: { defaultUserEnvProbe: UserEnvProbe; allowSystemConfigChange: boolean; output: Log }, containerProperties: { shell: string; remoteExec: ExecFunction; installFolder?: string; env?: NodeJS.ProcessEnv; shellServer?: ShellServer; launchRootShellServer?: (() => Promise<ShellServer>); user?: string }, config: { userEnvProbe?: UserEnvProbe } | undefined, cmd: string, sep: string) {
	let { userEnvProbe } = config || {};
	params.output.write(`userEnvProbe: ${userEnvProbe || params.defaultUserEnvProbe}${userEnvProbe ? '' : ' (default)'}`);
	if (!userEnvProbe) {
		userEnvProbe = params.defaultUserEnvProbe;
	}
	if (userEnvProbe === 'none') {
		return {};
	}
	try {
		// From VS Code's shellEnv.ts

		const buffer = await promisify(crypto.randomBytes)(16);
		const mark = buffer.toString('hex');
		const regex = new RegExp(mark + '([^]*)' + mark);
		const systemShellUnix = containerProperties.shell;
		params.output.write(`userEnvProbe shell: ${systemShellUnix}`);

		// handle popular non-POSIX shells
		const name = path.posix.basename(systemShellUnix);
		const command = `echo -n ${mark}; ${cmd}; echo -n ${mark}`;
		let shellArgs: string[];
		if (/^pwsh(-preview)?$/.test(name)) {
			shellArgs = userEnvProbe === 'loginInteractiveShell' || userEnvProbe === 'loginShell' ?
				['-Login', '-Command'] : // -Login must be the first option.
				['-Command'];
		} else {
			shellArgs = [
				userEnvProbe === 'loginInteractiveShell' ? '-lic' :
					userEnvProbe === 'loginShell' ? '-lc' :
						userEnvProbe === 'interactiveShell' ? '-ic' :
							'-c'
			];
		}

		const traceOutput = makeLog(params.output, LogLevel.Trace);
		const resultP = runRemoteCommandNoPty({ output: traceOutput }, { remoteExec: containerProperties.remoteExec }, [systemShellUnix, ...shellArgs, command], containerProperties.installFolder);
		Promise.race([resultP, delay(2000)])
			.then(async result => {
				if (!result) {
					let processes: Process[];
					const shellServer = containerProperties.shellServer || await launch(containerProperties.remoteExec, params.output);
					try {
						({ processes } = await findProcesses(shellServer));
					} finally {
						if (!containerProperties.shellServer) {
							await shellServer.process.terminate();
						}
					}
					const shell = processes.find(p => p.cmd.startsWith(systemShellUnix) && p.cmd.indexOf(mark) !== -1);
					if (shell) {
						const index = buildProcessTrees(processes);
						const tree = index[shell.pid];
						params.output.write(`userEnvProbe is taking longer than 2 seconds. Process tree:
${processTreeToString(tree)}`);
					} else {
						params.output.write(`userEnvProbe is taking longer than 2 seconds. Process not found.`);
					}
				}
			}, () => undefined)
			.catch(err => params.output.write(toErrorText(err && (err.stack || err.message) || 'Error reading process tree.')));
		const result = await Promise.race([resultP, delay(10000)]);
		if (!result) {
			params.output.write(toErrorText(`userEnvProbe is taking longer than 10 seconds. Avoid waiting for user input in your shell's startup scripts. Continuing.`));
			return {};
		}
		const raw = result.stdout.toString();
		const match = regex.exec(raw);
		const rawStripped = match ? match[1] : '';
		if (!rawStripped) {
			return undefined; // assume error
		}
		const env = rawStripped.split(sep)
			.reduce((env, e) => {
				const i = e.indexOf('=');
				if (i !== -1) {
					env[e.substring(0, i)] = e.substring(i + 1);
				}
				return env;
			}, {} as Record<string, string>);
		params.output.write(`userEnvProbe parsed: ${JSON.stringify(env, undefined, '  ')}`, LogLevel.Trace);
		delete env.PWD;

		const shellPath = env.PATH;
		const containerPath = containerProperties.env?.PATH;
		const doMergePaths = !(params.allowSystemConfigChange && containerProperties.launchRootShellServer) && shellPath && containerPath;
		if (doMergePaths) {
			const user = containerProperties.user;
			env.PATH = mergePaths(shellPath, containerPath!, user === 'root' || user === '0');
		}
		params.output.write(`userEnvProbe PATHs:
Probe:     ${typeof shellPath === 'string' ? `'${shellPath}'` : 'None'}
Container: ${typeof containerPath === 'string' ? `'${containerPath}'` : 'None'}${doMergePaths ? `
Merged:    ${typeof env.PATH === 'string' ? `'${env.PATH}'` : 'None'}` : ''}`);

		return env;
	} catch (err) {
		params.output.write(toErrorText(err && (err.stack || err.message) || 'Error reading shell environment.'));
		return {};
	}
}

function mergePaths(shellPath: string, containerPath: string, rootUser: boolean) {
	const result = shellPath.split(':');
	let insertAt = 0;
	for (const entry of containerPath.split(':')) {
		const i = result.indexOf(entry);
		if (i === -1) {
			if (rootUser || !/\/sbin(\/|$)/.test(entry)) {
				result.splice(insertAt++, 0, entry);
			}
		} else {
			insertAt = i + 1;
		}
	}
	return result.join(':');
}

export async function finishBackgroundTasks(tasks: (Promise<void> | (() => Promise<void>))[]) {
	for (const task of tasks) {
		await (typeof task === 'function' ? task() : task);
	}
}
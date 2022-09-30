/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CLIHost, runCommand, runCommandNoPty, ExecFunction, ExecParameters, Exec, PtyExecFunction, PtyExec, PtyExecParameters } from '../spec-common/commonUtils';
import { toErrorText } from '../spec-common/errors';
import * as ptyType from 'node-pty';
import { Log, makeLog } from '../spec-utils/log';
import { Event } from '../spec-utils/event';

export interface ContainerDetails {
	Id: string;
	Created: string;
	Name: string;
	State: {
		Status: string;
		StartedAt: string;
		FinishedAt: string;
	};
	Config: {
		Image: string;
		User: string;
		Env: string[] | null;
		Labels: Record<string, string | undefined> | null;
	};
	Mounts: {
		Type: string;
		Name?: string;
		Source: string;
		Destination: string;
	}[];
	NetworkSettings: {
		Ports: Record<string, {
			HostIp: string;
			HostPort: string;
		}[] | null>;
	};
	Ports: {
		IP: string;
		PrivatePort: number;
		PublicPort: number;
		Type: string;
	}[];
}

export interface DockerCLIParameters {
	cliHost: CLIHost;
	dockerCLI: string;
	dockerComposeCLI: () => Promise<DockerComposeCLI>;
	env: NodeJS.ProcessEnv;
	output: Log;
}

export interface PartialExecParameters {
	exec: ExecFunction;
	cmd: string;
	args?: string[];
	env: NodeJS.ProcessEnv;
	output: Log;
	print?: boolean | 'continuous' | 'onerror';
}

export interface PartialPtyExecParameters {
	ptyExec: PtyExecFunction;
	cmd: string;
	args?: string[];
	env: NodeJS.ProcessEnv;
	output: Log;
	onDidInput?: Event<string>;
}

interface DockerResolverParameters {
	dockerCLI: string;
	dockerComposeCLI: () => Promise<DockerComposeCLI>;
	dockerEnv: NodeJS.ProcessEnv;
	common: {
		cliHost: CLIHost;
		output: Log;
	};
}

export interface DockerComposeCLI {
	version: string;
	cmd: string;
	args: string[];
}

export async function inspectContainer(params: DockerCLIParameters | PartialExecParameters | DockerResolverParameters, id: string): Promise<ContainerDetails> {
	return (await inspectContainers(params, [id]))[0];
}

export async function inspectContainers(params: DockerCLIParameters | PartialExecParameters | DockerResolverParameters, ids: string[]): Promise<ContainerDetails[]> {
	const results = await inspect<ContainerDetails>(params, 'container', ids);
	for (const result of results) {
		result.Ports = [];
		const rawPorts = result.NetworkSettings.Ports;
		for (const privatePortAndType in rawPorts) {
			const [PrivatePort, Type] = privatePortAndType.split('/');
			for (const targetPort of rawPorts[privatePortAndType] || []) {
				const { HostIp: IP, HostPort: PublicPort } = targetPort;
				result.Ports.push({
					IP,
					PrivatePort: parseInt(PrivatePort),
					PublicPort: parseInt(PublicPort),
					Type
				});
			}
		}
	}
	return results;
}

export interface ImageDetails {
	Id: string;
	Config: {
		User: string;
		Env: string[] | null;
		Labels: Record<string, string | undefined> | null;
		Entrypoint: string[] | null;
		Cmd: string[] | null;
	};
}

export async function inspectImage(params: DockerCLIParameters | PartialExecParameters | DockerResolverParameters, id: string): Promise<ImageDetails> {
	return (await inspect<ImageDetails>(params, 'image', [id]))[0];
}

export interface VolumeDetails {
	Name: string;
	CreatedAt: string;
	Labels: Record<string, string> | null;
}

export async function inspectVolume(params: DockerCLIParameters | PartialExecParameters | DockerResolverParameters, name: string): Promise<VolumeDetails> {
	return (await inspect<VolumeDetails>(params, 'volume', [name]))[0];
}

export async function inspectVolumes(params: DockerCLIParameters | PartialExecParameters | DockerResolverParameters, names: string[]): Promise<VolumeDetails[]> {
	return inspect<VolumeDetails>(params, 'volume', names);
}

async function inspect<T>(params: DockerCLIParameters | PartialExecParameters | DockerResolverParameters, type: 'container' | 'image' | 'volume', ids: string[]): Promise<T[]> {
	if (!ids.length) {
		return [];
	}
	const partial = toExecParameters(params);
	const result = await runCommandNoPty({
		...partial,
		args: (partial.args || []).concat(['inspect', '--type', type, ...ids]),
	});
	try {
		return JSON.parse(result.stdout.toString());
	} catch (err) {
		console.error({
			stdout: result.stdout.toString(),
			stderr: result.stderr.toString(),
		});
		throw err;
	}
}

export async function listContainers(params: DockerCLIParameters | PartialExecParameters | DockerResolverParameters, all = false, labels: string[] = []) {
	const filterArgs = [];
	if (all) {
		filterArgs.push('-a');
	}
	for (const label of labels) {
		filterArgs.push('--filter', `label=${label}`);
	}
	const result = await dockerCLI(params, 'ps', '-q', ...filterArgs);
	return result.stdout
		.toString()
		.split(/\r?\n/)
		.filter(s => !!s);
}

export async function listVolumes(params: DockerCLIParameters | PartialExecParameters | DockerResolverParameters, labels: string[] = []) {
	const filterArgs = [];
	for (const label of labels) {
		filterArgs.push('--filter', `label=${label}`);
	}
	const result = await dockerCLI(params, 'volume', 'ls', '-q', ...filterArgs);
	return result.stdout
		.toString()
		.split(/\r?\n/)
		.filter(s => !!s);
}

export async function createVolume(params: DockerCLIParameters | PartialExecParameters | DockerResolverParameters, name: string, labels: string[]) {
	const labelArgs: string[] = [];
	for (const label of labels) {
		labelArgs.push('--label', label);
	}
	await dockerCLI(params, 'volume', 'create', ...labelArgs, name);
}

export async function getEvents(params: DockerCLIParameters | DockerResolverParameters, filters?: Record<string, string[]>) {
	const { exec, cmd, args, env, output } = toExecParameters(params);
	const filterArgs = [];
	for (const filter in filters) {
		for (const value of filters[filter]) {
			filterArgs.push('--filter', `${filter}=${value}`);
		}
	}
	const format = await isPodman(params) ? 'json' : '{{json .}}'; // https://github.com/containers/libpod/issues/5981
	const combinedArgs = (args || []).concat(['events', '--format', format, ...filterArgs]);

	const p = await exec({
		cmd,
		args: combinedArgs,
		env,
		output,
	});

	const stderr: Buffer[] = [];
	p.stderr.on('data', data => stderr.push(data));

	p.exit.then(({ code, signal }) => {
		if (stderr.length) {
			output.write(toErrorText(Buffer.concat(stderr).toString()));
		}
		if (code || (signal && signal !== 'SIGKILL')) {
			output.write(toErrorText(`Docker events terminated (code: ${code}, signal: ${signal}).`));
		}
	}, err => {
		output.write(toErrorText(err && (err.stack || err.message)));
	});

	return p;
}

export async function dockerBuildKitVersion(params: DockerCLIParameters | PartialExecParameters | DockerResolverParameters): Promise<string | null> {
	try {
		const execParams = {
			...toExecParameters(params),
			print: true,
		};
		const result = await dockerCLI(execParams, 'buildx', 'version');
		const versionMatch = result.stdout.toString().match(/(?<major>[0-9]+)\.(?<minor>[0-9]+)\.(?<patch>[0-9]+)/);
		if (!versionMatch) {
			return null;
		}
		return versionMatch[0];
	} catch {
		return null;
	}
}

export async function dockerCLI(params: DockerCLIParameters | PartialExecParameters | DockerResolverParameters, ...args: string[]) {
	const partial = toExecParameters(params);
	return runCommandNoPty({
		...partial,
		args: (partial.args || []).concat(args),
	});
}

export async function dockerContext(params: DockerCLIParameters) {
	try {
		// 'docker context show' is only available as an addon from the 'compose-cli'. 'docker context inspect' connects to the daemon making it slow. Using 'docker context ls' instead.
		const { stdout } = await dockerCLI(params, 'context', 'ls', '--format', '{{json .}}');
		const json = `[${stdout.toString()
			.trim()
			.split(/\r?\n/)
			.join(',')
			}]`;
		const contexts = JSON.parse(json) as { Current: boolean; Name: string }[];
		const current = contexts.find(c => c.Current)?.Name;
		return current;
	} catch {
		// Docker is not installed or Podman does not have contexts.
		return undefined;
	}
}

export async function isPodman(params: DockerCLIParameters | DockerResolverParameters) {
	const cliHost = 'cliHost' in params ? params.cliHost : params.common.cliHost;
	if (cliHost.platform !== 'linux') {
		return false;
	}
	try {
		const { stdout } = await dockerCLI(params, '-v');
		return stdout.toString().toLowerCase().indexOf('podman') !== -1;
	} catch (err) {
		return false;
	}
}

export async function dockerPtyCLI(params: PartialPtyExecParameters | DockerResolverParameters | DockerCLIParameters, ...args: string[]) {
	const partial = toPtyExecParameters(params);
	return runCommand({
		...partial,
		args: (partial.args || []).concat(args),
	});
}

export async function dockerComposeCLI(params: DockerCLIParameters | PartialExecParameters | DockerResolverParameters, ...args: string[]) {
	const partial = toExecParameters(params, 'dockerComposeCLI' in params ? await params.dockerComposeCLI() : undefined);
	return runCommandNoPty({
		...partial,
		args: (partial.args || []).concat(args),
	});
}

export async function dockerComposePtyCLI(params: DockerCLIParameters | PartialPtyExecParameters | DockerResolverParameters, ...args: string[]) {
	const partial = toPtyExecParameters(params, 'dockerComposeCLI' in params ? await params.dockerComposeCLI() : undefined);
	return runCommand({
		...partial,
		args: (partial.args || []).concat(args),
	});
}

export function dockerExecFunction(params: DockerCLIParameters | PartialExecParameters | DockerResolverParameters, containerName: string, user: string | undefined): ExecFunction {
	return async function (execParams: ExecParameters): Promise<Exec> {
		const { exec, cmd, args, env } = toExecParameters(params);
		const { argsPrefix, args: execArgs } = toDockerExecArgs(containerName, user, execParams, false);
		return exec({
			cmd,
			args: (args || []).concat(execArgs),
			env,
			output: replacingDockerExecLog(execParams.output, cmd, argsPrefix),
		});
	};
}

export async function dockerPtyExecFunction(params: PartialPtyExecParameters | DockerResolverParameters, containerName: string, user: string | undefined, loadNativeModule: <T>(moduleName: string) => Promise<T | undefined>): Promise<PtyExecFunction> {
	const pty = await loadNativeModule<typeof ptyType>('node-pty');
	if (!pty) {
		throw new Error('Missing node-pty');
	}

	return async function (execParams: PtyExecParameters): Promise<PtyExec> {
		const { ptyExec, cmd, args, env } = toPtyExecParameters(params);
		const { argsPrefix, args: execArgs } = toDockerExecArgs(containerName, user, execParams, true);
		return ptyExec({
			cmd,
			args: (args || []).concat(execArgs),
			env,
			output: replacingDockerExecLog(execParams.output, cmd, argsPrefix),
		});
	};
}

function replacingDockerExecLog(original: Log, cmd: string, args: string[]) {
	return replacingLog(original, `Run: ${cmd} ${(args || []).join(' ').replace(/\n.*/g, '')}`, 'Run in container:');
}

function replacingLog(original: Log, search: string, replace: string) {
	const searchR = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
	const wrapped = makeLog({
		...original,
		get dimensions() {
			return original.dimensions;
		},
		event: e => original.event('text' in e ? {
			...e,
			text: e.text.replace(searchR, replace),
		} : e),
	});
	return wrapped;
}

function toDockerExecArgs(containerName: string, user: string | undefined, params: ExecParameters | PtyExecParameters, pty: boolean) {
	const { env, cwd, cmd, args } = params;
	const execArgs = ['exec', '-i'];
	if (pty) {
		execArgs.push('-t');
	}
	if (user) {
		execArgs.push('-u', user);
	}
	if (env) {
		Object.keys(env)
			.forEach(key => execArgs.push('-e', `${key}=${env[key]}`));
	}
	if (cwd) {
		execArgs.push('-w', cwd);
	}
	execArgs.push(containerName);
	const argsPrefix = execArgs.slice();
	execArgs.push(cmd);
	if (args) {
		execArgs.push(...args);
	}
	return { argsPrefix, args: execArgs };
}

export function toExecParameters(params: DockerCLIParameters | PartialExecParameters | DockerResolverParameters, compose?: DockerComposeCLI): PartialExecParameters {
	return 'dockerEnv' in params ? {
		exec: params.common.cliHost.exec,
		cmd: compose ? compose.cmd : params.dockerCLI,
		args: compose ? compose.args : [],
		env: params.dockerEnv,
		output: params.common.output,
	} : 'cliHost' in params ? {
		exec: params.cliHost.exec,
		cmd: compose ? compose.cmd : params.dockerCLI,
		args: compose ? compose.args : [],
		env: params.env,
		output: params.output,
	} : {
		...params,
		env: params.env,
	};
}

export function toPtyExecParameters(params: DockerCLIParameters | PartialPtyExecParameters | DockerResolverParameters, compose?: DockerComposeCLI): PartialPtyExecParameters {
	return 'dockerEnv' in params ? {
		ptyExec: params.common.cliHost.ptyExec,
		cmd: compose ? compose.cmd : params.dockerCLI,
		args: compose ? compose.args : [],
		env: params.dockerEnv,
		output: params.common.output,
	} : 'cliHost' in params ? {
		ptyExec: params.cliHost.ptyExec,
		cmd: compose ? compose.cmd : params.dockerCLI,
		args: compose ? compose.args : [],
		env: params.env,
		output: params.output,
	} : {
		...params,
		env: params.env,
	};
}

export function toDockerImageName(name: string) {
	// https://docs.docker.com/engine/reference/commandline/tag/#extended-description
	return name
		.toLowerCase()
		.replace(/[^a-z0-9\._-]+/g, '')
		.replace(/(\.[\._-]|_[\.-]|__[\._-]|-+[\._])[\._-]*/g, (_, a) => a.substr(0, a.length - 1));
}
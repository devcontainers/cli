/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Writable, Readable } from 'stream';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import * as cp from 'child_process';
import * as ptyType from 'node-pty';
import { StringDecoder } from 'string_decoder';

import { toErrorText } from './errors';
import { Disposable, Event } from '../spec-utils/event';
import { isLocalFile } from '../spec-utils/pfs';
import { Log, nullLog } from '../spec-utils/log';
import { ShellServer } from './shellServer';

export { CLIHost, getCLIHost } from './cliHost';

export interface Exec {
	stdin: Writable;
	stdout: Readable;
	stderr: Readable;
	exit: Promise<{ code: number | null; signal: string | null }>;
	terminate(): Promise<void>;
}

export interface ExecParameters {
	env?: NodeJS.ProcessEnv;
	cwd?: string;
	cmd: string;
	args?: string[];
	output: Log;
}

export interface ExecFunction {
	(params: ExecParameters): Promise<Exec>;
}

export interface PtyExec {
	onData: Event<string>;
	write(data: string): void;
	resize(cols: number, rows: number): void;
	exit: Promise<{ code: number | undefined; signal: number | undefined }>;
	terminate(): Promise<void>;
}

export interface PtyExecParameters {
	env?: NodeJS.ProcessEnv;
	cwd?: string;
	cmd: string;
	args?: string[];
	cols?: number;
	rows?: number;
	output: Log;
}

export interface PtyExecFunction {
	(params: PtyExecParameters): Promise<PtyExec>;
}

export function equalPaths(platform: NodeJS.Platform, a: string, b: string) {
	if (platform === 'linux') {
		return a === b;
	}
	return a.toLowerCase() === b.toLowerCase();
}

export const tsnode = path.join(__dirname, '..', '..', 'node_modules', '.bin', 'ts-node');
export const isTsnode = path.basename(process.argv[0]) === 'ts-node' || process.argv.indexOf('ts-node/register') !== -1;

export async function runCommandNoPty(options: {
	exec: ExecFunction;
	cmd: string;
	args?: string[];
	cwd?: string;
	env?: NodeJS.ProcessEnv;
	stdin?: Buffer | fs.ReadStream | Event<string>;
	output: Log;
	print?: boolean | 'continuous' | 'onerror';
}) {
	const { exec, cmd, args, cwd, env, stdin, output, print } = options;

	const p = await exec({
		cmd,
		args,
		cwd,
		env,
		output,
	});

	return new Promise<{ stdout: Buffer; stderr: Buffer }>((resolve, reject) => {
		const stdout: Buffer[] = [];
		const stderr: Buffer[] = [];

		const stdoutDecoder = print === 'continuous' ? new StringDecoder() : undefined;
		p.stdout.on('data', (chunk: Buffer) => {
			stdout.push(chunk);
			if (print === 'continuous') {
				output.write(stdoutDecoder!.write(chunk));
			}
		});
		p.stdout.on('error', (err: any) => {
			// ENOTCONN seen with missing executable in addition to ENOENT on child_process.
			if (err?.code !== 'ENOTCONN') {
				throw err;
			}
		});
		const stderrDecoder = print === 'continuous' ? new StringDecoder() : undefined;
		p.stderr.on('data', (chunk: Buffer) => {
			stderr.push(chunk);
			if (print === 'continuous') {
				output.write(toErrorText(stderrDecoder!.write(chunk)));
			}
		});
		p.stderr.on('error', (err: any) => {
			// ENOTCONN seen with missing executable in addition to ENOENT on child_process.
			if (err?.code !== 'ENOTCONN') {
				throw err;
			}
		});
		const subs: Disposable[] = [];
		p.exit.then(({ code }) => {
			try {
				subs.forEach(sub => sub.dispose());
				const stdoutBuf = Buffer.concat(stdout);
				const stderrBuf = Buffer.concat(stderr);
				if (print === true || (code && print === 'onerror')) {
					output.write(stdoutBuf.toString().replace(/\r?\n/g, '\r\n'));
					output.write(toErrorText(stderrBuf.toString()));
				}
				if (print && code) {
					output.write(`Exit code ${code}`);
				}
				if (code) {
					reject({
						message: `Command failed: ${cmd} ${(args || []).join(' ')}`,
						stdout: stdoutBuf,
						stderr: stderrBuf,
						code
					});
				} else {
					resolve({
						stdout: stdoutBuf,
						stderr: stderrBuf,
					});
				}
			} catch (e) {
				reject(e);
			}
		}, reject);
		if (stdin instanceof Buffer) {
			p.stdin.write(stdin, err => {
				if (err) {
					reject(err);
				}
			});
			p.stdin.end();
		} else if (stdin instanceof fs.ReadStream) {
			stdin.pipe(p.stdin);
		} else if (typeof stdin === 'function') {
			subs.push(stdin(buf => p.stdin.write(buf)));
		}
	});
}

export async function runCommand(options: {
	ptyExec: PtyExecFunction;
	cmd: string;
	args?: string[];
	cwd?: string;
	env?: NodeJS.ProcessEnv;
	output: Log;
	resolveOn?: RegExp;
	onDidInput?: Event<string>;
}) {
	const { ptyExec, cmd, args, cwd, env, output, resolveOn, onDidInput } = options;

	const p = await ptyExec({
		cmd,
		args,
		cwd,
		env,
		output: output,
	});

	return new Promise<{ cmdOutput: string }>((resolve, reject) => {
		let cmdOutput = '';

		const subs = [
			onDidInput && onDidInput(data => p.write(data)),
		];

		p.onData(chunk => {
			cmdOutput += chunk;
			output.raw(chunk);
			if (resolveOn && resolveOn.exec(cmdOutput)) {
				resolve({ cmdOutput });
			}
		});
		p.exit.then(({ code, signal }) => {
			try {
				subs.forEach(sub => sub?.dispose());
				if (code || signal) {
					reject({
						message: `Command failed: ${cmd} ${(args || []).join(' ')}`,
						cmdOutput: cmdOutput,
						code,
						signal,
					});
				} else {
					resolve({ cmdOutput });
				}
			} catch (e) {
				reject(e);
			}
		}, e => {
			subs.forEach(sub => sub?.dispose());
			reject(e);
		});
	});
}

export function plainExec(defaultCwd: string | undefined): ExecFunction {
	return async function (params: ExecParameters): Promise<Exec> {
		const { cmd, args, output } = params;

		const text = `Run: ${cmd} ${(args || []).join(' ').replace(/\n.*/g, '')}`;
		const start = output.start(text);

		const cwd = params.cwd || defaultCwd;
		const env = params.env ? { ...process.env, ...params.env } : process.env;
		const exec = await findLocalWindowsExecutable(cmd, cwd, env, output);
		const p = cp.spawn(exec, args, { cwd, env, windowsHide: true });

		return {
			stdin: p.stdin,
			stdout: p.stdout,
			stderr: p.stderr,
			exit: new Promise((resolve, reject) => {
				p.once('error', err => {
					output.stop(text, start);
					reject(err);
				});
				p.once('close', (code, signal) => {
					output.stop(text, start);
					resolve({ code, signal });
				});
			}),
			async terminate() {
				p.kill('SIGKILL');
			}
		};
	};
}

export async function plainPtyExec(defaultCwd: string | undefined, loadNativeModule: <T>(moduleName: string) => Promise<T | undefined>): Promise<PtyExecFunction> {
	const pty = await loadNativeModule<typeof ptyType>('node-pty');
	if (!pty) {
		throw new Error('Missing node-pty');
	}

	return async function (params: PtyExecParameters): Promise<PtyExec> {
		const { cmd, args, output } = params;

		const text = `Run: ${cmd} ${(args || []).join(' ').replace(/\n.*/g, '')}`;
		const start = output.start(text);

		const useConpty = false; // TODO: Investigate using a shell with ConPTY. https://github.com/Microsoft/vscode-remote/issues/1234#issuecomment-485501275
		const cwd = params.cwd || defaultCwd;
		const env = params.env ? { ...process.env, ...params.env } : process.env;
		const exec = await findLocalWindowsExecutable(cmd, cwd, env, output);
		const p = pty.spawn(exec, args || [], {
			cwd,
			env: env as any,
			cols: output.dimensions?.columns,
			rows: output.dimensions?.rows,
			useConpty,
		});
		const subs = [
			output.onDidChangeDimensions && output.onDidChangeDimensions(e => p.resize(e.columns, e.rows))
		];

		return {
			onData: p.onData.bind(p),
			write: p.write.bind(p),
			resize: p.resize.bind(p),
			exit: new Promise(resolve => {
				p.onExit(({ exitCode, signal }) => {
					subs.forEach(sub => sub?.dispose());
					output.stop(text, start);
					resolve({ code: exitCode, signal });
					if (process.platform === 'win32') {
						try {
							// In some cases the process hasn't cleanly exited on Windows and the winpty-agent gets left around
							// https://github.com/microsoft/node-pty/issues/333
							p.kill();
						} catch {
						}
					}
				});
			}),
			async terminate() {
				p.kill('SIGKILL');
			}
		};
	};
}

async function findLocalWindowsExecutable(command: string, cwd = process.cwd(), env: Record<string, string | undefined>, output: Log): Promise<string> {
	if (process.platform !== 'win32') {
		return command;
	}

	// From terminalTaskSystem.ts.

	// If we have an absolute path then we take it.
	if (path.isAbsolute(command)) {
		return await findLocalWindowsExecutableWithExtension(command) || command;
	}
	if (/[/\\]/.test(command)) {
		// We have a directory and the directory is relative (see above). Make the path absolute
		// to the current working directory.
		const fullPath = path.join(cwd, command);
		return await findLocalWindowsExecutableWithExtension(fullPath) || fullPath;
	}
	let pathValue: string | undefined = undefined;
	let paths: string[] | undefined = undefined;
	// The options can override the PATH. So consider that PATH if present.
	if (env) {
		// Path can be named in many different ways and for the execution it doesn't matter
		for (let key of Object.keys(env)) {
			if (key.toLowerCase() === 'path') {
				const value = env[key];
				if (typeof value === 'string') {
					pathValue = value;
					paths = value.split(path.delimiter)
						.filter(Boolean);
					paths.push(path.join(env.ProgramW6432 || 'C:\\Program Files', 'Docker\\Docker\\resources\\bin')); // Fall back when newly installed.
				}
				break;
			}
		}
	}
	// No PATH environment. Make path absolute to the cwd.
	if (paths === void 0 || paths.length === 0) {
		output.write(`findLocalWindowsExecutable: No PATH to look up exectuable '${command}'.`);
		const fullPath = path.join(cwd, command);
		return await findLocalWindowsExecutableWithExtension(fullPath) || fullPath;
	}
	// We have a simple file name. We get the path variable from the env
	// and try to find the executable on the path.
	for (let pathEntry of paths) {
		// The path entry is absolute.
		let fullPath: string;
		if (path.isAbsolute(pathEntry)) {
			fullPath = path.join(pathEntry, command);
		} else {
			fullPath = path.join(cwd, pathEntry, command);
		}
		const withExtension = await findLocalWindowsExecutableWithExtension(fullPath);
		if (withExtension) {
			return withExtension;
		}
	}
	output.write(`findLocalWindowsExecutable: Exectuable '${command}' not found on PATH '${pathValue}'.`);
	const fullPath = path.join(cwd, command);
	return await findLocalWindowsExecutableWithExtension(fullPath) || fullPath;
}

const pathext = process.env.PATHEXT;
const executableExtensions = pathext ? pathext.toLowerCase().split(';') : ['.com', '.exe', '.bat', '.cmd'];

async function findLocalWindowsExecutableWithExtension(fullPath: string) {
	if (executableExtensions.indexOf(path.extname(fullPath)) !== -1) {
		return await isLocalFile(fullPath) ? fullPath : undefined;
	}
	for (const ext of executableExtensions) {
		const withExtension = fullPath + ext;
		if (await isLocalFile(withExtension)) {
			return withExtension;
		}
	}
	return undefined;
}

export function parseVersion(str: string) {
	const m = /^'?v?(\d+(\.\d+)*)/.exec(str);
	if (!m) {
		return undefined;
	}
	return m[1].split('.')
		.map(i => parseInt(i, 10));
}

export function isEarlierVersion(left: number[], right: number[]) {
	for (let i = 0, n = Math.max(left.length, right.length); i < n; i++) {
		const l = left[i] || 0;
		const r = right[i] || 0;
		if (l !== r) {
			return l < r;
		}
	}
	return false; // Equal.
}

export const fork = isTsnode ? (mod: string, args: readonly string[] | undefined, options: any) => {
	return cp.spawn(tsnode, [mod, ...(args || [])], { ...options, windowsHide: true });
} : cp.fork;

export async function loadNativeModule<T>(moduleName: string): Promise<T | undefined> {
	// Check NODE_PATH for Electron. Do this first to avoid loading a binary-incompatible version from the local node_modules during development.
	if (process.env.NODE_PATH) {
		for (const nodePath of process.env.NODE_PATH.split(path.delimiter)) {
			if (nodePath) {
				try {
					return require(`${nodePath}/${moduleName}`);
				} catch (err) {
					// Not available.
				}
			}
		}
	}
	try {
		return require(moduleName);
	} catch (err) {
		// Not available.
	}
	return undefined;
}

export type PlatformSwitch<T> = T | { posix: T; win32: T };

export function platformDispatch<T>(platform: NodeJS.Platform, platformSwitch: PlatformSwitch<T>) {
	if (typeof platformSwitch !== 'string' && 'win32' in platformSwitch) {
		return platform === 'win32' ? platformSwitch.win32 : platformSwitch.posix;
	}
	return platformSwitch;
}

export async function isFile(shellServer: ShellServer, location: string) {
	return platformDispatch(shellServer.platform, {
		posix: async () => {
			try {
				await shellServer.exec(`test -f '${location}'`);
				return true;
			} catch (err) {
				return false;
			}
		},
		win32: async () => {
			return (await shellServer.exec(`Test-Path '${location}' -PathType Leaf`))
				.stdout.trim() === 'True';
		}
	})();
}

let localUsername: Promise<string>;
export async function getLocalUsername() {
	if (localUsername === undefined) {
		localUsername = (async () => {
			try {
				return os.userInfo().username;
			} catch (err) {
				if (process.platform !== 'linux') {
					throw err;
				}
				// os.userInfo() fails with VS Code snap install: https://github.com/microsoft/vscode-remote-release/issues/6913
				const result = await runCommandNoPty({ exec: plainExec(undefined), cmd: 'id', args: ['-u', '-n'], output: nullLog });
				return result.stdout.toString().trim();
			}
		})();
	}
	return localUsername;
}

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';
import * as net from 'net';
import * as os from 'os';

import { readLocalFile, writeLocalFile, mkdirpLocal, isLocalFile, renameLocal, readLocalDir, isLocalFolder } from '../spec-utils/pfs';
import { URI } from 'vscode-uri';
import { ExecFunction, plainExec, plainPtyExec, PtyExecFunction } from './commonUtils';
import { Duplex } from 'pull-stream';

const toPull = require('stream-to-pull-stream');


export type CLIHostType = 'local' | 'wsl' | 'container' | 'ssh';

export interface CLIHost {
	type: CLIHostType;
	platform: NodeJS.Platform;
	exec: ExecFunction;
	ptyExec: PtyExecFunction;
	cwd: string;
	env: NodeJS.ProcessEnv;
	path: typeof path.posix | typeof path.win32;
	homedir(): Promise<string>;
	tmpdir(): Promise<string>;
	isFile(filepath: string): Promise<boolean>;
	isFolder(filepath: string): Promise<boolean>;
	readFile(filepath: string): Promise<Buffer>;
	writeFile(filepath: string, content: Buffer): Promise<void>;
	rename(oldPath: string, newPath: string): Promise<void>;
	mkdirp(dirpath: string): Promise<void>;
	readDir(dirpath: string): Promise<string[]>;
	readDirWithTypes?(dirpath: string): Promise<[string, FileTypeBitmask][]>;
	getUsername(): Promise<string>;
	getuid(): Promise<number>;
	getgid(): Promise<number>;
	toCommonURI(filePath: string): Promise<URI | undefined>;
	connect: ConnectFunction;
	reconnect?(): Promise<void>;
	terminate?(): Promise<void>;
}

export type ConnectFunction = (socketPath: string) => Duplex<Buffer, Buffer>;

export enum FileTypeBitmask {
	Unknown = 0,
	File = 1,
	Directory = 2,
	SymbolicLink = 64
}

export async function getCLIHost(localCwd: string, loadNativeModule: <T>(moduleName: string) => Promise<T | undefined>): Promise<CLIHost> {
	const exec = plainExec(localCwd);
	const ptyExec = await plainPtyExec(localCwd, loadNativeModule);
	return createLocalCLIHostFromExecFunctions(localCwd, exec, ptyExec, connectLocal);
}

function createLocalCLIHostFromExecFunctions(localCwd: string, exec: ExecFunction, ptyExec: PtyExecFunction, connect: ConnectFunction): CLIHost {
	return {
		type: 'local',
		platform: process.platform,
		exec,
		ptyExec,
		cwd: localCwd,
		env: process.env,
		path: path,
		homedir: async () => os.homedir(),
		tmpdir: async () => os.tmpdir(),
		isFile: isLocalFile,
		isFolder: isLocalFolder,
		readFile: readLocalFile,
		writeFile: writeLocalFile,
		rename: renameLocal,
		mkdirp: async (dirpath) => {
			await mkdirpLocal(dirpath);
		},
		readDir: readLocalDir,
		getUsername: async () => os.userInfo().username,
		getuid: async () => process.getuid(),
		getgid: async () => process.getgid(),
		toCommonURI: async (filePath) => URI.file(filePath),
		connect,
	};
}

function connectLocal(socketPath: string) {
	if (process.platform !== 'win32' || socketPath.startsWith('\\\\.\\pipe\\')) {
		return toPull.duplex(net.connect(socketPath));
	}

	const socket = new net.Socket();
	(async () => {
		const buf = await readLocalFile(socketPath);
		const i = buf.indexOf(0xa);
		const port = parseInt(buf.slice(0, i).toString(), 10);
		const guid = buf.slice(i + 1);
		socket.connect(port, '127.0.0.1', () => {
			socket.write(guid, err => {
				if (err) {
					console.error(err);
					socket.destroy();
				}
			});
		});
	})()
		.catch(err => {
			console.error(err);
			socket.destroy();
		});
	return toPull.duplex(socket);
}

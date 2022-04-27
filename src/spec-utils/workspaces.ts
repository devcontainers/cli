/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';

import { parse } from 'jsonc-parser';
import { URI } from 'vscode-uri'; // avoid vscode.Uri reference for tests

export interface Workspace {
	readonly isWorkspaceFile: boolean;
	readonly workspaceOrFolderPath: string;
	readonly rootFolderPath: string;
	readonly configFolderPath: string;
}

export function workspaceFromPath(path_: typeof path.posix | typeof path.win32, workspaceOrFolderPath: string): Workspace {
	if (isWorkspacePath(workspaceOrFolderPath)) {
		const workspaceFolder = path_.dirname(workspaceOrFolderPath);
		return {
			isWorkspaceFile: true,
			workspaceOrFolderPath,
			rootFolderPath: workspaceFolder, // use workspaceFolder as root folder
			configFolderPath: workspaceFolder, // have config file in workspaceFolder (to be discussed...)
		};
	}
	return {
		isWorkspaceFile: false,
		workspaceOrFolderPath,
		rootFolderPath: workspaceOrFolderPath,
		configFolderPath: workspaceOrFolderPath,
	};
}

export function isWorkspacePath(workspaceOrFolderPath: string) {
	return path.extname(workspaceOrFolderPath) === '.code-workspace'; // TODO: Remove VS Code specific code.
}

export async function canUseWorkspacePathInRemote(cliHost: { platform: NodeJS.Platform; path: typeof path.posix | typeof path.win32; readFile(filepath: string): Promise<Buffer> }, workspace: Workspace): Promise<string | undefined> {
	if (!workspace.isWorkspaceFile) {
		return undefined;
	}
	try {
		const rootFolder = workspace.rootFolderPath;
		const workspaceFileContent = (await cliHost.readFile(workspace.workspaceOrFolderPath)).toString();
		const workspaceFile = parse(workspaceFileContent);
		const folders = workspaceFile['folders'];
		if (folders && folders.length > 0) {
			for (const folder of folders) {
				const folderPath = folder['path'];
				let fullPath;
				if (!folderPath) {
					const folderURI = folder['uri'];
					if (!folderURI) {
						return `Workspace contains a folder that defines neither a path nor a URI.`;
					}
					const uri = URI.parse(folderURI);
					if (uri.scheme !== 'file') {
						return `Workspace contains folder '${folderURI}' not on the local file system.`;
					}
					return `Workspace contains an absolute folder path '${folderURI}'.`;
				} else {
					if (cliHost.path.isAbsolute(folderPath)) {
						return `Workspace contains an absolute folder path '${folderPath}'.`;
					}
					fullPath = cliHost.path.resolve(rootFolder, folderPath);
				}
				if (!isEqualOrParent(cliHost, fullPath, rootFolder)) {
					return `Folder '${fullPath}' is not a subfolder of shared root folder '${rootFolder}'.`;
				}
			}
			return;
		}
		return `Workspace does not define any folders`;
	} catch (e) {
		return `Problems loading workspace file ${workspace.workspaceOrFolderPath}: ${e && (e.message || e.toString())}`;
	}
}

export function isEqualOrParent(cliHost: { platform: NodeJS.Platform; path: typeof path.posix | typeof path.win32 }, c: string, parent: string): boolean {
	if (c === parent) {
		return true;
	}

	if (!c || !parent) {
		return false;
	}

	if (parent.length > c.length) {
		return false;
	}

	if (c.length > parent.length && c.charAt(parent.length) !== cliHost.path.sep) {
		return false;
	}

	return equalPaths(cliHost.platform, parent, c.substr(0, parent.length));
}

function equalPaths(platform: NodeJS.Platform, a: string, b: string) {
	if (platform === 'linux') {
		return a === b;
	}
	return a.toLowerCase() === b.toLowerCase();
}

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ShellServer } from '../spec-common/shellServer';
import { findProcesses } from '../spec-common/proc';

export async function findSessions(shellServer: ShellServer) {
	const { processes } = await findProcesses(shellServer);
	return processes.filter(proc => 'VSCODE_REMOTE_CONTAINERS_SESSION' in proc.env) // TODO: Remove VS Code reference.
		.map(proc => ({
			...proc,
			sessionId: proc.env.VSCODE_REMOTE_CONTAINERS_SESSION
		}));
}

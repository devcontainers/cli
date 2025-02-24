/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { shellExec, output } from './testUtils';
import { dockerExecFunction } from '../spec-shutdown/dockerUtils';
import { plainExec } from '../spec-common/commonUtils';
import { launch } from '../spec-common/shellServer';
import { getHomeFolder, getUserFromPasswdDB } from '../spec-common/injectHeadless';

describe('getHomeFolder', function () {
	this.timeout('20s');

	it(`should ignore non-writeable HOME`, async () => {
		const res = await shellExec(`docker run -d mcr.microsoft.com/devcontainers/base:latest sleep inf`);
		const containerId = res.stdout.trim();
		
		const vscodeShellServer = await launchShellServer(containerId, 'vscode');
		const vscodeUser = await getUserFromPasswdDB(vscodeShellServer, 'vscode');
		assert.ok(vscodeUser);

		assert.strictEqual(await getHomeFolder(vscodeShellServer, {}, vscodeUser), '/home/vscode');
		assert.strictEqual(await getHomeFolder(vscodeShellServer, { HOME: '/root' }, vscodeUser), '/home/vscode');
		assert.strictEqual(await getHomeFolder(vscodeShellServer, { HOME: '/home/vscode' }, vscodeUser), '/home/vscode');
		assert.strictEqual(await getHomeFolder(vscodeShellServer, { HOME: '/home/vscode/foo' }, vscodeUser), '/home/vscode/foo');

		const rootServer = await launchShellServer(containerId, 'root');
		const rootUser = await getUserFromPasswdDB(rootServer, 'root');
		assert.ok(rootUser);

		assert.strictEqual(await getHomeFolder(rootServer, {}, rootUser), '/root');
		assert.strictEqual(await getHomeFolder(rootServer, { HOME: '/home/vscode' }, rootUser), '/home/vscode');
	});

	async function launchShellServer(containerId: string, username: string) {
		const exec = dockerExecFunction({
			exec: plainExec(undefined),
			cmd: 'docker',
			env: {},
			output,
		}, containerId, username);
		return launch(exec, output);
	}
});

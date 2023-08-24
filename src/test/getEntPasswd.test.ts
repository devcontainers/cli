/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { shellExec, output } from './testUtils';
import { dockerExecFunction } from '../spec-shutdown/dockerUtils';
import { plainExec } from '../spec-common/commonUtils';
import { launch } from '../spec-common/shellServer';
import { getUserFromPasswdDB } from '../spec-common/injectHeadless';

describe('getEntPasswdShellCommand', function () {
	this.timeout('20s');

	[
		{
			image: 'busybox',
			getentPath: undefined,
			addUserOptions: '-D -h',
			userName: 'foo\\bar',
		},
		{
			image: 'debian',
			getentPath: '/usr/bin/getent',
			addUserOptions: '--disabled-password --allow-all-names --gecos "" --home',
			userName: 'foo\\bar',
		},
		{
			image: 'alpine',
			getentPath: '/usr/bin/getent',
			addUserOptions: '-D -h',
			userName: 'foo_bar', // Alpine doesn't support backslash in user names.
		},
	].forEach(({ image, getentPath, addUserOptions, userName }) => {
		it(`should work with ${image} ${getentPath ? 'with' : 'without'} getent command`, async () => {
			const res = await shellExec(`docker run -d ${image} sleep inf`);
			const containerId = res.stdout.trim();
			const exec = dockerExecFunction({
				exec: plainExec(undefined),
				cmd: 'docker',
				env: {},
				output,
			}, containerId, 'root');
			const shellServer = await launch(exec, output);

			const which = await shellServer.exec('command -v getent')
				.catch(() => undefined);
			assert.strictEqual(which?.stdout.trim(), getentPath);

			await shellServer.exec(`adduser ${addUserOptions} /home/foo ${userName.replaceAll('\\', '\\\\')}`);

			const userByName = await getUserFromPasswdDB(shellServer, userName);
			assert.ok(userByName);
			assert.strictEqual(userByName.name, userName);
			assert.strictEqual(userByName.home, '/home/foo');

			const userById = await getUserFromPasswdDB(shellServer, userByName.uid);
			assert.ok(userById);
			assert.strictEqual(userById.name, userName);
			assert.strictEqual(userById.home, '/home/foo');

			const nonexistentUser = await getUserFromPasswdDB(shellServer, '123456');
			assert.strictEqual(undefined, nonexistentUser);

			await shellExec(`docker rm -f ${containerId}`);
		});
	});
});

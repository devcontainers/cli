/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as path from 'path';
import { devContainerDown, devContainerUp, shellExec } from './testUtils';

const pkg = require('../../package.json');

(process.platform === 'linux' ? describe : describe.skip)('Dev Containers CLI', function () {
	this.timeout('120s');

	const tmp = path.relative(process.cwd(), path.join(__dirname, 'tmp'));
	const cli = `npx --prefix ${tmp} devcontainer`;

	before('Install', async () => {
		await shellExec(`rm -rf ${tmp}/node_modules`);
		await shellExec(`mkdir -p ${tmp}`);
		await shellExec(`npm --prefix ${tmp} install devcontainers-cli-${pkg.version}.tgz`);
	});

	describe('updateUID', () => {
		it('should update UID and GID', async () => {
			const testFolder = `${__dirname}/configs/updateUID`;
			const containerId = (await devContainerUp(cli, testFolder)).containerId;
			const uid = await shellExec(`${cli} exec --workspace-folder ${testFolder} id -u`);
			assert.strictEqual(uid.stdout.trim(), String(process.getuid!()));
			const gid = await shellExec(`${cli} exec --workspace-folder ${testFolder} id -g`);
			assert.strictEqual(gid.stdout.trim(), String(process.getgid!()));
			await devContainerDown({ containerId });
		});

		it('should update only UID when GID exists', async () => {
			const testFolder = `${__dirname}/configs/updateUIDOnly`;
			const containerId = (await devContainerUp(cli, testFolder, {
				env: {
					...process.env,
					LOCAL_GID: String(process.getgid!())
				}
			})).containerId;
			const uid = await shellExec(`${cli} exec --workspace-folder ${testFolder} id -u`);
			assert.strictEqual(uid.stdout.trim(), String(process.getuid!()));
			const gid = await shellExec(`${cli} exec --workspace-folder ${testFolder} id -g`);
			assert.strictEqual(gid.stdout.trim(), String(4321));
			await devContainerDown({ containerId });
		});

		it('should update UID and GID when the platform is linux/amd64', async () => {
			const testFolder = `${__dirname}/configs/updateUIDamd64`;
			const containerId = (await devContainerUp(cli, testFolder)).containerId;
			const uid = await shellExec(`${cli} exec --workspace-folder ${testFolder} id -u`);
			assert.strictEqual(uid.stdout.trim(), String(process.getuid!()));
			const gid = await shellExec(`${cli} exec --workspace-folder ${testFolder} id -g`);
			assert.strictEqual(gid.stdout.trim(), String(process.getgid!()));
			await devContainerDown({ containerId });
		});

		it('should update UID and GID when --platform is linux/amd64', async () => {
			const testFolder = `${__dirname}/configs/updateUIDamd64-platform-option`;
			const containerId = (await devContainerUp(cli, testFolder)).containerId;
			const uid = await shellExec(`${cli} exec --workspace-folder ${testFolder} id -u`);
			assert.strictEqual(uid.stdout.trim(), String(process.getuid!()));
			const gid = await shellExec(`${cli} exec --workspace-folder ${testFolder} id -g`);
			assert.strictEqual(gid.stdout.trim(), String(process.getgid!()));
			await devContainerDown({ containerId });
		});

		it('should update UID and GID when the platform is linux/arm64', async () => {
			const testFolder = `${__dirname}/configs/updateUIDarm64`;
			const containerId = (await devContainerUp(cli, testFolder)).containerId;
			const uid = await shellExec(`${cli} exec --workspace-folder ${testFolder} id -u`);
			assert.strictEqual(uid.stdout.trim(), String(process.getuid!()));
			const gid = await shellExec(`${cli} exec --workspace-folder ${testFolder} id -g`);
			assert.strictEqual(gid.stdout.trim(), String(process.getgid!()));
			await devContainerDown({ containerId });
		});

		it('should update UID and GID when --platform is linux/arm64', async () => {
			const testFolder = `${__dirname}/configs/updateUIDarm64-platform-option`;
			const containerId = (await devContainerUp(cli, testFolder)).containerId;
			const uid = await shellExec(`${cli} exec --workspace-folder ${testFolder} id -u`);
			assert.strictEqual(uid.stdout.trim(), String(process.getuid!()));
			const gid = await shellExec(`${cli} exec --workspace-folder ${testFolder} id -g`);
			assert.strictEqual(gid.stdout.trim(), String(process.getgid!()));
			await devContainerDown({ containerId });
		});

		it('should update UID and GID when the platform is linux/arm64/v8', async () => {
			const testFolder = `${__dirname}/configs/updateUIDarm64v8`;
			const containerId = (await devContainerUp(cli, testFolder)).containerId;
			const uid = await shellExec(`${cli} exec --workspace-folder ${testFolder} id -u`);
			assert.strictEqual(uid.stdout.trim(), String(process.getuid!()));
			const gid = await shellExec(`${cli} exec --workspace-folder ${testFolder} id -g`);
			assert.strictEqual(gid.stdout.trim(), String(process.getgid!()));
			await devContainerDown({ containerId });
		});

		it('should update UID and GID when --platform is linux/arm64/v8', async () => {
			const testFolder = `${__dirname}/configs/updateUIDarm64v8-platform-option`;
			const containerId = (await devContainerUp(cli, testFolder)).containerId;
			const uid = await shellExec(`${cli} exec --workspace-folder ${testFolder} id -u`);
			assert.strictEqual(uid.stdout.trim(), String(process.getuid!()));
			const gid = await shellExec(`${cli} exec --workspace-folder ${testFolder} id -g`);
			assert.strictEqual(gid.stdout.trim(), String(process.getgid!()));
			await devContainerDown({ containerId });
		});
	});
});

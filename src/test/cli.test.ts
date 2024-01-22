/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as path from 'path';
import { devContainerDown, devContainerUp, shellExec } from './testUtils';

const pkg = require('../../package.json');

describe('Dev Containers CLI', function () {
	this.timeout('120s');

	const tmp = path.relative(process.cwd(), path.join(__dirname, 'tmp'));
	const cli = `npx --prefix ${tmp} devcontainer`;

	before('Install', async () => {
		await shellExec(`rm -rf ${tmp}/node_modules`);
		await shellExec(`mkdir -p ${tmp}`);
		await shellExec(`npm --prefix ${tmp} install devcontainers-cli-${pkg.version}.tgz`);
	});

	it('Global --help', async () => {
		const res = await shellExec(`${cli} --help`);
		assert.ok(res.stdout.indexOf('run-user-commands'), 'Help text is not mentioning run-user-commands.');
	});

	describe('Command run-user-commands', () => {
		describe('with valid config', () => {
			let containerId: string | null = null;
			const testFolder = `${__dirname}/configs/image`;
			beforeEach(async () => containerId = (await devContainerUp(cli, testFolder)).containerId);
			afterEach(async () => await devContainerDown({ containerId }));
			it('should execute successfully', async () => {
				const res = await shellExec(`${cli} run-user-commands --workspace-folder ${testFolder}`);
				const response = JSON.parse(res.stdout);
				assert.equal(response.outcome, 'success');
			});
		});

		it('should fail with "not found" error when config is not found', async () => {
			let success = false;
			try {
				await shellExec(`${cli} run-user-commands --workspace-folder path-that-does-not-exist`);
				success = true;
			} catch (error) {
				assert.equal(error.error.code, 1, 'Should fail with exit code 1');
				const res = JSON.parse(error.stdout);
				assert.equal(res.outcome, 'error');
				assert.match(res.message, /Dev container config \(.*\) not found./);
			}
			assert.equal(success, false, 'expect non-successful call');
		});

		it('should run with config in subfolder', async () => {
			const upRes = await shellExec(`${cli} up --workspace-folder ${__dirname}/configs/dockerfile-without-features --config ${__dirname}/configs/dockerfile-without-features/.devcontainer/subfolder/devcontainer.json --skip-post-create`);
			const upResponse = JSON.parse(upRes.stdout);
			assert.strictEqual(upResponse.outcome, 'success');

			await shellExec(`docker exec ${upResponse.containerId} bash -c '! test -f /subfolderConfigPostCreateCommand.txt'`);

			const runRes = await shellExec(`${cli} run-user-commands --workspace-folder ${__dirname}/configs/dockerfile-without-features --config ${__dirname}/configs/dockerfile-without-features/.devcontainer/subfolder/devcontainer.json`);
			const runResponse = JSON.parse(runRes.stdout);
			assert.strictEqual(runResponse.outcome, 'success');

			await shellExec(`docker exec ${upResponse.containerId} test -f /subfolderConfigPostCreateCommand.txt`);

			await shellExec(`docker rm -f ${upResponse.containerId}`);
		});
	});

	describe('Command read-configuration', () => {
		it('should replace environment variables', async () => {
			const res1 = await shellExec(`${cli} read-configuration --workspace-folder ${__dirname}/configs/image`);
			const response1 = JSON.parse(res1.stdout);
			const remoteEnv1: Record<string, string> | undefined = response1.configuration.remoteEnv;
			assert.ok(remoteEnv1?.LOCAL_PATH?.startsWith('/'), `localEnv not replaced. (Was: ${remoteEnv1?.LOCAL_PATH})`);
			assert.strictEqual(remoteEnv1?.CONTAINER_PATH, '${containerEnv:PATH}');

			const res2 = await shellExec(`${cli} up --workspace-folder ${__dirname}/configs/image`);
			const response2 = JSON.parse(res2.stdout);
			assert.equal(response2.outcome, 'success');
			const containerId: string = response2.containerId;
			assert.ok(containerId, 'Container id not found.');

			try {
				const res3 = await shellExec(`${cli} read-configuration --workspace-folder ${__dirname}/configs/image`);
				const response3 = JSON.parse(res3.stdout);
				const remoteEnv3: Record<string, string> | undefined = response3.configuration.remoteEnv;
				assert.ok(remoteEnv3?.LOCAL_PATH?.startsWith('/'), `localEnv not replaced. (Was: ${remoteEnv3?.LOCAL_PATH})`);
				assert.ok(remoteEnv3?.CONTAINER_PATH?.startsWith('/'), `containerEnv not replaced. (Was: ${remoteEnv3?.CONTAINER_PATH})`);
			} finally {
				await shellExec(`docker rm -f ${containerId}`);
			}
		});

		it('should replace environment variables with merged config', async () => {
			const res1 = await shellExec(`${cli} read-configuration --workspace-folder ${__dirname}/configs/image --include-merged-configuration`);
			const response1 = JSON.parse(res1.stdout);
			const remoteEnv1: Record<string, string> | undefined = response1.mergedConfiguration.remoteEnv;
			assert.ok(remoteEnv1?.LOCAL_PATH?.startsWith('/'), `localEnv not replaced. (Was: ${remoteEnv1?.LOCAL_PATH})`);
			assert.strictEqual(remoteEnv1?.CONTAINER_PATH, '${containerEnv:PATH}');

			const res2 = await shellExec(`${cli} up --workspace-folder ${__dirname}/configs/image`);
			const response2 = JSON.parse(res2.stdout);
			assert.equal(response2.outcome, 'success');
			const containerId: string = response2.containerId;
			assert.ok(containerId, 'Container id not found.');

			try {
				const res3 = await shellExec(`${cli} read-configuration --workspace-folder ${__dirname}/configs/image --include-merged-configuration`);
				const response3 = JSON.parse(res3.stdout);
				const remoteEnv3: Record<string, string> | undefined = response3.mergedConfiguration.remoteEnv;
				assert.ok(remoteEnv3?.LOCAL_PATH?.startsWith('/'), `localEnv not replaced. (Was: ${remoteEnv3?.LOCAL_PATH})`);
				assert.ok(remoteEnv3?.CONTAINER_PATH?.startsWith('/'), `containerEnv not replaced. (Was: ${remoteEnv3?.CONTAINER_PATH})`);
			} finally {
				await shellExec(`docker rm -f ${containerId}`);
			}
		});

		it('should read config in subfolder', async () => {
			const res = await shellExec(`${cli} read-configuration --workspace-folder ${__dirname}/configs/dockerfile-without-features --config ${__dirname}/configs/dockerfile-without-features/.devcontainer/subfolder/devcontainer.json`);
			const response = JSON.parse(res.stdout);
			assert.strictEqual(response.configuration.remoteEnv.SUBFOLDER_CONFIG_REMOTE_ENV, 'true');
		});
	});
});
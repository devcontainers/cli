/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as path from 'path';
import { devContainerDown, devContainerUp, shellExec } from './testUtils';

const pkg = require('../../package.json');

describe('Dev Containers CLI', function () {
	this.timeout('240s');

	const tmp = path.relative(process.cwd(), path.join(__dirname, 'tmp'));
	const cli = `npx --prefix ${tmp} devcontainer`;

	before('Install', async () => {
		await shellExec(`rm -rf ${tmp}/node_modules`);
		await shellExec(`mkdir -p ${tmp}`);
		await shellExec(`npm --prefix ${tmp} install devcontainers-cli-${pkg.version}.tgz`);
	});

	async function containerState(containerId: string) {
		const res = await shellExec(`docker inspect --format '{{.State.Status}}' ${containerId}`, undefined, true, true);
		return res.error ? undefined : res.stdout.trim();
	}

	describe('Command stop and down with an image config', () => {
		const testFolder = `${__dirname}/configs/image`;
		let containerId: string | null = null;

		beforeEach(async () => containerId = (await devContainerUp(cli, testFolder)).containerId);
		afterEach(async () => await devContainerDown({ containerId, doNotThrow: true }));

		it('should stop and restart the container', async () => {
			const stopRes = await shellExec(`${cli} stop --workspace-folder ${testFolder}`);
			const stopResponse = JSON.parse(stopRes.stdout);
			assert.equal(stopResponse.outcome, 'success');
			assert.equal(stopResponse.containerId, containerId);
			assert.equal(await containerState(containerId!), 'exited');

			const upResponse = await devContainerUp(cli, testFolder);
			assert.equal(upResponse.containerId, containerId);
			assert.equal(await containerState(containerId!), 'running');
		});

		it('should remove the container', async () => {
			const res = await shellExec(`${cli} down --workspace-folder ${testFolder}`);
			const response = JSON.parse(res.stdout);
			assert.equal(response.outcome, 'success');
			assert.equal(response.containerId, containerId);
			assert.equal(await containerState(containerId!), undefined);
		});

		it('should remove the container by --container-id', async () => {
			const res = await shellExec(`${cli} down --container-id ${containerId}`);
			const response = JSON.parse(res.stdout);
			assert.equal(response.outcome, 'success');
			assert.equal(await containerState(containerId!), undefined);
		});

		it('should succeed when the container is already removed', async () => {
			await shellExec(`docker rm -f ${containerId}`);
			const res = await shellExec(`${cli} down --workspace-folder ${testFolder}`);
			const response = JSON.parse(res.stdout);
			assert.equal(response.outcome, 'success');
			assert.equal(response.containerId, undefined);
		});
	});

	describe('Command stop and down with a Docker Compose config', () => {
		const testFolder = `${__dirname}/configs/compose-image-without-features-minimal`;
		let containerId: string | null = null;
		let composeProjectName: string | undefined = undefined;

		beforeEach(async () => ({ containerId, composeProjectName } = await devContainerUp(cli, testFolder)));
		afterEach(async () => await devContainerDown({ composeProjectName, doNotThrow: true }));

		it('should stop the Compose project', async () => {
			const res = await shellExec(`${cli} stop --workspace-folder ${testFolder}`);
			const response = JSON.parse(res.stdout);
			assert.equal(response.outcome, 'success');
			assert.equal(response.composeProjectName, composeProjectName);
			assert.equal(await containerState(containerId!), 'exited');
		});

		it('should remove the Compose project', async () => {
			const res = await shellExec(`${cli} down --workspace-folder ${testFolder}`);
			const response = JSON.parse(res.stdout);
			assert.equal(response.outcome, 'success');
			assert.equal(response.composeProjectName, composeProjectName);
			assert.equal(await containerState(containerId!), undefined);
		});
	});
});

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as path from 'path';
import { shellExec } from './testUtils';

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

	describe('Command set-up', () => {
		it('should succeed and run postAttachCommand from config', async () => {

			const containerId = (await shellExec(`docker run -d -e TEST_CE=TEST_VALUE alpine:3.17 sleep inf`)).stdout.trim();

			const res = await shellExec(`${cli} set-up --container-id ${containerId} --config ${__dirname}/configs/set-up-with-config/devcontainer.json --include-configuration --include-merged-configuration`);
			const response = JSON.parse(res.stdout);
			assert.equal(response.outcome, 'success');
			assert.equal(response.configuration?.remoteEnv?.TEST_RE, 'TEST_VALUE');
			assert.equal(response.mergedConfiguration?.remoteEnv?.TEST_RE, 'TEST_VALUE');

			await shellExec(`docker exec ${containerId} test -f /postAttachCommand.txt`);
			await shellExec(`docker rm -f ${containerId}`);
		});

		it('should succeed and run postCreateCommand from metadata', async () => {

			await shellExec(`docker build -t devcontainer-set-up-test ${__dirname}/configs/set-up-with-metadata`);
			const containerId = (await shellExec(`docker run -d -e TEST_CE=TEST_VALUE2 devcontainer-set-up-test sleep inf`)).stdout.trim();

			const res = await shellExec(`${cli} set-up --container-id ${containerId} --include-configuration --include-merged-configuration`);
			const response = JSON.parse(res.stdout);
			assert.equal(response.outcome, 'success');
			assert.equal(Object.keys(response.configuration).length, 0);
			assert.equal(response.mergedConfiguration?.remoteEnv?.TEST_RE, 'TEST_VALUE2');

			await shellExec(`docker exec ${containerId} test -f /postCreateCommand.txt`);
			await shellExec(`docker rm -f ${containerId}`);
		});
	});

	describe('Command run-user-commands', () => {
		it('should succeed and run postAttachCommand from config', async () => {

			const containerId = (await shellExec(`docker run -d alpine:3.17 sleep inf`)).stdout.trim();

			const res = await shellExec(`${cli} run-user-commands --container-id ${containerId} --config ${__dirname}/configs/set-up-with-config/devcontainer.json`);
			const response = JSON.parse(res.stdout);
			assert.equal(response.outcome, 'success');

			await shellExec(`docker exec ${containerId} test -f /postAttachCommand.txt`);
			await shellExec(`docker rm -f ${containerId}`);
		});

		it('should succeed and run postCreateCommand from metadata', async () => {

			await shellExec(`docker build -t devcontainer-set-up-test ${__dirname}/configs/set-up-with-metadata`);
			const containerId = (await shellExec(`docker run -d devcontainer-set-up-test sleep inf`)).stdout.trim();

			const res = await shellExec(`${cli} run-user-commands --container-id ${containerId}`);
			const response = JSON.parse(res.stdout);
			assert.equal(response.outcome, 'success');

			await shellExec(`docker exec ${containerId} test -f /postCreateCommand.txt`);
			await shellExec(`docker rm -f ${containerId}`);
		});
	});

	describe('Command read-configuration', () => {
		it('should succeed and return postAttachCommand from config', async () => {

			const containerId = (await shellExec(`docker run -d alpine:3.17 sleep inf`)).stdout.trim();

			const res = await shellExec(`${cli} read-configuration --container-id ${containerId} --config ${__dirname}/configs/set-up-with-config/devcontainer.json --include-merged-configuration`);
			const response = JSON.parse(res.stdout);
			assert.ok(response.configuration.postAttachCommand);
			assert.strictEqual(response.mergedConfiguration.postAttachCommands.length, 1);

			await shellExec(`docker rm -f ${containerId}`);
		});

		it('should succeed and return postCreateCommand from metadata', async () => {

			await shellExec(`docker build -t devcontainer-set-up-test ${__dirname}/configs/set-up-with-metadata`);
			const containerId = (await shellExec(`docker run -d devcontainer-set-up-test sleep inf`)).stdout.trim();

			const res = await shellExec(`${cli} read-configuration --container-id ${containerId} --include-merged-configuration`);
			const response = JSON.parse(res.stdout);
			assert.strictEqual(response.mergedConfiguration.postCreateCommands.length, 1);

			await shellExec(`docker rm -f ${containerId}`);
		});
	});

	describe('Command exec', () => {
		it('should succeed with config', async () => {

			const containerId = (await shellExec(`docker run -d alpine:3.17 sleep inf`)).stdout.trim();

			const res = await shellExec(`${cli} exec --container-id ${containerId} --config ${__dirname}/configs/set-up-with-config/devcontainer.json echo test-output`);
			assert.strictEqual(res.error, null);
			assert.match(res.stdout, /test-output/);

			await shellExec(`docker rm -f ${containerId}`);
		});

		it('should succeed with metadata', async () => {

			await shellExec(`docker build -t devcontainer-set-up-test ${__dirname}/configs/set-up-with-metadata`);
			const containerId = (await shellExec(`docker run -d devcontainer-set-up-test sleep inf`)).stdout.trim();

			const res = await shellExec(`${cli} exec --container-id ${containerId} echo test-output`);
			assert.strictEqual(res.error, null);
			assert.match(res.stdout, /test-output/);

			await shellExec(`docker rm -f ${containerId}`);
		});
	});
});

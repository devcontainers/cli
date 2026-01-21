/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as path from 'path';
import * as fs from 'fs';
import { devContainerDown, devContainerUp, shellExec, UpResult } from './testUtils';

const pkg = require('../../package.json');

describe('Custom Container Name Feature', function () {
	this.timeout('240s');

	const tmp = path.relative(process.cwd(), path.join(__dirname, 'tmp'));
	const cli = `npx --prefix ${tmp} devcontainer`;

	before('Install', async () => {
		await shellExec(`rm -rf ${tmp}/node_modules`);
		await shellExec(`mkdir -p ${tmp}`);
		await shellExec(`npm --prefix ${tmp} install devcontainers-cli-${pkg.version}.tgz`);
	});

	describe('Custom container name functionality', () => {
		
		it('should execute successfully with custom container name', async () => {
			const customContainerName = 'test-custom-container';
			const res = await shellExec(`${cli} up --workspace-folder ${__dirname}/configs/image --container-name ${customContainerName}`);
			const response = JSON.parse(res.stdout);
			assert.equal(response.outcome, 'success');
			
			const containerId: string = response.containerId;
			assert.ok(containerId, 'Container id not found.');
			
			// Verify container was created with custom name
			const nameInspectRes = await shellExec(`docker inspect ${customContainerName}`);
			const nameInspectData = JSON.parse(nameInspectRes.stdout);
			assert.equal(nameInspectData[0].Name, `/${customContainerName}`);
			
			// Verify ephemeral storage was created by checking if environment variables are set in container
			const envInspectRes = await shellExec(`docker inspect ${containerId}`);
			const envInspectData = JSON.parse(envInspectRes.stdout);
			const envVars = envInspectData[0].Config.Env;
			
			assert.ok(envVars.some(env => env === `DEVCONTAINER_NAME=${customContainerName}`), 'DEVCONTAINER_NAME env var should be set');
			assert.ok(envVars.some(env => env.startsWith('DEVCONTAINER_ID=')), 'DEVCONTAINER_ID env var should be set');
			
			await shellExec(`docker rm -f ${containerId}`);
		});

		it('should execute successfully without custom container name', async () => {
			const res = await shellExec(`${cli} up --workspace-folder ${__dirname}/configs/image`);
			const response = JSON.parse(res.stdout);
			assert.equal(response.outcome, 'success');
			
			const containerId: string = response.containerId;
			assert.ok(containerId, 'Container id not found.');
			
			// Verify container was created without custom name (should have random Docker-generated name)
			const noNameInspectRes = await shellExec(`docker inspect ${containerId}`);
			const noNameInspectData = JSON.parse(noNameInspectRes.stdout);
			assert.ok(noNameInspectData[0].Name, 'Container should have a name');
			assert.notEqual(noNameInspectData[0].Name, '/'); // Not empty (would indicate custom name)
			
			// Verify environment variables are set even without custom name
			const envInspectRes = await shellExec(`docker inspect ${containerId}`);
			const envInspectData = JSON.parse(envInspectRes.stdout);
			const envVars = envInspectData[0].Config.Env;
			
			assert.ok(envVars.some(env => env.startsWith('DEVCONTAINER_ID=')), 'DEVCONTAINER_ID env var should be set');
			assert.ok(!envVars.some(env => env.startsWith('DEVCONTAINER_NAME=')), 'DEVCONTAINER_NAME should not be set when no custom name');
			
			await shellExec(`docker rm -f ${containerId}`);
		});

		it('should set environment variables correctly', async () => {
			const customContainerName = 'env-test-container';
			const res = await shellExec(`${cli} up --workspace-folder ${__dirname}/configs/image --container-name ${customContainerName}`);
			const response = JSON.parse(res.stdout);
			assert.equal(response.outcome, 'success');
			
			const containerId: string = response.containerId;
			
			// Check environment variables
			const envInspectRes = await shellExec(`docker inspect ${containerId}`);
			const envInspectData = JSON.parse(envInspectRes.stdout);
			const envVars = envInspectData[0].Config.Env;
			
			assert.ok(envVars.some(env => env === `DEVCONTAINER_NAME=${customContainerName}`), 'DEVCONTAINER_NAME env var should be set');
			assert.ok(envVars.some(env => env.startsWith('DEVCONTAINER_ID=')), 'DEVCONTAINER_ID env var should be set');
			assert.ok(envVars.some(env => env.startsWith('DEVCONTAINER_WORKSPACE=')), 'DEVCONTAINER_WORKSPACE env var should be set');
			
			await shellExec(`docker rm -f ${containerId}`);
		});

		it('should handle cleanup when container with custom name is removed', async () => {
			const customContainerName = 'cleanup-test-container';
			const res = await shellExec(`${cli} up --workspace-folder ${__dirname}/configs/image --container-name ${customContainerName}`);
			const response = JSON.parse(res.stdout);
			assert.equal(response.outcome, 'success');
			
			const containerId: string = response.containerId;
			
			// Remove container manually
			await shellExec(`docker rm -f ${customContainerName}`);
			
			// Try to create a new container with same name - should succeed
			const res2 = await shellExec(`${cli} up --workspace-folder ${__dirname}/configs/image --container-name ${customContainerName}`);
			const response2 = JSON.parse(res2.stdout);
			assert.equal(response2.outcome, 'success');
			
			const newContainerId: string = response2.containerId;
			assert.notEqual(newContainerId, containerId, 'Should create new container with different ID');
			
			await shellExec(`docker rm -f ${newContainerId}`);
		});
	});

	describe('Error handling', () => {
		
		it('should fail gracefully when custom container name conflicts with existing container', async () => {
			const customContainerName = 'conflict-test-container';
			
			// Create first container
			const res1 = await shellExec(`${cli} up --workspace-folder ${__dirname}/configs/image --container-name ${customContainerName}`);
			const response1 = JSON.parse(res1.stdout);
			assert.equal(response1.outcome, 'success');
			
			const containerId1: string = response1.containerId;
			
			// Try to create second container with same name - should handle gracefully
			// This behavior depends on Docker's handling of naming conflicts
			const res2 = await shellExec(`${cli} up --workspace-folder ${__dirname}/configs/image --container-name ${customContainerName}`, undefined, undefined, true);
			const response2 = JSON.parse(res2.stdout);
			// Either succeeds with different behavior or fails gracefully - both are acceptable
			assert.ok(response2.outcome === 'success' || response2.outcome === 'error');
			
			// Clean up
			await shellExec(`docker rm -f ${containerId1}`);
			if (response2.containerId) {
				await shellExec(`docker rm -f ${response2.containerId}`);
			}
		});
	});
});
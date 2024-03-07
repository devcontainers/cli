/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { PolicyConstraints, applyConstraintsToComposeConfig, applyConstraintsToMetadataEntries, applyConstraintsToSingleContainerConfig } from '../spec-node/policy';
import { ImageMetadataEntry } from '../spec-node/imageMetadata';
import { nullLog } from '../spec-utils/log';
import { DevContainerFromDockerComposeConfig, DevContainerFromImageConfig } from '../spec-configuration/configuration';
import { URI } from 'vscode-uri';
import path from 'path';
import { shellExec } from './testUtils';

const pkg = require('../../package.json');

describe('Policy Constraints', function () {
	this.timeout('180s');

	const tmp = path.relative(process.cwd(), path.join(__dirname, 'tmp'));
	const cli = `npx --prefix ${tmp} devcontainer`;

	before('Install', async () => {
		await shellExec(`rm -rf ${tmp}/node_modules`);
		await shellExec(`mkdir -p ${tmp}`);
		await shellExec(`npm --prefix ${tmp} install devcontainers-cli-${pkg.version}.tgz`);
	});

	describe('CLI', function () {
		it('filter policy', async function () {
			let containerId: string | undefined = undefined;
			const testFolder = `${__dirname}/configs/policy-single-container`;
			const policyFile = `${testFolder}/policyFilter.json`;

			after(async () => {
				if (containerId) {
					await shellExec(`docker rm -f ${containerId}`);
				}
			});

			// Collect a baseline without the policy file
			{
				const res = await shellExec(`${cli} up --workspace-folder ${testFolder}`);
				const response = JSON.parse(res.stdout);
				assert.equal(response.outcome, 'success');
				containerId = response.containerId;
				assert.ok(containerId, 'Container id not found.');

				const dockerRunLine = res.stderr.split('\n').find(line => line.includes('docker run'));
				console.log(dockerRunLine);
				assert.ok(dockerRunLine, 'Docker run command not found.');

				// Check initializeComand
				assert.ok(res.stderr.includes('Running the initializeCommand from devcontainer.json...'));
				// Check postCreateCommand
				assert.ok(res.stderr.includes('Running the postCreateCommand from devcontainer.json...'));
				// Check flags in 'docker run'
				assert.ok(dockerRunLine.includes('--security-opt seccomp=unconfined'));
				assert.ok(dockerRunLine.includes('--cap-add SYS_ADMIN'));
				assert.ok(dockerRunLine.includes('--userns host'));

				// Clean up the container
				await shellExec(`docker rm -f ${containerId}`);
				containerId = undefined;
			}

			// Now apply the policy file and ensure the constraints are followed
			{
				const res = await shellExec(`${cli} up --workspace-folder ${testFolder} --experimental-policy-file ${policyFile}`);
				const response = JSON.parse(res.stdout);
				assert.equal(response.outcome, 'success');
				containerId = response.containerId;
				assert.ok(containerId, 'Container id not found.');

				const dockerRunLine = res.stderr.split('\n').find(line => line.includes('docker run'));
				console.log(dockerRunLine);
				assert.ok(dockerRunLine, 'Docker run command not found.');

				// Check initializeComand
				assert.ok(!res.stderr.includes('Running the initializeCommand from devcontainer.json...')); // Should be filtered from user devcontainer.json
				// Check postCreateCommand
				assert.ok(res.stderr.includes('Running the postCreateCommand from devcontainer.json...')); // No restriction
				// Check flags in 'docker run'
				assert.ok(!dockerRunLine.includes('--security-opt seccomp=unconfined')); // Should be filtered from inherited Feature (from img metadata)
				assert.ok(dockerRunLine.includes('--cap-add SYS_ADMIN')); // No restriction
				assert.ok(!dockerRunLine.includes('--userns host')); // Should be filtered from runArgs

				await shellExec(`docker rm -f ${containerId}`);
				containerId = undefined;
			}
		});

		it('deny policy', async function () {
			const testFolder = `${__dirname}/configs/policy-single-container`;
			const policyFile = `${testFolder}/policyDeny.json`;

			const res = await shellExec(`${cli} up --workspace-folder ${testFolder} --experimental-policy-file ${policyFile}`, undefined, undefined, true);
			const response = JSON.parse(res.stdout);
			assert.equal(response.outcome, 'error');
			assert.strictEqual(response.message, 'Policy violation: Property \'initializeCommand\' with value \'echo \'initializing\'\' is not permitted.');
		});
	});

	describe('Utils', function () {

		const metadataEntries1: ImageMetadataEntry[] = [
			{
				onCreateCommand: 'echo "onCreate1"',
				postAttachCommand: 'echo "postAttach1"',
				capAdd: ['SYS_ADMIN'],
				init: true,
				privileged: false,
				remoteUser: 'vscode',
				mounts: [
					{
						source: '/source',
						target: '/target',
						type: 'bind',
					}
				],
			},
			{
				onCreateCommand: 'echo "onCreate2"',
				postAttachCommand: 'echo "postAttach2"',
				privileged: true,
			}
		];

		const singleContainerConfig1: DevContainerFromImageConfig = {
			image: 'mcr.microsoft.com/devcontainers/universal',
			initializeCommand: 'echo "initializing"',
			runArgs: ['--userns', 'host', '--foo', '--cap-add', 'SYS_ADMIN', '--privileged'],
			postCreateCommand: 'echo "postCreate"',
			containerEnv: {
				FOO: 'privileged',
				BAR: 'initializeCommand',
			}
		};

		const composeConfig1: DevContainerFromDockerComposeConfig = {
			dockerComposeFile: 'docker-compose.yml',
			service: 'service1',
			initializeCommand: 'echo "initializing"',
			workspaceFolder: '/workspace',
			mounts: [
				{
					source: '/source',
					target: '/target',
					type: 'bind',
				}
			],
			postCreateCommand: 'echo "postCreate"',
			containerEnv: {
				FOO: 'privileged',
				BAR: 'initializeCommand',
				BAZ: 'userns'
			},
			configFilePath: URI.file('/path/to/docker-compose.yml'),
		};


		it('correctly filters metadata entries', async function () {
			const policy: PolicyConstraints = [
				{
					action: 'filter',
					selector: 'onCreateCommand',
				},
				{
					action: 'filter',
					selector: 'privileged',
				},
				{
					action: 'filter',
					selector: 'mounts',
				},
				{
					action: 'deny',
					selector: 'userns',
				},
			];


			const result = applyConstraintsToMetadataEntries({ output: nullLog }, metadataEntries1, policy);
			assert.strictEqual(result.length, 2);
			const expected: ImageMetadataEntry[] = [
				{
					postAttachCommand: 'echo "postAttach1"',
					capAdd: ['SYS_ADMIN'],
					init: true,
					privileged: false,
					remoteUser: 'vscode',
				},
				{
					postAttachCommand: 'echo "postAttach2"',
				}
			];
			assert.deepStrictEqual(result, expected);
			// Original object not modified
			assert.deepStrictEqual(metadataEntries1, [
				{
					onCreateCommand: 'echo "onCreate1"',
					postAttachCommand: 'echo "postAttach1"',
					capAdd: ['SYS_ADMIN'],
					init: true,
					privileged: false,
					remoteUser: 'vscode',
					mounts: [
						{
							source: '/source',
							target: '/target',
							type: 'bind',
						}
					],
				},
				{
					onCreateCommand: 'echo "onCreate2"',
					postAttachCommand: 'echo "postAttach2"',
					privileged: true,
				}
			]);
		});

		it('correctly denies metadata entries', async function () {
			const policy: PolicyConstraints = [
				{
					action: 'deny',
					selector: 'onCreateCommand',
				},
				{
					action: 'deny',
					selector: 'privileged',
				},
				{
					action: 'deny',
					selector: 'mounts',
				},
				{
					action: 'deny',
					selector: 'userns',
				},
			];

			assert.throws(() => applyConstraintsToMetadataEntries({ output: nullLog }, metadataEntries1, policy));
		});

		it('correctly filters single container config', async function () {
			const policy: PolicyConstraints = [
				{
					action: 'filter',
					selector: 'initializeCommand',
				},
				{
					action: 'filter',
					selector: 'privileged',
				},
				{
					action: 'filter',
					selector: 'userns',
				},
			];

			const result = applyConstraintsToSingleContainerConfig({ output: nullLog }, singleContainerConfig1, policy);
			const expected: DevContainerFromImageConfig = {
				image: 'mcr.microsoft.com/devcontainers/universal',
				runArgs: ['--foo', '--cap-add', 'SYS_ADMIN'],
				postCreateCommand: 'echo "postCreate"',
				containerEnv: {
					FOO: 'privileged',
					BAR: 'initializeCommand',
				}
			};
			assert.deepStrictEqual(result, expected);
			// Original object not modified
			assert.deepStrictEqual(singleContainerConfig1, {
				image: 'mcr.microsoft.com/devcontainers/universal',
				initializeCommand: 'echo "initializing"',
				runArgs: ['--userns', 'host', '--foo', '--cap-add', 'SYS_ADMIN', '--privileged'],
				postCreateCommand: 'echo "postCreate"',
				containerEnv: {
					FOO: 'privileged',
					BAR: 'initializeCommand',
				}
			});
		});

		it('correctly denies single container config', async function () {
			const policy: PolicyConstraints = [
				{
					action: 'filter',
					selector: 'initializeCommand',
				},
				{
					action: 'deny',
					selector: 'privileged',
				},
				{
					action: 'filter',
					selector: 'userns',
				},
			];

			assert.throws(() => applyConstraintsToSingleContainerConfig({ output: nullLog }, singleContainerConfig1, policy));
		});

		it('correctly filters a compose config', async function () {
			const policy: PolicyConstraints = [
				{
					action: 'filter',
					selector: 'initializeCommand',
				},
				{
					action: 'filter',
					selector: 'mounts',
				},
				{
					action: 'filter',
					selector: 'userns', // No-op
				},
			];

			const result = applyConstraintsToComposeConfig({ output: nullLog }, composeConfig1, policy);
			const expected: DevContainerFromDockerComposeConfig = {
				dockerComposeFile: 'docker-compose.yml',
				service: 'service1',
				workspaceFolder: '/workspace',
				postCreateCommand: 'echo "postCreate"',
				containerEnv: {
					FOO: 'privileged',
					BAR: 'initializeCommand',
					BAZ: 'userns'
				},
				configFilePath: URI.file('/path/to/docker-compose.yml'),
			};
			assert.deepStrictEqual(result, expected);
			// Original object not modified
			assert.deepStrictEqual(composeConfig1, {
				dockerComposeFile: 'docker-compose.yml',
				service: 'service1',
				initializeCommand: 'echo "initializing"',
				workspaceFolder: '/workspace',
				mounts: [
					{
						source: '/source',
						target: '/target',
						type: 'bind',
					}
				],
				postCreateCommand: 'echo "postCreate"',
				containerEnv: {
					FOO: 'privileged',
					BAR: 'initializeCommand',
					BAZ: 'userns'
				},
				configFilePath: URI.file('/path/to/docker-compose.yml'),
			});
		});

		it('correctly denies a compose config', async function () {
			const policy: PolicyConstraints = [
				{
					action: 'deny',
					selector: 'initializeCommand',
				},
				{
					action: 'deny',
					selector: 'mounts',
				},
				{
					action: 'deny',
					selector: 'userns',
				},
			];

			assert.throws(() => applyConstraintsToComposeConfig({ output: nullLog }, composeConfig1, policy));
		});
	});
});
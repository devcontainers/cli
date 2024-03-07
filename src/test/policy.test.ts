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

// const pkg = require('../../package.json');

describe('Policy Constraints', function () {


	describe('CLI', function () {
		it('policy followed', async function () {
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
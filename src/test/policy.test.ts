/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { PolicyConstraints, applyConstraintsToMetadataEntries } from '../spec-node/policy';
import { ImageMetadataEntry } from '../spec-node/imageMetadata';
import { nullLog } from '../spec-utils/log';

// const pkg = require('../../package.json');

describe('Policy Constraints', function () {


	describe('CLI', function () {
		it('policy followed', async function () {
		});
	});

	describe('Utils', function () {

		const metadataEntries01: ImageMetadataEntry[] = [
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


			const result = applyConstraintsToMetadataEntries({ output: nullLog }, metadataEntries01, policy);
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
			assert.deepStrictEqual(metadataEntries01, [
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
	});

});
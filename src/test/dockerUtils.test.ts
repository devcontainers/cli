/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createPlainLog, LogLevel, makeLog } from '../spec-utils/log';
import { inspectImageInRegistry, qualifyImageName } from '../spec-node/utils';
import assert from 'assert';
import { dockerCLI, listContainers, PartialExecParameters, removeContainer, toExecParameters } from '../spec-shutdown/dockerUtils';
import { createCLIParams } from './testUtils';

export const output = makeLog(createPlainLog(text => process.stdout.write(text), () => LogLevel.Trace));

describe('Docker utils', function () {
	this.timeout(20 * 1000);

	it('inspect image in docker.io', async () => {
		const imageName = 'docker.io/library/ubuntu:latest';
		const config = await inspectImageInRegistry(output, { arch: 'amd64', os: 'linux' }, imageName);
		assert.ok(config);
		assert.ok(config.Id);
		assert.ok(config.Config.Cmd);
	});

	it('inspect image in mcr.microsoft.com', async () => {
		const imageName = 'mcr.microsoft.com/devcontainers/rust:1';
		const config = await inspectImageInRegistry(output, { arch: 'amd64', os: 'linux' }, imageName);
		assert.ok(config);
		assert.ok(config.Id);
		assert.ok(config.Config.Cmd);
		const metadataStr = config.Config.Labels?.['devcontainer.metadata'];
		assert.ok(metadataStr);
		const obj = JSON.parse(metadataStr);
		assert.ok(obj && typeof obj === 'object');
	});

	it('inspect image in ghcr.io', async () => {
		const imageName = 'ghcr.io/chrmarti/cache-from-test/images/test-cache:latest';
		const config = await inspectImageInRegistry(output, { arch: 'amd64', os: 'linux' }, imageName);
		assert.ok(config);
		assert.ok(config.Id);
		assert.ok(config.Config.Cmd);
	});

	it('qualifies docker.io shorthands', async () => {
		assert.strictEqual(qualifyImageName('ubuntu'), 'docker.io/library/ubuntu');
		assert.strictEqual(qualifyImageName('docker.io/ubuntu'), 'docker.io/library/ubuntu');
		assert.strictEqual(qualifyImageName('random/image'), 'docker.io/random/image');
		assert.strictEqual(qualifyImageName('foo/random/image'), 'foo/random/image');
	});

	it('protects against concurrent removal', async () => {
		const params = await createCLIParams(__dirname);
		const verboseParams = { ...toExecParameters(params), output: makeLog(output, LogLevel.Info), print: 'continuous' as 'continuous' };
		const { stdout } = await dockerCLI(verboseParams, 'run', '-d', 'ubuntu:latest', 'sleep', 'inf');
		const containerId = stdout.toString().trim();
		const start = Date.now();
		await Promise.all([
			testRemoveContainer(verboseParams, containerId),
			testRemoveContainer(verboseParams, containerId),
			testRemoveContainer(verboseParams, containerId),
		]);
		console.log('removal took', Date.now() - start, 'ms');
	});
});

async function testRemoveContainer(params: PartialExecParameters, nameOrId: string) {
	await removeContainer(params, nameOrId);
	const all = await listContainers(params, true);
	if (all.some(shortId => nameOrId.startsWith(shortId))) {
		throw new Error('container still exists');
	}
}

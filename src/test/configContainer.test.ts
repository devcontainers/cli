/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';
import { assert } from 'chai';
import { URI } from 'vscode-uri';
import { getCLIHost, loadNativeModule } from '../spec-common/commonUtils';
import { DevContainerFromImageConfig } from '../spec-configuration/configuration';
import { readDevContainerConfigFile } from '../spec-node/configContainer';
import { Workspace } from '../spec-utils/workspaces';
import { nullLog } from '../spec-utils/log';

const workspace: Workspace = {
	isWorkspaceFile: false,
	workspaceOrFolderPath: '/foo/bar',
	rootFolderPath: '/foo/bar',
	configFolderPath: '/foo/bar',
};

async function readConfig(relativePath: string) {
	const cliHost = await getCLIHost(process.cwd(), loadNativeModule, false);
	const configFile = URI.file(path.resolve(relativePath));
	return readDevContainerConfigFile(cliHost, workspace, configFile, false, false, nullLog);
}

async function expectReadConfigError(relativePath: string, pattern: RegExp) {
	try {
		await readConfig(relativePath);
		assert.fail('expected read to throw');
	} catch (err: any) {
		assert.match(String(err.description || err.message), pattern);
	}
}

describe('readDevContainerConfigFile', function () {
	it('can read a basic configuration file', async function () {
		const configs = await readConfig('./src/test/configs/example/.devcontainer.json');
		assert.isOk(configs);
		assert.property(configs, 'config');
		assert.isOk(configs?.config.config);

		const features = configs?.config.config.features as Record<string, string | boolean | Record<string, string | boolean>>;
		assert.hasAllKeys(features, ['ghcr.io/devcontainers/features/github-cli:1']);
	});

	it('can resolve an "extends" file reference', async function () {
		const configs = await readConfig('./src/test/configs/extends/.devcontainer.json');
		assert.isOk(configs);
		const raw = configs?.config.raw as DevContainerFromImageConfig;
		assert.strictEqual(raw.name, 'Overrides');
		assert.strictEqual(raw.image, 'ubuntu:latest');
		assert.deepEqual(raw.forwardPorts, [80, 443]);
		assert.deepEqual(raw.capAdd, ['SYS_PTRACE', 'NET_ADMIN']);
		assert.strictEqual(raw.hostRequirements?.cpus, 2);
		assert.strictEqual(raw.hostRequirements?.memory, `${8 * 2 ** 30}`);
		assert.deepEqual(raw.remoteEnv, { FROM_BASE: 'base', OVERRIDE_ME: 'child' });
		assert.notProperty(raw, 'extends');
		assert.notProperty(raw, 'extendsMergeMode');
	});

	it('can resolve nested "extends" file references', async function () {
		const configs = await readConfig('./src/test/configs/extends/.devcontainer.nested.json');
		assert.isOk(configs);
		assert.strictEqual(configs?.config.raw.name, 'Nested');
		assert.deepEqual(configs?.config.raw.forwardPorts, [80, 443, 2222]);
		assert.strictEqual((configs?.config.raw as DevContainerFromImageConfig).image, 'ubuntu:latest');
	});

	it('rejects a cyclic "extends" reference', async function () {
		await expectReadConfigError('./src/test/configs/extends/.devcontainer.cycle-a.json', /cyclic "extends" reference/);
	});

	it('can resolve "extends" with extendsMergeMode override', async function () {
		const configs = await readConfig('./src/test/configs/extends/.devcontainer.override.json');
		assert.isOk(configs);
		const raw = configs?.config.raw as DevContainerFromImageConfig;
		assert.strictEqual(raw.name, 'Override merge');
		assert.strictEqual(raw.image, 'ubuntu:latest');
		assert.deepEqual(raw.forwardPorts, [443]);
		assert.strictEqual(raw.init, false);
		assert.deepEqual(raw.remoteEnv, { OVERRIDE_ME: 'child' });
		assert.deepEqual(raw.hostRequirements, { memory: '4gb' });
		assert.notProperty(raw, 'extends');
		assert.notProperty(raw, 'extendsMergeMode');
	});

	it('rejects an invalid "extendsMergeMode" value', async function () {
		await expectReadConfigError('./src/test/configs/extends/.devcontainer.invalid-merge.json', /extendsMergeMode.*combine.*override/);
	});

	it('rejects a missing "extends" file', async function () {
		await expectReadConfigError('./src/test/configs/extends/.devcontainer.missing.json', /was not found/);
	});
});

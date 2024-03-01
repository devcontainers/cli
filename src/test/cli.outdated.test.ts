/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as path from 'path';
import * as semver from 'semver';
import { shellExec } from './testUtils';

const pkg = require('../../package.json');

describe('Outdated', function () {
	this.timeout('240s');

	const tmp = path.relative(process.cwd(), path.join(__dirname, 'tmp'));
	const cli = `npx --prefix ${tmp} devcontainer`;

	before('Install', async () => {
		await shellExec(`rm -rf ${tmp}/node_modules`);
		await shellExec(`mkdir -p ${tmp}`);
		await shellExec(`npm --prefix ${tmp} install devcontainers-cli-${pkg.version}.tgz`);
	});

	it('outdated command with json output', async () => {
		const workspaceFolder = path.join(__dirname, 'configs/lockfile-outdated-command');

		const res = await shellExec(`${cli} outdated --workspace-folder ${workspaceFolder} --output-format json`);
		const response = JSON.parse(res.stdout);

		const git = response.features['ghcr.io/devcontainers/features/git:1.0'];
		assert.ok(git);
		assert.strictEqual(git.current, '1.0.4');
		assert.ok(semver.gt(git.wanted, git.current), `semver.gt(${git.wanted}, ${git.current}) is false`);
		assert.ok(semver.gt(git.latest, git.wanted), `semver.gt(${git.latest}, ${git.wanted}) is false`);

		const lfs = response.features['ghcr.io/devcontainers/features/git-lfs@sha256:24d5802c837b2519b666a8403a9514c7296d769c9607048e9f1e040e7d7e331c'];
		assert.ok(lfs);
		assert.strictEqual(lfs.current, '1.0.6');
		assert.strictEqual(lfs.current, lfs.wanted);
		assert.ok(semver.gt(lfs.latest, lfs.wanted), `semver.gt(${lfs.latest}, ${lfs.wanted}) is false`);

		const github = response.features['ghcr.io/devcontainers/features/github-cli'];
		assert.ok(github);
		assert.strictEqual(github.current, github.latest);
		assert.strictEqual(github.wanted, github.latest);

		const azure = response.features['ghcr.io/devcontainers/features/azure-cli:0'];
		assert.ok(azure);
		assert.strictEqual(azure.current, undefined);
		assert.strictEqual(azure.wanted, undefined);
		assert.ok(azure.latest);

		const foo = response.features['ghcr.io/codspace/versioning/foo:0.3.1'];
		assert.ok(foo);
		assert.strictEqual(foo.current, '0.3.1');
		assert.strictEqual(foo.wanted, '0.3.1');
		assert.strictEqual(foo.wantedMajor, '0');
		assert.strictEqual(foo.latest, '2.11.1');
		assert.strictEqual(foo.latestMajor, '2');
	});

	it('outdated command with text output', async () => {
		const workspaceFolder = path.join(__dirname, 'configs/lockfile-outdated-command');

		const res = await shellExec(`${cli} outdated --workspace-folder ${workspaceFolder} --output-format text`);
		const response = res.stdout;
		// Count number of lines of output
		assert.strictEqual(response.split('\n').length, 7); // 5 valid Features + header + empty line

		// Check that the header is present
		assert.ok(response.includes('Current'), 'Current column is missing');
		assert.ok(response.includes('Wanted'), 'Wanted column is missing');
		assert.ok(response.includes('Latest'), 'Latest column is missing');

		// Check that the features are present
		// The version values are checked for correctness in the json variant of this test
		assert.ok(response.includes('ghcr.io/devcontainers/features/git'), 'git Feature is missing');
		assert.ok(response.includes('ghcr.io/devcontainers/features/git-lfs'), 'git-lfs Feature is missing');
		assert.ok(response.includes('ghcr.io/devcontainers/features/github-cli'), 'github-cli Feature is missing');
		assert.ok(response.includes('ghcr.io/devcontainers/features/azure-cli'), 'azure-cli Feature is missing');
		assert.ok(response.includes('ghcr.io/codspace/versioning/foo'), 'foo Feature is missing');

		// Check that filtered Features are not present
		assert.ok(!response.includes('mylocalfeature'));
		assert.ok(!response.includes('terraform'));
		assert.ok(!response.includes('myfeatures'));
	});
});
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

	it('json output', async () => {
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

		assert.equal(Object.keys(response.images).length, 1);
		const baseImage = response.images['mcr.microsoft.com/devcontainers/base:0-ubuntu-20.04'];
		assert.ok(baseImage);
		assert.strictEqual(baseImage.name, 'mcr.microsoft.com/devcontainers/base');
		assert.strictEqual(baseImage.current, '0-ubuntu-20.04');
		assert.notStrictEqual(baseImage.wanted, baseImage.version);
		assert.ok((parseInt(baseImage.wantedVersion) > parseInt(baseImage.version)), `semver.gt(${baseImage.wantedVersion}, ${baseImage.version}) is false`);
		assert.strictEqual(baseImage.currentImageValue, 'mcr.microsoft.com/devcontainers/base:0-ubuntu-20.04');
		assert.notStrictEqual(baseImage.newImageValue, baseImage.currentImageValue);
		assert.strictEqual(baseImage.newImageValue, `mcr.microsoft.com/devcontainers/base:${baseImage.wantedVersion}-ubuntu-20.04`);
	});

	it('text output', async () => {
		const workspaceFolder = path.join(__dirname, 'configs/lockfile-outdated-command');

		const res = await shellExec(`${cli} outdated --workspace-folder ${workspaceFolder} --output-format text`);
		const response = res.stdout;
		// Count number of lines of output
		assert.strictEqual(response.split('\n').length, 10); // 5 valid Features + header + empty line + image

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

		// Check that the image is present
		assert.ok(response.includes('mcr.microsoft.com/devcontainers/base'), 'Image is missing');
		assert.ok(response.includes('0-ubuntu-20.04'), 'Image version is missing');
	});

	it('dockerfile', async () => {
		const workspaceFolder = path.join(__dirname, 'configs/dockerfile-with-features');

		const res = await shellExec(`${cli} outdated --workspace-folder ${workspaceFolder} --output-format json`);
		const response = JSON.parse(res.stdout);
		assert.equal(Object.keys(response.images).length, 0);
	});

	it('dockerfile-with-variant-multi-stage', async () => {
		const workspaceFolder = path.join(__dirname, 'configs/dockerfile-with-target');

		const res = await shellExec(`${cli} outdated --workspace-folder ${workspaceFolder} --output-format json`);
		const response = JSON.parse(res.stdout);

		assert.equal(Object.keys(response.images).length, 2);

		const typeScript = response.images['mcr.microsoft.com/devcontainers/typescript-node:1.0.5-${VARIANT}'];
		assert.ok(typeScript);
		assert.strictEqual(typeScript.name, 'mcr.microsoft.com/devcontainers/typescript-node');
		assert.strictEqual(typeScript.current, '1.0.5-18-bookworm');
		assert.notStrictEqual(typeScript.wanted, typeScript.version);
		assert.ok(semver.gt(typeScript.wantedVersion, typeScript.version), `semver.gt(${typeScript.wantedVersion}, ${typeScript.version}) is false`);
		assert.strictEqual(typeScript.currentImageValue, 'mcr.microsoft.com/devcontainers/typescript-node:1.0.5-${VARIANT}');
		assert.notStrictEqual(typeScript.newImageValue, typeScript.currentImageValue);
		assert.strictEqual(typeScript.newImageValue, `mcr.microsoft.com/devcontainers/typescript-node:${typeScript.wantedVersion}-\${VARIANT}`);

		const alpine = response.images['mcr.microsoft.com/devcontainers/base:0.207.2-alpine3.18'];
		assert.ok(alpine);
		assert.strictEqual(alpine.name, 'mcr.microsoft.com/devcontainers/base');
		assert.strictEqual(alpine.current, '0.207.2-alpine3.18');
		assert.notStrictEqual(alpine.wanted, alpine.version);
		assert.ok(semver.gt(alpine.wantedVersion, alpine.version), `semver.gt(${alpine.wantedVersion}, ${alpine.version}) is false`);
		assert.strictEqual(alpine.currentImageValue, 'mcr.microsoft.com/devcontainers/base:0.207.2-alpine3.18');
		assert.notStrictEqual(alpine.newImageValue, alpine.currentImageValue);
		assert.strictEqual(alpine.newImageValue, `mcr.microsoft.com/devcontainers/base:${alpine.wantedVersion}-alpine3.18`);
	});

	it('dockercompose-image', async () => {
		const workspaceFolder = path.join(__dirname, 'configs/compose-image-with-features');

		const res = await shellExec(`${cli} outdated --workspace-folder ${workspaceFolder} --output-format json`);
		const response = JSON.parse(res.stdout);

		assert.equal(Object.keys(response.images).length, 1);

		const javascript = response.images['mcr.microsoft.com/devcontainers/javascript-node:0.204-18-buster'];
		assert.ok(javascript);
		assert.strictEqual(javascript.name, 'mcr.microsoft.com/devcontainers/javascript-node');
		assert.strictEqual(javascript.current, '0.204-18-buster');
		assert.notStrictEqual(javascript.wanted, javascript.version);
		assert.ok((parseFloat(javascript.wantedVersion) > parseFloat(javascript.version)), `semver.gt(${javascript.wantedVersion}, ${javascript.version}) is false`);
		assert.strictEqual(javascript.currentImageValue, 'mcr.microsoft.com/devcontainers/javascript-node:0.204-18-buster');
		assert.notStrictEqual(javascript.newImageValue, javascript.currentImageValue);
		assert.strictEqual(javascript.newImageValue, `mcr.microsoft.com/devcontainers/javascript-node:${javascript.wantedVersion}-18-buster`);
	});

	it('dockercompose-dockerfile', async () => {
		const workspaceFolder = path.join(__dirname, 'configs/compose-Dockerfile-with-features');

		const res = await shellExec(`${cli} outdated --workspace-folder ${workspaceFolder} --output-format json`);
		const response = JSON.parse(res.stdout);

		assert.equal(Object.keys(response.images).length, 1);

		const javascript = response.images['mcr.microsoft.com/devcontainers/javascript-node:0-${VARIANT}'];
		assert.ok(javascript);
		assert.strictEqual(javascript.name, 'mcr.microsoft.com/devcontainers/javascript-node');
		assert.strictEqual(javascript.current, '0-16-bullseye');
		assert.notStrictEqual(javascript.wanted, javascript.version);
		assert.ok((parseFloat(javascript.wantedVersion) > parseFloat(javascript.version)), `semver.gt(${javascript.wantedVersion}, ${javascript.version}) is false`);
		assert.strictEqual(javascript.currentImageValue, 'mcr.microsoft.com/devcontainers/javascript-node:0-${VARIANT}');
		assert.notStrictEqual(javascript.newImageValue, javascript.currentImageValue);
		assert.strictEqual(javascript.newImageValue, `mcr.microsoft.com/devcontainers/javascript-node:${javascript.wantedVersion}-\${VARIANT}`);
	});
});
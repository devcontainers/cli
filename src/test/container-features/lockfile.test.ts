/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as path from 'path';
import { shellExec } from '../testUtils';
import { cpLocal, readLocalFile, rmLocal } from '../../spec-utils/pfs';

const pkg = require('../../../package.json');

describe('Lockfile', function () {
	this.timeout('240s');

	const tmp = path.relative(process.cwd(), path.join(__dirname, 'tmp'));
	const cli = `npx --prefix ${tmp} devcontainer`;

	before('Install', async () => {
		await shellExec(`rm -rf ${tmp}/node_modules`);
		await shellExec(`mkdir -p ${tmp}`);
		await shellExec(`npm --prefix ${tmp} install devcontainers-cli-${pkg.version}.tgz`);
	});

	it('write lockfile', async () => {
		const workspaceFolder = path.join(__dirname, 'configs/lockfile');

		const lockfilePath = path.join(workspaceFolder, '.devcontainer-lock.json');
		await rmLocal(lockfilePath, { force: true });

		const res = await shellExec(`${cli} build --workspace-folder ${workspaceFolder} --experimental-lockfile`);
		const response = JSON.parse(res.stdout);
		assert.equal(response.outcome, 'success');
		const actual = await readLocalFile(lockfilePath);
		const expected = await readLocalFile(path.join(workspaceFolder, 'expected.devcontainer-lock.json'));
		assert.equal(actual.toString(), expected.toString());
	});

	it('lockfile with dependencies', async () => {
		const workspaceFolder = path.join(__dirname, 'configs/lockfile-dependson');

		const lockfilePath = path.join(workspaceFolder, '.devcontainer-lock.json');
		await rmLocal(lockfilePath, { force: true });

		const res = await shellExec(`${cli} build --workspace-folder ${workspaceFolder} --experimental-lockfile`);
		const response = JSON.parse(res.stdout);
		assert.equal(response.outcome, 'success');
		const actual = await readLocalFile(lockfilePath);
		const expected = await readLocalFile(path.join(workspaceFolder, 'expected.devcontainer-lock.json'));
		assert.equal(actual.toString(), expected.toString());
	});

	it('frozen lockfile', async () => {
		const workspaceFolder = path.join(__dirname, 'configs/lockfile-frozen');
		const lockfilePath = path.join(workspaceFolder, '.devcontainer-lock.json');
		const expected = await readLocalFile(lockfilePath);
		const res = await shellExec(`${cli} build --workspace-folder ${workspaceFolder} --experimental-lockfile --experimental-frozen-lockfile`);
		const response = JSON.parse(res.stdout);
		assert.equal(response.outcome, 'success');
		const actual = await readLocalFile(lockfilePath);
		assert.equal(actual.toString(), expected.toString());
	});

	it('outdated lockfile', async () => {
		const workspaceFolder = path.join(__dirname, 'configs/lockfile-outdated');

		const lockfilePath = path.join(workspaceFolder, '.devcontainer-lock.json');
		await cpLocal(path.join(workspaceFolder, 'original.devcontainer-lock.json'), lockfilePath);

		{
			try {
				throw await shellExec(`${cli} build --workspace-folder ${workspaceFolder} --experimental-lockfile --experimental-frozen-lockfile`);
			} catch (res) {
				const response = JSON.parse(res.stdout);
				assert.equal(response.outcome, 'error');
			}
		}

		{
			const res = await shellExec(`${cli} build --workspace-folder ${workspaceFolder} --experimental-lockfile`);
			const response = JSON.parse(res.stdout);
			assert.equal(response.outcome, 'success');
			const actual = await readLocalFile(lockfilePath);
			const expected = await readLocalFile(path.join(workspaceFolder, 'expected.devcontainer-lock.json'));
			assert.equal(actual.toString(), expected.toString());
		}
	});

	it('upgrade command', async () => {
		const workspaceFolder = path.join(__dirname, 'configs/lockfile-upgrade-command');

		const lockfilePath = path.join(workspaceFolder, '.devcontainer-lock.json');
		await cpLocal(path.join(workspaceFolder, 'outdated.devcontainer-lock.json'), lockfilePath);

		await shellExec(`${cli} upgrade --workspace-folder ${workspaceFolder}`);
		const actual = await readLocalFile(lockfilePath);
		const expected = await readLocalFile(path.join(workspaceFolder, 'upgraded.devcontainer-lock.json'));
		assert.equal(actual.toString(), expected.toString());
	});

	it('upgrade command in --dry-run mode', async () => {
		const workspaceFolder = path.join(__dirname, 'configs/lockfile-dependson');
		const res = await shellExec(`${cli} upgrade --dry-run --workspace-folder ${workspaceFolder}`);
		const lockfile = JSON.parse(res.stdout);
		assert.ok(lockfile);
		assert.ok(lockfile.features);
		assert.ok(lockfile.features['ghcr.io/codspace/dependson/A:2']);
	});

	it('upgrade command with --feature', async () => {
		const workspaceFolder = path.join(__dirname, 'configs/lockfile-upgrade-feature');
		await cpLocal(path.join(workspaceFolder, 'input.devcontainer.json'), path.join(workspaceFolder, '.devcontainer.json'));

		const res = await shellExec(`${cli} upgrade --dry-run --workspace-folder ${workspaceFolder} --feature ghcr.io/codspace/versioning/foo --target-version 2`);

		// Check devcontainer.json was updated
		const actual = await readLocalFile(path.join(workspaceFolder, '.devcontainer.json'));
		const expected = await readLocalFile(path.join(workspaceFolder, 'expected.devcontainer.json'));
		assert.equal(actual.toString(), expected.toString());

		// Check lockfile was updated
		const lockfile = JSON.parse(res.stdout);
		assert.ok(lockfile);
		assert.ok(lockfile.features);
		assert.ok(lockfile.features['ghcr.io/codspace/versioning/foo:2'].version === '2.11.1');
	});

	it('OCI feature integrity', async () => {
		const workspaceFolder = path.join(__dirname, 'configs/lockfile-oci-integrity');

		try {
			throw await shellExec(`${cli} build --workspace-folder ${workspaceFolder} --experimental-lockfile`);
		} catch (res) {
			const response = JSON.parse(res.stdout);
			assert.equal(response.outcome, 'error');
		}
	});

	it('tarball URI feature integrity', async () => {
		const workspaceFolder = path.join(__dirname, 'configs/lockfile-tarball-integrity');

		try {
			throw await shellExec(`${cli} build --workspace-folder ${workspaceFolder} --experimental-lockfile`);
		} catch (res) {
			const response = JSON.parse(res.stdout);
			assert.equal(response.outcome, 'error');
		}
	});

	it('empty lockfile should init', async () => {
		const workspaceFolder = path.join(__dirname, 'configs/lockfile-generate-from-empty-file');
		const lockfilePath = path.join(workspaceFolder, '.devcontainer', 'devcontainer-lock.json');
		const cleanup = async () => {
			await rmLocal(lockfilePath, { force: true });
			await shellExec(`touch ${lockfilePath}`);
		};

		await cleanup();
		const res = await shellExec(`${cli} build --workspace-folder ${workspaceFolder}`);
		const response = JSON.parse(res.stdout);
		assert.equal(response.outcome, 'success');
		const actual = JSON.parse((await readLocalFile(lockfilePath)).toString());
		assert.ok(actual.features['ghcr.io/devcontainers/features/dotnet:2']);
		await cleanup();
	});

	it('empty lockfile should not init when frozen', async () => {
		const workspaceFolder = path.join(__dirname, 'configs/lockfile-generate-from-empty-file-frozen');
		const lockfilePath = path.join(workspaceFolder, '.devcontainer', 'devcontainer-lock.json');
		const cleanup = async () => {
			await rmLocal(lockfilePath, { force: true });
			await shellExec(`touch ${lockfilePath}`);
		};

		await cleanup();
		try {
			await shellExec(`${cli} build --workspace-folder ${workspaceFolder} --experimental-frozen-lockfile`);
			await cleanup();
		} catch (res) {
			const response = JSON.parse(res.stdout);
			assert.equal(response.outcome, 'error');
			assert.equal(response.message, 'Lockfile does not match.');
			await cleanup();
		}
	});
});
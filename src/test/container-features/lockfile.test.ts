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
});
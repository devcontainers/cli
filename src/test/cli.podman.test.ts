/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as path from 'path';
import { readFile, writeFile } from 'fs/promises';
import { shellExec } from './testUtils';

const pkg = require('../../package.json');

describe('Dev Containers CLI using Podman', function () {
	this.timeout('240s');

	const tmp = path.relative(process.cwd(), path.join(__dirname, 'tmp'));
	const cli = `npx --prefix ${tmp} devcontainer`;

	before('Install', async () => {
		await shellExec(`rm -rf ${tmp}/node_modules`);
		await shellExec(`mkdir -p ${tmp}`);
		if (process.env.GITHUB_ACTIONS === 'true') {
			const storageConfig = path.join(process.env.HOME!, '.config', 'containers', 'storage.conf');
			const storageConfigContent = await readFile(storageConfig, 'utf8');
			const updatedStorageConfigContent = storageConfigContent.replace(
				/^(\s*ignore_chown_errors\s*=\s*)"true"/m,
				'$1"false"'
			);
			if (updatedStorageConfigContent !== storageConfigContent) {
				// The hosted runner's Podman bundle enables ownership squashing,
				// which prevents APT's unprivileged _apt user from writing during builds.
				await shellExec('podman system reset --force');
				await writeFile(storageConfig, updatedStorageConfigContent);
			}
		}
		await shellExec(`npm --prefix ${tmp} install devcontainers-cli-${pkg.version}.tgz`);
	});

	describe('Command up using Podman', () => {

		it('should execute successfully with valid config with features', async () => {
			const res = await shellExec(`${cli} up --docker-path podman --workspace-folder ${__dirname}/configs/image-with-features`);
			const response = JSON.parse(res.stdout);
			assert.equal(response.outcome, 'success');
			const containerId: string = response.containerId;
			assert.ok(containerId, 'Container id not found.');
			await shellExec(`podman rm -f ${containerId}`);
		});

		it('should execute successfully with valid config with features', async () => {
			const res = await shellExec(`${cli} up --docker-path podman --workspace-folder ${__dirname}/configs/dockerfile-with-features`);
			const response = JSON.parse(res.stdout);
			assert.equal(response.outcome, 'success');
			const containerId: string = response.containerId;
			assert.ok(containerId, 'Container id not found.');
			await shellExec(`podman rm -f ${containerId}`);
		});
	});
});
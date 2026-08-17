/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as path from 'path';
import { shellExec } from './testUtils';

const pkg = require('../../package.json');

describe('Dev Containers CLI using Podman', function () {
	this.timeout('240s');

	const tmp = path.relative(process.cwd(), path.join(__dirname, 'tmp'));
	const cli = `npx --prefix ${tmp} devcontainer`;

	before('Install', async () => {
		await shellExec(`rm -rf ${tmp}/node_modules`);
		await shellExec(`mkdir -p ${tmp}`);
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
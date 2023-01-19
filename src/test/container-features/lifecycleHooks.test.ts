/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { assert } from 'chai';
import * as path from 'path';
import { devContainerDown, devContainerUp, shellExec } from '../testUtils';

const pkg = require('../../../package.json');

describe('Feature lifecycle hooks', function () {
	this.timeout('120s');

	const tmp = path.relative(process.cwd(), path.join(__dirname, 'tmp5'));
	const cli = `npx --prefix ${tmp} devcontainer`;

	before('Install', async () => {
		await shellExec(`rm -rf ${tmp}/node_modules`);
		await shellExec(`mkdir -p ${tmp}`);
		await shellExec(`npm --prefix ${tmp} install devcontainers-cli-${pkg.version}.tgz`);
	});

	describe('lifecycle-hooks-inline-commands', () => {

		describe(`devcontainer up`, () => {
			let containerId: string | null = null;
			const testFolder = `${__dirname}/configs/lifecycle-hooks-inline-commands`;
			
			before(async () => {
				await shellExec(`rm -f ${testFolder}/*.testMarker`, undefined, undefined, true);
				containerId = (await devContainerUp(cli, testFolder, { 'logLevel': 'trace' })).containerId;
			});

			after(async () => {
				await devContainerDown({ containerId });
				await shellExec(`rm -f ${testFolder}/*.testMarker`, undefined, undefined, true);
			});	

			it('marker files should exist', async () => {
				const res = await shellExec(`${cli} exec --workspace-folder ${testFolder} ls -altr`);
				const response = JSON.parse(res.stdout);
				console.log(res.stderr);
				assert.equal(response.outcome, 'success');
				assert.match(res.stderr, /tiger.postCreateCommand.testMarker/);
			});
		});
	});

});
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

				assert.match(res.stderr, /0.panda.onCreateCommand.testMarker/);
				assert.match(res.stderr, /3.panda.updateContentCommand.testMarker/);
				assert.match(res.stderr, /6.panda.postCreateCommand.testMarker/);
				assert.match(res.stderr, /9.panda.postStartCommand.testMarker/);
				assert.match(res.stderr, /12.panda.postAttachCommand.testMarker/);

				assert.match(res.stderr, /1.tiger.onCreateCommand.testMarker/);
				assert.match(res.stderr, /4.tiger.updateContentCommand.testMarker/);
				assert.match(res.stderr, /7.tiger.postCreateCommand.testMarker/);
				assert.match(res.stderr, /10.tiger.postStartCommand.testMarker/);
				assert.match(res.stderr, /13.tiger.postAttachCommand.testMarker/);

				assert.match(res.stderr, /2.devContainer.onCreateCommand.testMarker/);
				assert.match(res.stderr, /5.devContainer.updateContentCommand.testMarker/);
				assert.match(res.stderr, /8.devContainer.postCreateCommand.testMarker/);
				assert.match(res.stderr, /11.devContainer.postStartCommand.testMarker/);
				assert.match(res.stderr, /14.devContainer.postAttachCommand.testMarker/);
			});
		});
	});

	describe('lifecycle-hooks-advanced', () => {

		describe(`devcontainer up`, () => {
			let containerId: string | null = null;
			const testFolder = `${__dirname}/configs/lifecycle-hooks-advanced`;

			before(async () => {
				await shellExec(`rm -f ${testFolder}/*.testMarker`, undefined, undefined, true);
				containerId = (await devContainerUp(cli, testFolder, { 'logLevel': 'trace' })).containerId;
			});

			after(async () => {
				await devContainerDown({ containerId });
				await shellExec(`rm -f ${testFolder}/*.testMarker`, undefined, undefined, true);
			});

			it('Feature command added to path can be executed in a lifecycle scripts', async () => {
				const res = await shellExec(`${cli} exec --workspace-folder ${testFolder} ls -altr`);
				const response = JSON.parse(res.stdout);
				console.log(res.stderr);
				assert.equal(response.outcome, 'success');

				assert.match(res.stderr, /i-am-a-rabbit.postStartCommand.testMarker/);
				assert.match(res.stderr, /i-am-an-otter.postAttachCommand.testMarker/);
			});
		});
	});

	describe('lifecycle-hooks-parallel-execution', () => {
		assert.fail('TODO');
	});

});
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
				assert.equal(response.outcome, 'success');

				const outputOfExecCommand = res.stderr;
				console.log(outputOfExecCommand);

				assert.match(outputOfExecCommand, /0.panda.onCreateCommand.testMarker/);
				assert.match(outputOfExecCommand, /3.panda.updateContentCommand.testMarker/);
				assert.match(outputOfExecCommand, /6.panda.postCreateCommand.testMarker/);
				assert.match(outputOfExecCommand, /9.panda.postStartCommand.testMarker/);
				assert.match(outputOfExecCommand, /12.panda.postAttachCommand.testMarker/);

				assert.match(outputOfExecCommand, /1.tiger.onCreateCommand.testMarker/);
				assert.match(outputOfExecCommand, /4.tiger.updateContentCommand.testMarker/);
				assert.match(outputOfExecCommand, /7.tiger.postCreateCommand.testMarker/);
				assert.match(outputOfExecCommand, /10.tiger.postStartCommand.testMarker/);
				assert.match(outputOfExecCommand, /13.tiger.postAttachCommand.testMarker/);

				assert.match(outputOfExecCommand, /2.devContainer.onCreateCommand.testMarker/);
				assert.match(outputOfExecCommand, /5.devContainer.updateContentCommand.testMarker/);
				assert.match(outputOfExecCommand, /8.devContainer.postCreateCommand.testMarker/);
				assert.match(outputOfExecCommand, /11.devContainer.postStartCommand.testMarker/);
				assert.match(outputOfExecCommand, /14.devContainer.postAttachCommand.testMarker/);
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
				assert.equal(response.outcome, 'success');

				const outputOfExecCommand = res.stderr;
				console.log(outputOfExecCommand);

				// Executes the command that was installed by each Feature's 'install.sh'.
				// The command is installed to a directory on the $PATH so it can be executed from the lifecycle script.
				assert.match(outputOfExecCommand, /i-am-a-rabbit.postStartCommand.testMarker/);
				assert.match(outputOfExecCommand, /i-am-an-otter.postAttachCommand.testMarker/);

				// Since lifecycle scripts are executed relative to the workspace folder,
				// to run a script bundled with the Feature, the user needs to use the '${featureRoot}' variable.
				// This variable can only be used in a devcontainer-feature.json's lifecycle scripts.
				// And will return the temporary directory where the Feature's files are copied to.
				assert.match(outputOfExecCommand, /helperScript.rabbit.onCreateCommand.markerFile/);
				assert.match(outputOfExecCommand, /helperScript.rabbit.updateContent.markerFile/);
				assert.match(outputOfExecCommand, /helperScript.rabbit.postCreate.markerFile/);
				assert.match(outputOfExecCommand, /helperScript.rabbit.postStart.markerFile/);
				assert.match(outputOfExecCommand, /helperScript.rabbit.postAttach.markerFile/);

				assert.match(outputOfExecCommand, /helperScript.otter.onCreateCommand.markerFile/);
				assert.match(outputOfExecCommand, /helperScript.otter.updateContent.markerFile/);
				assert.match(outputOfExecCommand, /helperScript.otter.postCreate.markerFile/);
				assert.match(outputOfExecCommand, /helperScript.otter.postStart.markerFile/);
				assert.match(outputOfExecCommand, /helperScript.otter.postAttach.markerFile/);
			});
		});
	});

	// describe('lifecycle-hooks-parallel-execution', () => {
	// 	assert.fail('TODO');
	// });

});
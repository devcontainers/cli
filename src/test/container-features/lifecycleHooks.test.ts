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

				assert.match(outputOfExecCommand, /panda.onCreateCommand.testMarker/);
				assert.match(outputOfExecCommand, /panda.updateContentCommand.testMarker/);
				assert.match(outputOfExecCommand, /panda.postCreateCommand.testMarker/);
				assert.match(outputOfExecCommand, /panda.postStartCommand.testMarker/);
				assert.match(outputOfExecCommand, /panda.postAttachCommand.testMarker/);

				assert.match(outputOfExecCommand, /tiger.onCreateCommand.testMarker/);
				assert.match(outputOfExecCommand, /tiger.updateContentCommand.testMarker/);
				assert.match(outputOfExecCommand, /tiger.postCreateCommand.testMarker/);
				assert.match(outputOfExecCommand, /tiger.postStartCommand.testMarker/);
				assert.match(outputOfExecCommand, /tiger.postAttachCommand.testMarker/);

				assert.match(outputOfExecCommand, /devContainer.onCreateCommand.testMarker/);
				assert.match(outputOfExecCommand, /devContainer.updateContentCommand.testMarker/);
				assert.match(outputOfExecCommand, /devContainer.postCreateCommand.testMarker/);
				assert.match(outputOfExecCommand, /devContainer.postStartCommand.testMarker/);
				assert.match(outputOfExecCommand, /devContainer.postAttachCommand.testMarker/);
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

				assert.match(outputOfExecCommand, /helperScript.devContainer.parallel_postCreateCommand_1.testMarker/);
				assert.match(outputOfExecCommand, /helperScript.devContainer.parallel_postCreateCommand_2.testMarker/);

				// Since lifecycle scripts are executed relative to the workspace folder,
				// to run a script bundled with the Feature, the user needs to use the '${featureRoot}' variable.
				// This variable can only be used in a devcontainer-feature.json's lifecycle scripts.
				// And will return the temporary directory where the Feature's files are copied to.

				// -- 'Rabbit' Feature
				assert.match(outputOfExecCommand, /helperScript.rabbit.onCreateCommand.testMarker/);
				assert.match(outputOfExecCommand, /helperScript.rabbit.updateContentCommand.testMarker/);
				assert.match(outputOfExecCommand, /helperScript.rabbit.postStartCommand.testMarker/);
				assert.match(outputOfExecCommand, /helperScript.rabbit.postAttachCommand.testMarker/);

				assert.match(outputOfExecCommand, /helperScript.rabbit.parallel_postCreateCommand_1.testMarker/);
				assert.match(outputOfExecCommand, /helperScript.rabbit.parallel_postCreateCommand_2.testMarker/);

				// -- 'Otter' Feature
				assert.match(outputOfExecCommand, /helperScript.otter.onCreateCommand.testMarker/);
				assert.match(outputOfExecCommand, /helperScript.otter.updateContentCommand.testMarker/);
				assert.match(outputOfExecCommand, /helperScript.otter.postStartCommand.testMarker/);
				assert.match(outputOfExecCommand, /helperScript.otter.postAttachCommand.testMarker/);

				assert.match(outputOfExecCommand, /helperScript.otter.parallel_postCreateCommand_1.testMarker/);
				assert.match(outputOfExecCommand, /helperScript.otter.parallel_postCreateCommand_2.testMarker/);
			});
		});
	});
});
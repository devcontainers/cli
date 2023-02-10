/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { assert } from 'chai';
import * as path from 'path';
import { Feature } from '../../spec-configuration/containerFeaturesConfiguration';
import { devContainerDown, devContainerStop, devContainerUp, shellExec } from '../testUtils';

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
		const testFolder = `${__dirname}/configs/lifecycle-hooks-inline-commands`;

		describe('devcontainer up', () => {
			let containerId: string | null = null;

			before(async () => {
				await shellExec(`rm -f ${testFolder}/*.testMarker`, undefined, undefined, true);
				containerId = (await devContainerUp(cli, testFolder, { 'logLevel': 'trace' })).containerId;
			});

			after(async () => {
				await devContainerDown({ containerId });
				await shellExec(`rm -f ${testFolder}/*.testMarker`, undefined, undefined, true);
			});

			it('marker files should exist, be executed in stable order, and hooks should postStart/attach should trigger on a resume', async () => {

				{
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

					// This shouldn't have happened _yet_.
					assert.notMatch(outputOfExecCommand, /15.panda.postStartCommand.testMarker/);
				}

				// Stop the container.
				await devContainerStop({ containerId });

				{
					// Attempt to bring the same container up, which should just re-run the postStart and postAttach hooks
					const resume = await devContainerUp(cli, testFolder, { logLevel: 'trace' });
					assert.equal(resume.containerId, containerId); // Restarting the same container.
					assert.equal(resume.outcome, 'success');

					const res = await shellExec(`${cli} exec --workspace-folder ${testFolder} ls -altr`);
					const response = JSON.parse(res.stdout);
					assert.equal(response.outcome, 'success');

					const outputOfExecCommand = res.stderr;
					console.log(outputOfExecCommand);

					assert.match(outputOfExecCommand, /15.panda.postStartCommand.testMarker/);
					assert.match(outputOfExecCommand, /16.tiger.postStartCommand.testMarker/);
					assert.match(outputOfExecCommand, /17.devContainer.postStartCommand.testMarker/);
					assert.match(outputOfExecCommand, /18.panda.postAttachCommand.testMarker/);
					assert.match(outputOfExecCommand, /19.tiger.postAttachCommand.testMarker/);
					assert.match(outputOfExecCommand, /20.devContainer.postAttachCommand.testMarker/);
				}


			});
		});
	});

	describe('lifecycle-hooks-alternative-order', () => {
		// This is the same test as 'lifecycle-hooks-inline-commands'
		// but with the the 'installsAfter' order changed (tiger -> panda -> devContainer).

		let containerId: string | null = null;
		const testFolder = `${__dirname}/configs/temp_lifecycle-hooks-alternative-order`;

		before(async () => {
			await shellExec(`rm -rf ${testFolder}`, undefined, undefined, true);
			await shellExec(`mkdir -p ${testFolder}`);
			await shellExec(`bash -c 'cp -r . ${testFolder}'`, { cwd: `${__dirname}/configs/lifecycle-hooks-inline-commands` });

			// Read in the JSON from the two Feature's devcontainer-feature.json
			const pandaFeatureJson: Feature = JSON.parse((await shellExec(`cat ${testFolder}/.devcontainer/panda/devcontainer-feature.json`)).stdout);
			const tigerFeatureJson: Feature = JSON.parse((await shellExec(`cat ${testFolder}/.devcontainer/tiger/devcontainer-feature.json`)).stdout);

			// Remove the installsAfter from the tiger's devcontainer-feature.json and add it to the panda's devcontainer-feature.json
			delete tigerFeatureJson.installsAfter;
			pandaFeatureJson.installsAfter = ['./tiger'];

			// Write the JSON back to the two Feature's devcontainer-feature.json
			await shellExec(`echo '${JSON.stringify(pandaFeatureJson)}' > ${testFolder}/.devcontainer/panda/devcontainer-feature.json`);
			await shellExec(`echo '${JSON.stringify(tigerFeatureJson)}' > ${testFolder}/.devcontainer/tiger/devcontainer-feature.json`);

			containerId = (await devContainerUp(cli, testFolder, { 'logLevel': 'trace' })).containerId;
		});

		after(async () => {
			await devContainerDown({ containerId });
			await shellExec(`rm -rf ${testFolder}`, undefined, undefined, true);
		});

		it('marker files should exist and executed in stable order', async () => {
			const res = await shellExec(`${cli} exec --workspace-folder ${testFolder} ls -altr`);
			const response = JSON.parse(res.stdout);
			assert.equal(response.outcome, 'success');

			const outputOfExecCommand = res.stderr;
			console.log(outputOfExecCommand);

			assert.match(outputOfExecCommand, /0.tiger.onCreateCommand.testMarker/);
			assert.match(outputOfExecCommand, /3.tiger.updateContentCommand.testMarker/);
			assert.match(outputOfExecCommand, /6.tiger.postCreateCommand.testMarker/);
			assert.match(outputOfExecCommand, /9.tiger.postStartCommand.testMarker/);
			assert.match(outputOfExecCommand, /12.tiger.postAttachCommand.testMarker/);

			assert.match(outputOfExecCommand, /1.panda.onCreateCommand.testMarker/);
			assert.match(outputOfExecCommand, /4.panda.updateContentCommand.testMarker/);
			assert.match(outputOfExecCommand, /7.panda.postCreateCommand.testMarker/);
			assert.match(outputOfExecCommand, /10.panda.postStartCommand.testMarker/);
			assert.match(outputOfExecCommand, /13.panda.postAttachCommand.testMarker/);

			assert.match(outputOfExecCommand, /2.devContainer.onCreateCommand.testMarker/);
			assert.match(outputOfExecCommand, /5.devContainer.updateContentCommand.testMarker/);
			assert.match(outputOfExecCommand, /8.devContainer.postCreateCommand.testMarker/);
			assert.match(outputOfExecCommand, /11.devContainer.postStartCommand.testMarker/);
			assert.match(outputOfExecCommand, /14.devContainer.postAttachCommand.testMarker/);
		});

	});

	describe('lifecycle-hooks-advanced', () => {

		describe(`devcontainer up`, () => {
			let containerId: string | null = null;
			let containerUpStandardError: string;
			const testFolder = `${__dirname}/configs/lifecycle-hooks-advanced`;

			before(async () => {
				await shellExec(`rm -f ${testFolder}/*.testMarker`, undefined, undefined, true);
				const res = await devContainerUp(cli, testFolder, { 'logLevel': 'trace' });
				containerId = res.containerId;
				containerUpStandardError = res.stderr;
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
				assert.match(containerUpStandardError, /Running the postCreateCommand from devcontainer.json/);

				assert.match(outputOfExecCommand, /i-am-an-otter.postAttachCommand.testMarker/);
				assert.match(containerUpStandardError, /Running the postAttachCommand from devcontainer.json/);

				assert.match(outputOfExecCommand, /helperScript.devContainer.parallel_postCreateCommand_1.testMarker/);
				assert.match(containerUpStandardError, /Running parallel1 from devcontainer.json.../);

				assert.match(outputOfExecCommand, /helperScript.devContainer.parallel_postCreateCommand_2.testMarker/);
				assert.match(containerUpStandardError, /Running parallel2 from devcontainer.json.../);

				// Since lifecycle scripts are executed relative to the workspace folder,
				// to run a script bundled with the Feature, the user needs to use the '${featureRootFolder}' variable.
				// This variable can only be used in a devcontainer-feature.json's lifecycle scripts.
				// And will return the temporary directory where the Feature's files are copied to.

				// -- 'Rabbit' Feature
				assert.match(outputOfExecCommand, /helperScript.rabbit.onCreateCommand.testMarker/);
				assert.match(containerUpStandardError, /Running the onCreateCommand from Feature '\.\/rabbit'/);

				assert.match(outputOfExecCommand, /helperScript.rabbit.updateContentCommand.testMarker/);
				assert.match(containerUpStandardError, /Running the updateContentCommand from Feature '\.\/rabbit'/);

				assert.match(outputOfExecCommand, /helperScript.rabbit.postStartCommand.testMarker/);
				assert.match(containerUpStandardError, /Running the postStartCommand from Feature '\.\/rabbit'/);

				assert.match(outputOfExecCommand, /helperScript.rabbit.postAttachCommand.testMarker/);
				assert.match(containerUpStandardError, /Running the postAttachCommand from Feature '\.\/rabbit'/);

				assert.match(outputOfExecCommand, /helperScript.rabbit.parallel_postCreateCommand_1.testMarker/);
				assert.match(containerUpStandardError, /Running parallel1 from Feature '\.\/rabbit'/);

				assert.match(outputOfExecCommand, /helperScript.rabbit.parallel_postCreateCommand_2.testMarker/);
				assert.match(containerUpStandardError, /Running parallel2 from Feature '\.\/rabbit'/);


				// -- 'Otter' Feature
				assert.match(outputOfExecCommand, /helperScript.otter.onCreateCommand.testMarker/);
				assert.match(containerUpStandardError, /Running the onCreateCommand from Feature '\.\/otter'/);

				assert.match(outputOfExecCommand, /helperScript.otter.updateContentCommand.testMarker/);
				assert.match(containerUpStandardError, /Running the updateContentCommand from Feature '\.\/otter'/);

				assert.match(outputOfExecCommand, /helperScript.otter.postStartCommand.testMarker/);
				assert.match(containerUpStandardError, /Running the postStartCommand from Feature '\.\/otter'/);

				assert.match(outputOfExecCommand, /helperScript.otter.postAttachCommand.testMarker/);
				assert.match(containerUpStandardError, /Running the postAttachCommand from Feature '\.\/otter'/);

				assert.match(outputOfExecCommand, /helperScript.otter.parallel_postCreateCommand_1.testMarker/);
				assert.match(containerUpStandardError, /Running parallel1 from Feature '\.\/otter'/);

				assert.match(outputOfExecCommand, /helperScript.otter.parallel_postCreateCommand_2.testMarker/);
				assert.match(containerUpStandardError, /Running parallel2 from Feature '\.\/otter'/);

				// -- Assert that at no point did logging the lifecycle hook fail.
				assert.notMatch(containerUpStandardError, /Running the (.*) from \?\?\?/);
			});
		});
	});
});
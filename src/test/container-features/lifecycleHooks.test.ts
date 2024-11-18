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
 					assert.strictEqual(res.error, null);

					const outputOfExecCommand = res.stdout;
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
					assert.strictEqual(res.error, null);

					const outputOfExecCommand = res.stdout;
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

	describe('lifecycle-hooks-inline-commands with secrets', () => {
		const testFolder = `${__dirname}/configs/lifecycle-hooks-inline-commands`;

		describe('devcontainer up with secrets', () => {
			let containerId: string | null = null;

			before(async () => {
				await shellExec(`rm -f ${testFolder}/*.testMarker`, undefined, undefined, true);
				const secrets = {
					'SECRET1': 'SecretValue1',
				};
				await shellExec(`printf '${JSON.stringify(secrets)}' > ${testFolder}/test-secrets-temp.json`, undefined, undefined, true);
				containerId = (await devContainerUp(cli, testFolder, { 'logLevel': 'trace', extraArgs: `--secrets-file ${testFolder}/test-secrets-temp.json` })).containerId;
			});

			after(async () => {
				await devContainerDown({ containerId });
				await shellExec(`rm -f ${testFolder}/*.testMarker`, undefined, undefined, true);
				await shellExec(`rm -f ${testFolder}/test-secrets-temp.json`, undefined, undefined, true);
			});

			it('secrets should be availale to the lifecycle hooks during up command', async () => {
				{
					const res = await shellExec(`${cli} exec --workspace-folder ${testFolder} ls -altr`);
					assert.strictEqual(res.error, null);

					const actualMarkerFiles = res.stdout;
					console.log(actualMarkerFiles);

					const expectedTestMarkerFiles = [
						'0.panda.onCreateCommand.testMarker',
						'3.panda.updateContentCommand.testMarker',
						'6.panda.postCreateCommand.testMarker',
						'9.panda.postStartCommand.testMarker',
						'12.panda.postAttachCommand.testMarker',

						'1.tiger.onCreateCommand.testMarker',
						'4.tiger.updateContentCommand.testMarker',
						'7.tiger.postCreateCommand.testMarker',
						'10.tiger.postStartCommand.testMarker',
						'13.tiger.postAttachCommand.testMarker',

						'2.devContainer.onCreateCommand.testMarker',
						'5.devContainer.updateContentCommand.testMarker',
						'8.devContainer.postCreateCommand.testMarker',
						'11.devContainer.postStartCommand.testMarker',
						'14.devContainer.postAttachCommand.testMarker',
					];

					for (const file of expectedTestMarkerFiles) {
						assert.match(actualMarkerFiles, new RegExp(file));

						// assert file contents to ensure secrets were available to the command
						const catResp = await shellExec(`${cli} exec --workspace-folder ${testFolder} cat ${file}`);
						assert.strictEqual(catResp.error, null);
						assert.match(catResp.stdout, /SECRET1=SecretValue1/);
					}

					// This shouldn't have happened _yet_.
					assert.notMatch(actualMarkerFiles, /15.panda.postStartCommand.testMarker/);
				}

				// Stop the container.
				await devContainerStop({ containerId });

				{
					// Attempt to bring the same container up, which should just re-run the postStart and postAttach hooks
					const resume = await devContainerUp(cli, testFolder, { logLevel: 'trace', extraArgs: `--secrets-file ${testFolder}/test-secrets-temp.json` });
					assert.equal(resume.containerId, containerId); // Restarting the same container.
					assert.equal(resume.outcome, 'success');

					const res = await shellExec(`${cli} exec --workspace-folder ${testFolder} ls -altr`);
					assert.strictEqual(res.error, null);

					const actualMarkerFiles = res.stdout;
					console.log(actualMarkerFiles);

					const expectedTestMarkerFiles = [
						'15.panda.postStartCommand.testMarker',
						'16.tiger.postStartCommand.testMarker',
						'17.devContainer.postStartCommand.testMarker',
						'18.panda.postAttachCommand.testMarker',
						'19.tiger.postAttachCommand.testMarker',
						'20.devContainer.postAttachCommand.testMarker',
					];

					for (const file of expectedTestMarkerFiles) {
						assert.match(actualMarkerFiles, new RegExp(file));

						// assert file contents to ensure secrets were available to the command
						const catResp = await shellExec(`${cli} exec --workspace-folder ${testFolder} cat ${file}`);
						assert.strictEqual(catResp.error, null);
						assert.match(catResp.stdout, /SECRET1=SecretValue1/);
					}
				}
			});
		});

		describe('devcontainer run-user-commands with secrets', () => {
			let containerId: string | null = null;

			before(async () => {
				await shellExec(`rm -f ${testFolder}/*.testMarker`, undefined, undefined, true);
				const secrets = {
					'SECRET1': 'SecretValue1',
					'MASK_IT': 'cycle',
				};
				await shellExec(`printf '${JSON.stringify(secrets)}' > ${testFolder}/test-secrets-temp.json`, undefined, undefined, true);
				containerId = (await devContainerUp(cli, testFolder, { 'logLevel': 'trace', extraArgs: `--secrets-file ${testFolder}/test-secrets-temp.json --skip-post-create` })).containerId;
				await shellExec(`rm -f ${testFolder}/*.testMarker`, undefined, undefined, true);
			});

			after(async () => {
				await devContainerDown({ containerId });
				await shellExec(`rm -f ${testFolder}/*.testMarker`, undefined, undefined, true);
				await shellExec(`rm -f ${testFolder}/test-secrets-temp.json`, undefined, undefined, true);
			});

			it('secrets should be availale to the lifecycle hooks during run-user-commands command', async () => {
				{
					const expectedTestMarkerFiles = [
						'0.panda.onCreateCommand.testMarker',
						'3.panda.updateContentCommand.testMarker',
						'6.panda.postCreateCommand.testMarker',
						'9.panda.postStartCommand.testMarker',
						'12.panda.postAttachCommand.testMarker',

						'1.tiger.onCreateCommand.testMarker',
						'4.tiger.updateContentCommand.testMarker',
						'7.tiger.postCreateCommand.testMarker',
						'10.tiger.postStartCommand.testMarker',
						'13.tiger.postAttachCommand.testMarker',

						'2.devContainer.onCreateCommand.testMarker',
						'5.devContainer.updateContentCommand.testMarker',
						'8.devContainer.postCreateCommand.testMarker',
						'11.devContainer.postStartCommand.testMarker',
						'14.devContainer.postAttachCommand.testMarker',
					];

					// Marker files should not exist, as we are yet to run the `run-user-commands` command
					const lsResBefore = await shellExec(`${cli} exec --workspace-folder ${testFolder} ls -altr`);
					assert.strictEqual(lsResBefore.error, null);
					const actualMarkerFilesBefore = lsResBefore.stdout;
					console.log(actualMarkerFilesBefore);
					for (const file of expectedTestMarkerFiles) {
						assert.notMatch(actualMarkerFilesBefore, new RegExp(file));
					}

					// Run `run-user-commands` command with secrets
					const res = await shellExec(`${cli} run-user-commands --workspace-folder ${testFolder} --log-level trace --secrets-file ${testFolder}/test-secrets-temp.json`);
					assert.strictEqual(res.error, null);

					// Assert marker files
					const lsResAfter = await shellExec(`${cli} exec --workspace-folder ${testFolder} ls -altr`);
					assert.strictEqual(lsResAfter.error, null);
					const actualMarkerFilesAfter = lsResAfter.stdout;
					console.log(actualMarkerFilesAfter);
					for (const file of expectedTestMarkerFiles) {
						assert.match(actualMarkerFilesAfter, new RegExp(file));

						// assert file contents to ensure secrets were available to the command
						const catResp = await shellExec(`${cli} exec --workspace-folder ${testFolder} cat ${file}`);
						assert.strictEqual(catResp.error, null);
						assert.match(catResp.stdout, /SECRET1=SecretValue1/);
					}

					// assert secret masking
					// We log the string `LifecycleCommandExecutionMap: ...` from CLI. Since the word `cycle` is specified as a secret here, that should get masked
					const logs = res.stderr;
					assert.match(logs, /Life\*\*\*\*\*\*\*\*CommandExecutionMap: /);
					assert.notMatch(logs, /LifecycleCommandExecutionMap: /);
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
			assert.strictEqual(res.error, null);

			const outputOfExecCommand = res.stdout;
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

	describe('lifecycle-hooks-resume-existing-container', () => {
		let containerId: string | null = null;
		const testFolder = `${__dirname}/configs/lifecycle-hooks-resume-existing-container`;

		// Clean up
		before(async () => {
			await shellExec(`rm -f ${testFolder}/*.testMarker`, undefined, undefined, true);
			containerId = (await devContainerUp(cli, testFolder, { 'logLevel': 'trace' })).containerId;
		});

		// Ensure clean after running.
		after(async () => {
			await devContainerDown({ containerId, doNotThrow: true });
			await shellExec(`rm -f ${testFolder}/*.testMarker`, undefined, undefined, true);
		});

		it('the appropriate lifecycle hooks are executed when resuming an existing container', async () => {

			await devContainerStop({ containerId });
			// Attempt to bring the same container up, which should just re-run the postStart and postAttach hooks
			const resume = await devContainerUp(cli, testFolder, { logLevel: 'trace' });
			assert.equal(resume.containerId, containerId); // Restarting the same container.
			assert.equal(resume.outcome, 'success');

			const res = await shellExec(`${cli} exec --workspace-folder ${testFolder} ls -altr`);
			assert.strictEqual(res.error, null);

			const outputOfExecCommand = res.stdout;
			console.log(outputOfExecCommand);

			assert.match(outputOfExecCommand, /0.hippo.postStartCommand.testMarker/);
			assert.match(outputOfExecCommand, /1.hippo.postAttachCommand.testMarker/);
			assert.match(outputOfExecCommand, /2.hippo.postStartCommand.testMarker/);
			assert.match(outputOfExecCommand, /3.hippo.postAttachCommand.testMarker/);
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

			it('executes lifecycle hooks in advanced cases', async () => {
				const res = await shellExec(`${cli} exec --workspace-folder ${testFolder} ls -altr`);
				assert.strictEqual(res.error, null);

				const outputOfExecCommand = res.stdout;
				console.log(outputOfExecCommand);

				// Executes the command that was installed by each Feature's 'install.sh'.
				// The command is installed to a directory on the $PATH so it can be executed from the lifecycle script.
				assert.match(outputOfExecCommand, /i-am-a-rabbit.postStartCommand.testMarker/);
				assert.match(containerUpStandardError, /Running the postCreateCommand from devcontainer.json/);

				assert.match(outputOfExecCommand, /i-am-an-otter.postAttachCommand.testMarker/);
				assert.match(containerUpStandardError, /Running the postAttachCommand from devcontainer.json/);

				assert.match(outputOfExecCommand, /helperScript.devContainer.parallel_postCreateCommand_1.testMarker/);
				assert.match(containerUpStandardError, /Running parallel1 of postCreateCommand from devcontainer.json.../);

				assert.match(outputOfExecCommand, /helperScript.devContainer.parallel_postCreateCommand_2.testMarker/);
				assert.match(containerUpStandardError, /Running parallel2 of postCreateCommand from devcontainer.json.../);

				// Since lifecycle scripts are executed relative to the workspace folder,
				// to run a script bundled with the Feature, the Feature author needs to copy that script to a persistent directory.
				// These Features' install scripts do that.

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
				assert.match(containerUpStandardError, /Running parallel1 of postCreateCommand from Feature '\.\/rabbit'/);

				assert.match(outputOfExecCommand, /helperScript.rabbit.parallel_postCreateCommand_2.testMarker/);
				assert.match(containerUpStandardError, /Running parallel2 of postCreateCommand from Feature '\.\/rabbit'/);


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
				assert.match(containerUpStandardError, /Running parallel1 of postCreateCommand from Feature '\.\/otter'/);

				assert.match(outputOfExecCommand, /helperScript.otter.parallel_postCreateCommand_2.testMarker/);
				assert.match(containerUpStandardError, /Running parallel2 of postCreateCommand from Feature '\.\/otter'/);

				// -- Assert that at no point did logging the lifecycle hook fail.
				assert.notMatch(containerUpStandardError, /Running the (.*) from \?\?\?/);
			});
		});
	});
});
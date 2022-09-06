/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as path from 'path';
import { BuildKitOption, commandMarkerTests, devContainerDown, devContainerStop, devContainerUp, shellExec } from './testUtils';

const pkg = require('../../package.json');

export function describeTests1({ text, options }: BuildKitOption) {

	describe('Dev Containers CLI', function () {
		this.timeout('180s');

		const tmp = path.relative(process.cwd(), path.join(__dirname, 'tmp'));
		const cli = `npx --prefix ${tmp} devcontainer`;

		before('Install', async () => {
			await shellExec(`rm -rf ${tmp}/node_modules`);
			await shellExec(`mkdir -p ${tmp}`);
			await shellExec(`npm --prefix ${tmp} install devcontainers-cli-${pkg.version}.tgz`);
		});

		describe('Command exec', () => {

			describe(`with valid (image) config [${text}]`, () => {
				let containerId: string | null = null;
				const testFolder = `${__dirname}/configs/image`;
				beforeEach(async () => containerId = (await devContainerUp(cli, testFolder, options)).containerId);
				afterEach(async () => await devContainerDown({ containerId }));
				it('should execute successfully', async () => {
					const res = await shellExec(`${cli} exec --workspace-folder ${testFolder} echo hi`);
					const response = JSON.parse(res.stdout);
					assert.equal(response.outcome, 'success');
				});
			});
			describe(`with valid (image) config containing features [${text}]`, () => {
				let containerId: string | null = null;
				const testFolder = `${__dirname}/configs/image-with-features`;
				beforeEach(async () => containerId = (await devContainerUp(cli, testFolder, options)).containerId);
				afterEach(async () => await devContainerDown({ containerId }));
				it('should have access to installed features (docker)', async () => {
					const res = await shellExec(`${cli} exec --workspace-folder ${testFolder} docker --version`);
					const response = JSON.parse(res.stdout);
					console.log(res.stderr);
					assert.equal(response.outcome, 'success');
					assert.match(res.stderr, /Docker version/);
				});
				it('should have access to installed features (hello)', async () => {
					const res = await shellExec(`${cli} exec --workspace-folder ${testFolder} hello`);
					const response = JSON.parse(res.stdout);
					console.log(res.stderr);
					assert.equal(response.outcome, 'success');
					assert.match(res.stderr, /howdy, root/);
				});
			});
			describe(`with valid (Dockerfile) config containing features [${text}]`, () => {
				let containerId: string | null = null;
				const testFolder = `${__dirname}/configs/dockerfile-with-features`;
				beforeEach(async () => containerId = (await devContainerUp(cli, testFolder, options)).containerId);
				afterEach(async () => await devContainerDown({ containerId }));
				it('should have access to installed features (docker)', async () => {
					// NOTE: Doing a docker ps will ensure that the --privileged flag was set by the feature
					const res = await shellExec(`${cli} exec --workspace-folder ${testFolder} docker ps`);
					const response = JSON.parse(res.stdout);
					console.log(res.stderr);
					assert.equal(response.outcome, 'success');
					assert.match(res.stderr, /CONTAINER ID/);
				});
				it('should have access to installed features (hello)', async () => {
					const res = await shellExec(`${cli} exec --workspace-folder ${testFolder} hello`);
					const response = JSON.parse(res.stdout);
					console.log(res.stderr);
					assert.equal(response.outcome, 'success');
					assert.match(res.stderr, /howdy, root/);
				});
			});

			describe(`with valid (Dockerfile) config with target [${text}]`, () => {
				let containerId: string | null = null;
				const testFolder = `${__dirname}/configs/dockerfile-with-target`;
				beforeEach(async () => containerId = (await devContainerUp(cli, testFolder, options)).containerId);
				afterEach(async () => await devContainerDown({ containerId }));
				it('should have build marker content', async () => {
					const res = await shellExec(`${cli} exec --workspace-folder ${testFolder} cat /var/test-marker`);
					const response = JSON.parse(res.stdout);
					console.log(res.stderr);
					assert.equal(response.outcome, 'success');
					assert.match(res.stderr, /||test-content||/);
				});
				it('should have access to installed features (hello)', async () => {
					const res = await shellExec(`${cli} exec --workspace-folder ${testFolder} hello`);
					const response = JSON.parse(res.stdout);
					console.log(res.stderr);
					assert.equal(response.outcome, 'success');
					assert.match(res.stderr, /howdy, root/);
				});
			});

			describe(`with valid (docker-compose with image) config containing v1 features [${text}]`, () => {
				let composeProjectName: string | undefined = undefined;
				const testFolder = `${__dirname}/configs/compose-image-with-features`;
				beforeEach(async () => composeProjectName = (await devContainerUp(cli, testFolder, options)).composeProjectName);
				afterEach(async () => await devContainerDown({ composeProjectName }));
				it('should have access to installed features (docker)', async () => {
					// NOTE: Doing a docker ps will ensure that the --privileged flag was set by the feature
					const res = await shellExec(`${cli} exec --workspace-folder ${testFolder} docker ps`);
					const response = JSON.parse(res.stdout);
					console.log(res.stderr);
					assert.equal(response.outcome, 'success');
					assert.match(res.stderr, /CONTAINER ID/);
				});
				it('should have access to installed features (hello)', async () => {
					const res = await shellExec(`${cli} exec --workspace-folder ${testFolder} hello`);
					const response = JSON.parse(res.stdout);
					console.log(res.stderr);
					assert.equal(response.outcome, 'success');
					assert.match(res.stderr, /howdy, node/);
				});
			});

			describe(`with valid (docker-compose with Dockerfile) config containing features [${text}]`, () => {
				let composeProjectName: string | undefined = undefined;
				const testFolder = `${__dirname}/configs/compose-Dockerfile-with-features`;
				beforeEach(async () => composeProjectName = (await devContainerUp(cli, testFolder, options)).composeProjectName);
				afterEach(async () => await devContainerDown({ composeProjectName }));
				it('should have access to installed features (docker)', async () => {
					const res = await shellExec(`${cli} exec --workspace-folder ${testFolder} docker --version`);
					const response = JSON.parse(res.stdout);
					console.log(res.stderr);
					assert.equal(response.outcome, 'success');
					assert.match(res.stderr, /Docker version/);
				});
				it('should have access to installed features (hello)', async () => {
					const res = await shellExec(`${cli} exec --workspace-folder ${testFolder} hello`);
					const response = JSON.parse(res.stdout);
					console.log(res.stderr);
					assert.equal(response.outcome, 'success');
					assert.match(res.stderr, /howdy, node/);
				});
			});
		});
	});
}

export function describeTests2({ text, options }: BuildKitOption) {

	describe('Dev Containers CLI', function () {
		this.timeout('180s');

		const tmp = path.relative(process.cwd(), path.join(__dirname, 'tmp'));
		const cli = `npx --prefix ${tmp} devcontainer`;

		before('Install', async () => {
			await shellExec(`rm -rf ${tmp}/node_modules`);
			await shellExec(`mkdir -p ${tmp}`);
			await shellExec(`npm --prefix ${tmp} install devcontainers-cli-${pkg.version}.tgz`);
		});

		describe('Command exec', () => {

			describe(`with valid (docker-compose with Dockerfile and target) config containing features [${text}]`, () => {
				let composeProjectName: string | undefined = undefined;
				const testFolder = `${__dirname}/configs/compose-Dockerfile-with-target`;
				beforeEach(async () => composeProjectName = (await devContainerUp(cli, testFolder, options)).composeProjectName);
				afterEach(async () => await devContainerDown({ composeProjectName }));
				it('should have access to installed features (docker)', async () => {
					const res = await shellExec(`${cli} exec --workspace-folder ${testFolder} docker --version`);
					const response = JSON.parse(res.stdout);
					console.log(res.stderr);
					assert.equal(response.outcome, 'success');
					assert.match(res.stderr, /Docker version/);
				});
				it('should have access to installed features (hello)', async () => {
					const res = await shellExec(`${cli} exec --workspace-folder ${testFolder} hello`);
					const response = JSON.parse(res.stdout);
					console.log(res.stderr);
					assert.equal(response.outcome, 'success');
					assert.match(res.stderr, /howdy, node/);
				});
				it('should have marker content', async () => {
					const res = await shellExec(`${cli} exec --workspace-folder ${testFolder} cat /var/test-marker`);
					const response = JSON.parse(res.stdout);
					console.log(res.stderr);
					assert.equal(response.outcome, 'success');
					assert.match(res.stderr, /||test-content||/);
				});
			});


			describe(`Dockerfile with post*Commands specified [${text}]`, () => {
				let containerId: string | null = null;
				const testFolder = `${__dirname}/configs/dockerfile-with-target`;
				after(async () => await devContainerDown({ containerId }));
				it('should have all command markers at appropriate times', async () => {
					containerId = (await devContainerUp(cli, testFolder, options)).containerId;
					// Should have all markers (Create + Start + Attach)
					await commandMarkerTests(cli, testFolder, { postCreate: true, postStart: true, postAttach: true }, 'Markers on first create');

					// Clear markers and stop
					await shellExec(`${cli} exec --workspace-folder ${testFolder} /bin/sh -c "rm /tmp/*.testmarker"`);
					await devContainerStop({ containerId });

					// Restart container - should have Start + Attach
					containerId = (await devContainerUp(cli, testFolder, options)).containerId;
					await commandMarkerTests(cli, testFolder, { postCreate: false, postStart: true, postAttach: true }, 'Markers on restart');

					// TODO - investigate what triggers postAttachCommand and check test is valid
					// // Clear markers and re-test - should have Attach
					// await shellExec(`${cli} exec --workspace-folder ${testFolder} /bin/sh -c "rm /tmp/*.testmarker"`);
					// await commandMarkerTests(testFolder, { postCreate: false, postStart: false, postAttach: true }, 'Markers on attach');
				});
			});
			describe(`docker-compose with post*Commands specified [${text}]`, () => {
				let composeProjectName: string | undefined = undefined;
				const testFolder = `${__dirname}/configs/compose-Dockerfile-with-target`;
				after(async () => await devContainerDown({ composeProjectName }));
				it('should have all command markers at appropriate times', async () => {
					composeProjectName = (await devContainerUp(cli, testFolder, options)).composeProjectName;
					// Should have all markers (Create + Start + Attach)
					await commandMarkerTests(cli, testFolder, { postCreate: true, postStart: true, postAttach: true }, 'Markers on first create');

					// Clear markers and stop
					await shellExec(`${cli} exec --workspace-folder ${testFolder} /bin/sh -c "rm /tmp/*.testmarker"`);
					await devContainerStop({ composeProjectName });

					// Restart container - should have Start + Attach
					composeProjectName = (await devContainerUp(cli, testFolder, options)).composeProjectName;
					await commandMarkerTests(cli, testFolder, { postCreate: false, postStart: true, postAttach: true }, 'Markers on restart');

					// TODO - investigate what triggers postAttachCommand and check test is valid
					// // Clear markers and re-test - should have Attach
					// await shellExec(`${cli} exec --workspace-folder ${testFolder} /bin/sh -c "rm /tmp/*.testmarker"`);
					// await commandMarkerTests(testFolder, { postCreate: false, postStart: false, postAttach: true }, 'Markers on attach');
				});
			});
			describe(`docker-compose with post*Commands specified (stop individual container) [${text}]`, () => {
				let containerId: string | null = null;
				const testFolder = `${__dirname}/configs/compose-Dockerfile-with-target`;
				after(async () => await devContainerDown({ containerId }));
				it('should have all command markers at appropriate times', async () => {
					containerId = (await devContainerUp(cli, testFolder, options)).containerId;
					// Should have all markers (Create + Start + Attach)
					await commandMarkerTests(cli, testFolder, { postCreate: true, postStart: true, postAttach: true }, 'Markers on first create');

					// Clear markers and stop
					await shellExec(`${cli} exec --workspace-folder ${testFolder} /bin/sh -c "rm /tmp/*.testmarker"`);
					await devContainerStop({ containerId });

					// Restart container - should have Start + Attach
					containerId = (await devContainerUp(cli, testFolder, options)).containerId;
					await commandMarkerTests(cli, testFolder, { postCreate: false, postStart: true, postAttach: true }, 'Markers on restart');

					// TODO - investigate what triggers postAttachCommand and check test is valid
					// // Clear markers and re-test - should have Attach
					// await shellExec(`${cli} exec --workspace-folder ${testFolder} /bin/sh -c "rm /tmp/*.testmarker"`);
					// await commandMarkerTests(testFolder, { postCreate: false, postStart: false, postAttach: true }, 'Markers on attach');
				});
				describe(`docker-compose alpine with post*Commands [${text}]`, () => {
					let containerId: string | null = null;
					const testFolder = `${__dirname}/configs/compose-Dockerfile-alpine`;
					after(async () => await devContainerDown({ containerId }));
					it('should have all command markers at appropriate times', async () => {
						containerId = (await devContainerUp(cli, testFolder, options)).containerId;
						// Should have all markers (Create + Start + Attach)
						await commandMarkerTests(cli, testFolder, { postCreate: true, postStart: true, postAttach: true }, 'Markers on first create');

						// Clear markers and stop
						await shellExec(`${cli} exec --workspace-folder ${testFolder} /bin/sh -c "rm /tmp/*.testmarker"`);
						assert.ok(containerId);
						await devContainerStop({ containerId });

						// Restart container - should have Start + Attach
						containerId = (await devContainerUp(cli, testFolder, options)).containerId;
						await commandMarkerTests(cli, testFolder, { postCreate: false, postStart: true, postAttach: true }, 'Markers on restart');

						// TODO - investigate what triggers postAttachCommand and check test is valid
						// // Clear markers and re-test - should have Attach
						// await shellExec(`${cli} exec --workspace-folder ${testFolder} /bin/sh -c "rm /tmp/*.testmarker"`);
						// await commandMarkerTests(testFolder, { postCreate: false, postStart: false, postAttach: true }, 'Markers on attach');
					});
				});
			});

			if (options.useBuildKit) {
				describe('with valid (Dockerfile) config containing #syntax (BuildKit)', () => { // ensure existing '# syntax' lines are handled
					let containerId: string | null = null;
					const testFolder = `${__dirname}/configs/dockerfile-with-syntax`;
					beforeEach(async () => containerId = (await devContainerUp(cli, testFolder, { useBuildKit: true })).containerId);
					afterEach(async () => await devContainerDown({ containerId }));
					it('should have access to installed features (docker)', async () => {
						const res = await shellExec(`${cli} exec --workspace-folder ${testFolder} docker --version`);
						const response = JSON.parse(res.stdout);
						console.log(res.stderr);
						assert.equal(response.outcome, 'success');
						assert.match(res.stderr, /Docker version/);
					});
					it('should have access to installed features (hello)', async () => {
						const res = await shellExec(`${cli} exec --workspace-folder ${testFolder} hello`);
						const response = JSON.parse(res.stdout);
						console.log(res.stderr);
						assert.equal(response.outcome, 'success');
						assert.match(res.stderr, /howdy, root/);
					});
				});
		
				it('should fail with "not found" error when config is not found', async () => {
					let success = false;
					try {
						await shellExec(`${cli} exec --workspace-folder path-that-does-not-exist echo hi`);
						success = true;
					} catch (error) {
						assert.equal(error.error.code, 1, 'Should fail with exit code 1');
						const res = JSON.parse(error.stdout);
						assert.equal(res.outcome, 'error');
						assert.match(res.message, /Dev container config \(.*\) not found./);
					}
					assert.equal(success, false, 'expect non-successful call');
				});
			}
		});
	});
}

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as path from 'path';
import { BuildKitOption, commandMarkerTests, devContainerDown, devContainerStop, devContainerUp, pathExists, shellBufferExec, shellExec, shellPtyExec } from './testUtils';

const pkg = require('../../package.json');

export function describeTests1({ text, options }: BuildKitOption) {

	describe('Dev Containers CLI', function () {
		this.timeout('360s');

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
					const res = await shellBufferExec(`${cli} exec --workspace-folder ${testFolder} echo hi`);
					assert.strictEqual(res.code, 0);
					assert.equal(res.signal, undefined);
					assert.strictEqual(res.stdout.toString(), 'hi\n');
				});
				it('should not run in a terminal', async () => {
					const res = await shellBufferExec(`${cli} exec --workspace-folder ${testFolder} [ ! -t 1 ]`);
					assert.strictEqual(res.code, 0);
					assert.equal(res.signal, undefined);
				});
				it('should return exit code without terminal', async () => {
					const res = await shellBufferExec(`${cli} exec --workspace-folder ${testFolder} sh -c 'exit 123'`);
					assert.strictEqual(res.code, 123);
					assert.equal(res.signal, undefined);
				});
				it('stream binary data', async () => {
					const stdin = Buffer.alloc(256);
					stdin.forEach((_, i) => stdin[i] = i);
					const res = await shellBufferExec(`${cli} exec --workspace-folder ${testFolder} cat`, { stdin });
					assert.strictEqual(res.code, 0);
					assert.equal(res.signal, undefined);
					assert.ok(res.stdout.equals(stdin), 'stdout does not match stdin: ' + res.stdout.toString('hex'));
				});
				it('should run in a terminal', async () => {
					const res = await shellPtyExec(`${cli} exec --workspace-folder ${testFolder} [ -t 1 ]`);
					assert.strictEqual(res.code, 0);
					assert.equal(res.signal, undefined);
				});
				it('should return exit code without terminal', async () => {
					const res = await shellPtyExec(`${cli} exec --workspace-folder ${testFolder} sh -c 'exit 123'`);
					assert.strictEqual(res.code, 123);
					assert.equal(res.signal, 0);
				});
				it('should connect stdin', async () => {
					const res = await shellPtyExec(`${cli} exec --workspace-folder ${testFolder} sh`, { stdin: 'FOO=BAR\necho ${FOO}hi${FOO}\nexit\n' });
					assert.strictEqual(res.code, 0);
					assert.equal(res.signal, undefined);
					assert.match(res.cmdOutput, /BARhiBAR/);
				});
				it('should pass along --remote-env', async () => {
					const res = await shellBufferExec(`${cli} exec --workspace-folder ${testFolder} --remote-env FOO=BAR --remote-env BAZ= printenv`);
					assert.strictEqual(res.code, 0);
					assert.equal(res.signal, undefined);
					const stdout = res.stdout.toString();
					const env = stdout
						.split('\n')
						.map(l => l.split('='))
						.reduce((m, [k, v]) => { m[k] = v; return m; }, {} as { [key: string]: string });
					assert.strictEqual(env.FOO, 'BAR');
					assert.strictEqual(env.BAZ, '');
				});
			});
			describe(`with valid (image) config containing features [${text}]`, () => {
				let containerId: string | null = null;
				const testFolder = `${__dirname}/configs/image-with-features`;
				beforeEach(async () => containerId = (await devContainerUp(cli, testFolder, options)).containerId);
				afterEach(async () => await devContainerDown({ containerId }));
				it('should have access to installed features (docker)', async () => {
					const res = await shellExec(`${cli} exec --workspace-folder ${testFolder} docker --version`);
					assert.strictEqual(res.error, null);
					assert.match(res.stdout, /Docker version/);
				});
				it('should have access to installed features (hello)', async () => {
					const res = await shellExec(`${cli} exec --workspace-folder ${testFolder} hello`);
					assert.strictEqual(res.error, null);
					assert.match(res.stdout, /howdy, node/);
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
					assert.strictEqual(res.error, null);
					assert.match(res.stdout, /CONTAINER ID/);
				});
				it('should have access to installed features (hello)', async () => {
					const res = await shellExec(`${cli} exec --workspace-folder ${testFolder} hello`);
					assert.strictEqual(res.error, null);
					assert.match(res.stdout, /howdy, node/);
				});
			});
			describe(`with valid (image) config and parallel initializeCommand [${text}]`, () => {
				let containerId: string | null = null;
				const testFolder = `${__dirname}/configs/image-with-parallel-initialize-command`;
				beforeEach(async () => containerId = (await devContainerUp(cli, testFolder, options)).containerId);
				afterEach(async () => {
					await devContainerDown({ containerId });
					await shellExec(`rm -f ${testFolder}/*.testMarker`);
				});
				it('should create testMarker files', async () => {
					{
						const res = await shellExec(`cat ${testFolder}/initializeCommand.1.testMarker`);
						assert.strictEqual(res.error, null);
						assert.strictEqual(res.stderr, '');
					}
					{
						const res = await shellExec(`cat ${testFolder}/initializeCommand.2.testMarker`);
						assert.strictEqual(res.error, null);
						assert.strictEqual(res.stderr, '');
					}
				});
			});
			describe(`with valid (Dockerfile) config with target [${text}]`, () => {
				let containerId: string | null = null;
				const testFolder = `${__dirname}/configs/dockerfile-with-target`;
				beforeEach(async () => containerId = (await devContainerUp(cli, testFolder, options)).containerId);
				afterEach(async () => await devContainerDown({ containerId }));
				it('should have build marker content', async () => {
					const res = await shellExec(`${cli} exec --workspace-folder ${testFolder} cat /var/test-marker`);
					assert.strictEqual(res.error, null);
					assert.match(res.stdout, /||test-content||/);
				});
				it('should have access to installed features (hello)', async () => {
					const res = await shellExec(`${cli} exec --workspace-folder ${testFolder} hello`);
					assert.strictEqual(res.error, null);
					assert.match(res.stdout, /howdy, node/);
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
					assert.strictEqual(res.error, null);
					assert.match(res.stdout, /CONTAINER ID/);
				});
				it('should have access to installed features (hello)', async () => {
					const res = await shellExec(`${cli} exec --workspace-folder ${testFolder} hello`);
					assert.strictEqual(res.error, null);
					assert.match(res.stdout, /howdy, node/);
				});
			});

			describe(`with valid (docker-compose with Dockerfile) config containing features [${text}]`, () => {
				let composeProjectName: string | undefined = undefined;
				const testFolder = `${__dirname}/configs/compose-Dockerfile-with-features`;
				beforeEach(async () => composeProjectName = (await devContainerUp(cli, testFolder, options)).composeProjectName);
				afterEach(async () => await devContainerDown({ composeProjectName }));
				it('should have access to installed features (docker)', async () => {
					const res = await shellExec(`${cli} exec --workspace-folder ${testFolder} docker --version`);
					assert.strictEqual(res.error, null);
					assert.match(res.stdout, /Docker version/);
				});
				it('should have access to installed features (hello)', async () => {
					const res = await shellExec(`${cli} exec --workspace-folder ${testFolder} hello`);
					assert.strictEqual(res.error, null);
					assert.match(res.stdout, /howdy, node/);
				});
			});
		});
	});
}

export function describeTests2({ text, options }: BuildKitOption) {

	describe('Dev Containers CLI', function () {
		this.timeout('300s');

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
					assert.strictEqual(res.error, null);
					assert.match(res.stdout, /Docker version/);
				});
				it('should have access to installed features (hello)', async () => {
					const res = await shellExec(`${cli} exec --workspace-folder ${testFolder} hello`);
					assert.strictEqual(res.error, null);
					assert.match(res.stdout, /howdy, node/);
				});
				it('should have marker content', async () => {
					const res = await shellExec(`${cli} exec --workspace-folder ${testFolder} cat /var/test-marker`);
					assert.strictEqual(res.error, null);
					assert.match(res.stdout, /||test-content||/);
				});
			});


			describe(`Dockerfile with post*Commands specified [${text}]`, () => {
				let containerId: string | null = null;
				const testFolder = `${__dirname}/configs/dockerfile-with-target`;
				afterEach(async () => await devContainerDown({ containerId }));
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
				it('should not run postAttachCommand when --skip-post-attach is given', async () => {
					const testOptions = { ...options, extraArgs: '--skip-post-attach' };
					containerId = (await devContainerUp(cli, testFolder, testOptions)).containerId;
					// Should have Create + Start but not Attach
					await commandMarkerTests(cli, testFolder, { postCreate: true, postStart: true, postAttach: false }, 'Markers on first create');

					// Clear markers and stop
					await shellExec(`${cli} exec --workspace-folder ${testFolder} /bin/sh -c "rm /tmp/*.testmarker"`);
					await devContainerStop({ containerId });

					// Restart container - should have Start
					containerId = (await devContainerUp(cli, testFolder, testOptions)).containerId;
					await commandMarkerTests(cli, testFolder, { postCreate: false, postStart: true, postAttach: false }, 'Markers on restart');

					await devContainerDown({ containerId });

					// Shouldn't have any markers
					containerId = (await devContainerUp(cli, testFolder, { ...options, extraArgs: '--skip-post-create' })).containerId;
					await commandMarkerTests(cli, testFolder, { postCreate: false, postStart: false, postAttach: false }, 'Markers on --skip-post-create');

					// Should have Create + Start but not Attach
					const res = await shellExec(`${cli} run-user-commands --skip-post-attach --workspace-folder ${testFolder}`);
					assert.strictEqual(res.error, null);
					await commandMarkerTests(cli, testFolder, { postCreate: true, postStart: true, postAttach: false }, 'Markers on run-user-commands');
				});
			});
			describe(`Dockerfile with parallel post*Commands specified [${text}]`, () => {
				let containerId: string | null = null;
				const testFolder = `${__dirname}/configs/dockerfile-with-parallel-commands`;
				after(async () => await devContainerDown({ containerId }));
				it('should have all command markers at appropriate times', async () => {
					containerId = (await devContainerUp(cli, testFolder, options)).containerId;
					// Should have all markers (Create + Start + Attach)
					assert.ok(await pathExists(cli, testFolder, '/tmp/postCreateCommand1.testmarker'));
					assert.ok(await pathExists(cli, testFolder, '/tmp/postCreateCommand2.testmarker'));
					assert.ok(await pathExists(cli, testFolder, '/tmp/postStartCommand1.testmarker'));
					assert.ok(await pathExists(cli, testFolder, '/tmp/postStartCommand2.testmarker'));
					assert.ok(await pathExists(cli, testFolder, '/tmp/postAttachCommand1.testmarker'));
					assert.ok(await pathExists(cli, testFolder, '/tmp/postAttachCommand2.testmarker'));
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
						assert.strictEqual(res.error, null);
						assert.match(res.stdout, /Docker version/);
					});
					it('should have access to installed features (hello)', async () => {
						const res = await shellExec(`${cli} exec --workspace-folder ${testFolder} hello`);
						assert.strictEqual(res.error, null);
						assert.match(res.stdout, /howdy, node/);
					});
				});
		
				it('should fail with "not found" error when config is not found', async () => {
					let success = false;
					try {
						await shellExec(`${cli} exec --workspace-folder path-that-does-not-exist echo hi`);
						success = true;
					} catch (error) {
						assert.equal(error.error.code, 1, 'Should fail with exit code 1');
						assert.match(error.stderr, /Dev container config \(.*\) not found./);
					}
					assert.equal(success, false, 'expect non-successful call');
				});
			}

			it('should exec with config in subfolder', async () => {
				const upRes = await shellExec(`${cli} up --workspace-folder ${__dirname}/configs/dockerfile-without-features --config ${__dirname}/configs/dockerfile-without-features/.devcontainer/subfolder/devcontainer.json`);
				const response = JSON.parse(upRes.stdout);
				assert.strictEqual(response.outcome, 'success');

				const execRes = await shellExec(`${cli} exec --workspace-folder ${__dirname}/configs/dockerfile-without-features --config ${__dirname}/configs/dockerfile-without-features/.devcontainer/subfolder/devcontainer.json bash -c 'printenv SUBFOLDER_CONFIG_REMOTE_ENV'`);
				assert.strictEqual(execRes.stdout.trim(), 'true');

				await shellExec(`docker rm -f ${response.containerId}`);
			});
		});
	});
}

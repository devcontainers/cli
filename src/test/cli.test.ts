/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as path from 'path';
import * as cp from 'child_process';
import * as fs from 'fs';
import * as os from 'os';

const pkg = require('../../package.json');

const buildKitOptions = [
	{ text: 'non-BuildKit', options: { useBuildKit: false }, },
	{ text: 'BuildKit', options: { useBuildKit: true }, },
] as const;

interface UpResult {
	outcome: string;
	containerId: string;
	composeProjectName: string | undefined;
}

describe('Dev Containers CLI', function () {
	this.timeout('120s');

	const tmp = path.relative(process.cwd(), path.join(__dirname, 'tmp'));
	const cli = `npx --prefix ${tmp} devcontainer`;
	async function devContainerUp(workspaceFolder: string, options?: { useBuildKit?: boolean, userDataFolder?: string }): Promise<UpResult> {
		const buildkitOption = (options?.useBuildKit ?? false) ? '' : ' --buildkit=never';
		const userDataFolderOption = (options?.userDataFolder ?? false) ? ` --user-data-folder=${options?.userDataFolder}` : '';
		const res = await shellExec(`${cli} up --workspace-folder ${workspaceFolder}${buildkitOption}${userDataFolderOption}`);
		const response = JSON.parse(res.stdout);
		assert.equal(response.outcome, 'success');
		const { outcome, containerId, composeProjectName } = response as UpResult;
		assert.ok(containerId, 'Container id not found.');
		return { outcome, containerId, composeProjectName };
	}
	async function devContainerDown(options: { containerId?: string | null; composeProjectName?: string | null }) {
		if (options.containerId) {
			await shellExec(`docker rm -f ${options.containerId}`);
		}
		if (options.composeProjectName) {
			await shellExec(`docker compose --project-name ${options.composeProjectName} down`);
		}
	}
	async function devContainerStop(options: { containerId?: string | null; composeProjectName?: string | null }) {
		if (options.containerId) {
			await shellExec(`docker stop ${options.containerId}`);
		}
		if (options.composeProjectName) {
			await shellExec(`docker compose --project-name ${options.composeProjectName} stop`);
		}
	}
	async function pathExists(workspaceFolder: string, location: string) {
		try {
			await shellExec(`${cli} exec --workspace-folder ${workspaceFolder} test -e ${location}`);
			return true;
		} catch (err) {
			return false;
		}
	}
	async function commandMarkerTests(workspaceFolder: string, expected: { postCreate: boolean; postStart: boolean; postAttach: boolean }, message: string) {
		const actual = {
			postCreate: await pathExists(workspaceFolder, '/tmp/postCreateCommand.testmarker'),
			postStart: await pathExists(workspaceFolder, '/tmp/postStartCommand.testmarker'),
			postAttach: await pathExists(workspaceFolder, '/tmp/postAttachCommand.testmarker'),
		};
		assert.deepStrictEqual(actual, expected, message);
	}


	before('Install', async () => {
		await shellExec(`rm -rf ${tmp}/node_modules`);
		await shellExec(`mkdir -p ${tmp}`);
		await shellExec(`npm --prefix ${tmp} install devcontainers-cli-${pkg.version}.tgz`);
	});

	it('Global --help', async () => {
		const res = await shellExec(`${cli} --help`);
		assert.ok(res.stdout.indexOf('run-user-commands'), 'Help text is not mentioning run-user-commands.');
	});

	describe('Command build', () => {

		buildKitOptions.forEach(({ text, options }) => {
			it(`should execute successfully with valid image config  [${text}]`, async () => {
				const testFolder = `${__dirname}/configs/image`;
				const buildKitOption = (options?.useBuildKit ?? false) ? '' : ' --buildkit=never';
				const res = await shellExec(`${cli} build --workspace-folder ${testFolder}${buildKitOption}`);
				const response = JSON.parse(res.stdout);
				assert.equal(response.outcome, 'success');
			});
			it(`should execute successfully with valid docker-compose (image) config [${text}]`, async () => {
				const testFolder = `${__dirname}/configs/compose-image-with-features`;
				const buildKitOption = (options?.useBuildKit ?? false) ? '' : ' --buildkit=never';
				const res = await shellExec(`${cli} build --workspace-folder ${testFolder}${buildKitOption}`);
				console.log(res.stdout);
				const response = JSON.parse(res.stdout);
				assert.equal(response.outcome, 'success');
			});
			it(`should execute successfully with valid image config and extra cacheFrom [${text}]`, async () => {
				const testFolder = `${__dirname}/configs/image`;
				const buildKitOption = (options?.useBuildKit ?? false) ? '' : ' --buildkit=never';
				// validate the build succeeds with an extra cacheFrom that isn't found
				// (example scenario: CI builds for PRs)
				const res = await shellExec(`${cli} build --workspace-folder ${testFolder} --cache-from ghcr.io/devcontainers/notFound ${buildKitOption}`);
				const response = JSON.parse(res.stdout);
				assert.equal(response.outcome, 'success');
			});
			it(`should execute successfully with valid docker-compose (image) config and extra cacheFrom [${text}]`, async () => {
				const testFolder = `${__dirname}/configs/compose-image-with-features`;
				const buildKitOption = (options?.useBuildKit ?? false) ? '' : ' --buildkit=never';
				// validate the build succeeds with an extra cacheFrom that isn't found
				// (example scenario: CI builds for PRs)
				const res = await shellExec(`${cli} build --workspace-folder ${testFolder} --cache-from ghcr.io/devcontainers/notFound ${buildKitOption}`);
				console.log(res.stdout);
				const response = JSON.parse(res.stdout);
				assert.equal(response.outcome, 'success');
			});
		});

		it('should fail with "not found" error when config is not found', async () => {
			let success = false;
			try {
				await shellExec(`${cli} build --workspace-folder path-that-does-not-exist`);
				success = true;
			} catch (error) {
				assert.equal(error.error.code, 1, 'Should fail with exit code 1');
				const res = JSON.parse(error.stdout);
				assert.equal(res.outcome, 'error');
				assert.match(res.message, /Dev container config \(.*\) not found./);
			}
			assert.equal(success, false, 'expect non-successful call');
		});

		it('should succeed with supported --platform', async () => {
			const testFolder = `${__dirname}/configs/dockerfile-with-target`;
			const res = await shellExec(`${cli} build --workspace-folder ${testFolder} --platform linux/amd64`);
			const response = JSON.parse(res.stdout);
			assert.equal(response.outcome, 'success');
		});

		it('should fail --platform without dockerfile', async () => {
			let success = false;
			const testFolder = `${__dirname}/configs/image`;
			try {
				await shellExec(`${cli} build --workspace-folder ${testFolder} --platform linux/amd64`);
			} catch (error) {
				assert.equal(error.error.code, 1, 'Should fail with exit code 1');
				const res = JSON.parse(error.stdout);
				assert.equal(res.outcome, 'error');
				assert.match(res.message, /require dockerfilePath/);
			}
			assert.equal(success, false, 'expect non-successful call');
		});

		it('should fail with unsupported --platform', async () => {
			let success = false;
			const testFolder = `${__dirname}/configs/dockerfile-with-target`;
			try {
				await shellExec(`${cli} build --workspace-folder ${testFolder} --platform fake/platform`);
				success = true;
			} catch (error) {
				assert.equal(error.error.code, 1, 'Should fail with exit code 1');
				const res = JSON.parse(error.stdout);
				assert.equal(res.outcome, 'error');
				assert.match(res.message, /Command failed/);
			}
			assert.equal(success, false, 'expect non-successful call');
		});

		it('should fail with BuildKit never and --platform', async () => {
			let success = false;
			const testFolder = `${__dirname}/configs/dockerfile-with-target`;
			try {
				await shellExec(`${cli} build --workspace-folder ${testFolder} --buildkit=never --platform linux/amd64`);
			} catch (error) {
				assert.equal(error.error.code, 1, 'Should fail with exit code 1');
				const res = JSON.parse(error.stdout);
				assert.equal(res.outcome, 'error');
				assert.match(res.message, /require BuildKit enabled/);
			}
			assert.equal(success, false, 'expect non-successful call');
		});

		it('should fail with docker-compose and --platform not supported', async () => {
			let success = false;
			const testFolder = `${__dirname}/configs/compose-image-with-features`;
			try {
				await shellExec(`${cli} build --workspace-folder ${testFolder} --platform linux/amd64`);
			} catch (error) {
				assert.equal(error.error.code, 1, 'Should fail with exit code 1');
				const res = JSON.parse(error.stdout);
				assert.equal(res.outcome, 'error');
				assert.match(res.message, /not supported/);
			}
			assert.equal(success, false, 'expect non-successful call');
		});
	});

	describe('Command up', () => {
		it('should execute successfully with valid config', async () => {
			const res = await shellExec(`${cli} up --workspace-folder ${__dirname}/configs/image`);
			const response = JSON.parse(res.stdout);
			assert.equal(response.outcome, 'success');
			const containerId: string = response.containerId;
			assert.ok(containerId, 'Container id not found.');
			await shellExec(`docker rm -f ${containerId}`);
		});

		it('should execute successfully with valid config with features', async () => {
			const res = await shellExec(`${cli} up --workspace-folder ${__dirname}/configs/image-with-features`);
			const response = JSON.parse(res.stdout);
			assert.equal(response.outcome, 'success');
			const containerId: string = response.containerId;
			assert.ok(containerId, 'Container id not found.');
			await shellExec(`docker rm -f ${containerId}`);
		});

		it('should fail with "not found" error when config is not found', async () => {
			let success = false;
			try {
				await shellExec(`${cli} up --workspace-folder path-that-does-not-exist`);
				success = true;
			} catch (error) {
				assert.equal(error.error.code, 1, 'Should fail with exit code 1');
				const res = JSON.parse(error.stdout);
				assert.equal(res.outcome, 'error');
				assert.match(res.message, /Dev container config \(.*\) not found./);
			}
			assert.equal(success, false, 'expect non-successful call');
		});

		// docker-compose variations _without_ features are here (under 'up' tests)
		// docker-compose variations _with_ features are under 'exec' to test features are installed
		describe('for docker-compose with image without features', () => {
			let upResult: UpResult | null = null;
			const testFolder = `${__dirname}/configs/compose-image-without-features`;
			before(async () => {
				// build and start the container
				upResult = await devContainerUp(testFolder);
			});
			after(async () => await devContainerDown({ composeProjectName: upResult?.composeProjectName }));
			it('should succeed', () => {
				assert.equal(upResult!.outcome, 'success');
			});
		});
		describe('for docker-compose with Dockerfile without features', () => {
			let upResult: UpResult | null = null;
			const testFolder = `${__dirname}/configs/compose-Dockerfile-without-features`;
			before(async () => {
				// build and start the container
				upResult = await devContainerUp(testFolder);
			});
			after(async () => await devContainerDown({ composeProjectName: upResult?.composeProjectName }));
			it('should succeed', () => {
				assert.equal(upResult!.outcome, 'success');
			});
		});

		// Additional tests to verify the handling of persisted files
		describe('for docker-compose with Dockerfile with features', () => {
			describe('with existing container and persisted override files', () => {
				let upResult1: UpResult | null = null;
				let upResult2: UpResult | null = null;
				let userDataFolder: string | null = null;
				const testFolder = `${__dirname}/configs/compose-Dockerfile-with-features`;
				before(async () => {
					// Create a new temp folder for persisted files for this test
					// so that we can check the contents...
					const tmpDir = os.tmpdir();
					userDataFolder = fs.mkdtempSync(path.join(tmpDir, 'dc-cli-test-'));

					// build and start the container
					upResult1 = await devContainerUp(testFolder, { userDataFolder });

					// stop the container but don't delete it
					await shellExec(`docker compose --project-name ${upResult1.composeProjectName} stop`);

					// restart the container
					upResult2 = await devContainerUp(testFolder, { userDataFolder });

				});
				after(async () => await devContainerDown({ composeProjectName: upResult2?.composeProjectName }));
				it('should succeed', () => {
					assert.equal(upResult2?.outcome, 'success');
				});
				it('should re-used stopped container', () => {
					assert.equal(upResult2?.containerId, upResult1?.containerId);
				});
				it('should re-used the persisted override file', async () => {
					const userDataFiles = fs.readdirSync(path.join(userDataFolder!, 'docker-compose'));
					assert.equal(userDataFiles.length, 2); // build override and start override
					assert.ok(userDataFiles.findIndex(f => f.startsWith('docker-compose.devcontainer.build-')) >= 0);
					assert.ok(userDataFiles.findIndex(f => f.startsWith('docker-compose.devcontainer.containerFeatures-')) >= 0);
				});
			});
			describe('with existing container and without persisted override files', () => {
				let upResult1: UpResult | null = null;
				let upResult2: UpResult | null = null;
				const testFolder = `${__dirname}/configs/compose-Dockerfile-with-features`;
				before(async () => {
					// Create a new temp folder for persisted files for this test
					// so that we can delete them and check all works ok
					const tmpDir = os.tmpdir();
					const userDataFolder = fs.mkdtempSync(path.join(tmpDir, 'dc-cli-test-'));

					// build and start the container
					upResult1 = await devContainerUp(testFolder, { userDataFolder });

					// stop the container but don't delete it
					await shellExec(`docker compose --project-name ${upResult1.composeProjectName} stop`);
					assert.ok(upResult1?.composeProjectName);

					// recreate directory to delete cached files
					fs.rmSync(userDataFolder, { force: true, recursive: true });
					fs.mkdirSync(userDataFolder);

					// restart the container
					upResult2 = await devContainerUp(testFolder, { userDataFolder });

				});
				after(async () => await devContainerDown({ composeProjectName: upResult2?.composeProjectName }));
				it('should succeed', () => {
					assert.equal(upResult2?.outcome, 'success');
				});
				it('should re-use stopped container', () => {
					assert.equal(upResult2?.containerId, upResult1?.containerId);
				});
			});
		});
	});

	describe('Command run-user-commands', () => {
		describe('with valid config', () => {
			let containerId: string | null = null;
			const testFolder = `${__dirname}/configs/image`;
			beforeEach(async () => containerId = (await devContainerUp(testFolder)).containerId);
			afterEach(async () => await devContainerDown({ containerId }));
			it('should execute successfully', async () => {
				const res = await shellExec(`${cli} run-user-commands --workspace-folder ${testFolder}`);
				const response = JSON.parse(res.stdout);
				assert.equal(response.outcome, 'success');
			});
		});

		it('should fail with "not found" error when config is not found', async () => {
			let success = false;
			try {
				await shellExec(`${cli} run-user-commands --workspace-folder path-that-does-not-exist`);
				success = true;
			} catch (error) {
				assert.equal(error.error.code, 1, 'Should fail with exit code 1');
				const res = JSON.parse(error.stdout);
				assert.equal(res.outcome, 'error');
				assert.match(res.message, /Dev container config \(.*\) not found./);
			}
			assert.equal(success, false, 'expect non-successful call');
		});
	});

	describe('Command exec', () => {

		buildKitOptions.forEach(({ text, options }) => {
			describe(`with valid (image) config [${text}]`, () => {
				let containerId: string | null = null;
				const testFolder = `${__dirname}/configs/image`;
				beforeEach(async () => containerId = (await devContainerUp(testFolder, options)).containerId);
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
				beforeEach(async () => containerId = (await devContainerUp(testFolder, options)).containerId);
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
				beforeEach(async () => containerId = (await devContainerUp(testFolder, options)).containerId);
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

			describe(`with valid (Dockerfile) config with target [${text}]`, () => {
				let containerId: string | null = null;
				const testFolder = `${__dirname}/configs/dockerfile-with-target`;
				beforeEach(async () => containerId = (await devContainerUp(testFolder, options)).containerId);
				afterEach(async () => await devContainerDown({ containerId }));
				it('should have build marker content', async () => {
					const res = await shellExec(`${cli} exec --workspace-folder ${testFolder} cat /var/test-marker`);
					const response = JSON.parse(res.stdout);
					console.log(res.stderr);
					assert.equal(response.outcome, 'success');
					assert.match(res.stderr, /||test-content||/);
				});
			});

			describe(`with valid (docker-compose with image) config containing features [${text}]`, () => {
				let composeProjectName: string | undefined = undefined;
				const testFolder = `${__dirname}/configs/compose-image-with-features`;
				beforeEach(async () => composeProjectName = (await devContainerUp(testFolder, options)).composeProjectName);
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

			describe(`with valid (docker-compose with Dockerfile) config containing features [${text}]`, () => {
				let composeProjectName: string | undefined = undefined;
				const testFolder = `${__dirname}/configs/compose-Dockerfile-with-features`;
				beforeEach(async () => composeProjectName = (await devContainerUp(testFolder, options)).composeProjectName);
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

			describe(`with valid (docker-compose with Dockerfile and target) config containing features [${text}]`, () => {
				let composeProjectName: string | undefined = undefined;
				const testFolder = `${__dirname}/configs/compose-Dockerfile-with-target`;
				beforeEach(async () => composeProjectName = (await devContainerUp(testFolder, options)).composeProjectName);
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
					containerId = (await devContainerUp(testFolder, options)).containerId;
					// Should have all markers (Create + Start + Attach)
					await commandMarkerTests(testFolder, { postCreate: true, postStart: true, postAttach: true }, 'Markers on first create');

					// Clear markers and stop
					await shellExec(`${cli} exec --workspace-folder ${testFolder} /bin/sh -c "rm /tmp/*.testmarker"`);
					await devContainerStop({ containerId });

					// Restart container - should have Start + Attach
					containerId = (await devContainerUp(testFolder, options)).containerId;
					await commandMarkerTests(testFolder, { postCreate: false, postStart: true, postAttach: true }, 'Markers on restart');

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
					composeProjectName = (await devContainerUp(testFolder, options)).composeProjectName;
					// Should have all markers (Create + Start + Attach)
					await commandMarkerTests(testFolder, { postCreate: true, postStart: true, postAttach: true }, 'Markers on first create');

					// Clear markers and stop
					await shellExec(`${cli} exec --workspace-folder ${testFolder} /bin/sh -c "rm /tmp/*.testmarker"`);
					await devContainerStop({ composeProjectName });

					// Restart container - should have Start + Attach
					composeProjectName = (await devContainerUp(testFolder, options)).composeProjectName;
					await commandMarkerTests(testFolder, { postCreate: false, postStart: true, postAttach: true }, 'Markers on restart');

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
					containerId = (await devContainerUp(testFolder, options)).containerId;
					// Should have all markers (Create + Start + Attach)
					await commandMarkerTests(testFolder, { postCreate: true, postStart: true, postAttach: true }, 'Markers on first create');

					// Clear markers and stop
					await shellExec(`${cli} exec --workspace-folder ${testFolder} /bin/sh -c "rm /tmp/*.testmarker"`);
					await devContainerStop({ containerId });

					// Restart container - should have Start + Attach
					containerId = (await devContainerUp(testFolder, options)).containerId;
					await commandMarkerTests(testFolder, { postCreate: false, postStart: true, postAttach: true }, 'Markers on restart');

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
						containerId = (await devContainerUp(testFolder, options)).containerId;
						// Should have all markers (Create + Start + Attach)
						await commandMarkerTests(testFolder, { postCreate: true, postStart: true, postAttach: true }, 'Markers on first create');

						// Clear markers and stop
						await shellExec(`${cli} exec --workspace-folder ${testFolder} /bin/sh -c "rm /tmp/*.testmarker"`);
						assert.ok(containerId);
						await devContainerStop({ containerId });

						// Restart container - should have Start + Attach
						containerId = (await devContainerUp(testFolder, options)).containerId;
						await commandMarkerTests(testFolder, { postCreate: false, postStart: true, postAttach: true }, 'Markers on restart');

						// TODO - investigate what triggers postAttachCommand and check test is valid
						// // Clear markers and re-test - should have Attach
						// await shellExec(`${cli} exec --workspace-folder ${testFolder} /bin/sh -c "rm /tmp/*.testmarker"`);
						// await commandMarkerTests(testFolder, { postCreate: false, postStart: false, postAttach: true }, 'Markers on attach');
					});
				});
			});
		});

		describe('with valid (Dockerfile) config containing #syntax (BuildKit)', () => { // ensure existing '# syntax' lines are handled
			let containerId: string | null = null;
			const testFolder = `${__dirname}/configs/dockerfile-with-syntax`;
			beforeEach(async () => containerId = (await devContainerUp(testFolder, { useBuildKit: true })).containerId);
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


	});


});

interface ExecResult {
	error: Error | null;
	stdout: string;
	stderr: string;
}

function shellExec(command: string, options: cp.ExecOptions = {}, suppressOutput: boolean = false) {
	return new Promise<ExecResult>((resolve, reject) => {
		cp.exec(command, options, (error, stdout, stderr) => {
			if (!suppressOutput) {
				console.log(stdout);
				console.error(stderr);
			}
			(error ? reject : resolve)({ error, stdout, stderr });
		});
	});
}

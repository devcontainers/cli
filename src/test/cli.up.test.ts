/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { devContainerDown, devContainerUp, shellExec, UpResult } from './testUtils';

const pkg = require('../../package.json');

describe('Dev Containers CLI', function () {
	this.timeout('240s');

	const tmp = path.relative(process.cwd(), path.join(__dirname, 'tmp'));
	const cli = `npx --prefix ${tmp} devcontainer`;


	before('Install', async () => {
		await shellExec(`rm -rf ${tmp}/node_modules`);
		await shellExec(`mkdir -p ${tmp}`);
		await shellExec(`npm --prefix ${tmp} install devcontainers-cli-${pkg.version}.tgz`);
	});

	describe('Command up', () => {

		it('should execute successfully with valid config', async () => {
			const res = await shellExec(`${cli} up --workspace-folder ${__dirname}/configs/image --include-configuration --include-merged-configuration`);
			const response = JSON.parse(res.stdout);
			assert.equal(response.outcome, 'success');
			assert.equal(response.configuration?.remoteEnv?.TEST_RE, 'TEST_VALUE3');
			assert.equal(response.mergedConfiguration?.remoteEnv?.TEST_RE, 'TEST_VALUE3');
			const containerId: string = response.containerId;
			assert.ok(containerId, 'Container id not found.');
			await shellExec(`docker rm -f ${containerId}`);
		});

		it('should execute successfully with valid config with a Feature', async () => {
			const res = await shellExec(`${cli} up --workspace-folder ${__dirname}/configs/image-with-git-feature`);
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
				upResult = await devContainerUp(cli, testFolder);
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
				upResult = await devContainerUp(cli, testFolder);
			});
			after(async () => await devContainerDown({ composeProjectName: upResult?.composeProjectName }));
			it('should succeed', () => {
				assert.equal(upResult!.outcome, 'success');
			});
		});
		describe('for minimal docker-compose with custom project name', () => {
			let upResult: UpResult | null = null;
			const testFolder = `${__dirname}/configs/compose-with-name`;
			before(async () => {
				// build and start the container
				upResult = await devContainerUp(cli, testFolder, { 'logLevel': 'trace', extraArgs: `--docker-compose-path trigger-compose-v2` });
			});
			after(async () => await devContainerDown({ composeProjectName: upResult?.composeProjectName }));
			it('should succeed', () => {
				assert.equal(upResult!.outcome, 'success');
				assert.equal(upResult!.composeProjectName, 'custom-project-name');
			});
		});
		describe('for minimal docker-compose with custom project name using environment variable', () => {
			let upResult: UpResult | null = null;
			const testFolder = `${__dirname}/configs/compose-with-name-using-env-var`;
			before(async () => {
				// build and start the container
				upResult = await devContainerUp(cli, testFolder, {
					logLevel: 'trace',
					extraArgs: `--docker-compose-path trigger-compose-v2`,
					env: {
						...process.env,
						'CUSTOM_NAME': 'custom-name-with-env-var'
					}
				});
			});
			after(async () => await devContainerDown({ composeProjectName: upResult?.composeProjectName }));
			it('should succeed', () => {
				assert.equal(upResult!.outcome, 'success');
				assert.equal(upResult!.composeProjectName, 'custom-name-with-env-var');
			});
		});
		describe('for minimal docker-compose with custom project name "devcontainer" using environment variable', () => {
			let upResult: UpResult | null = null;
			const testFolder = `${__dirname}/configs/compose-with-name-using-env-var`;
			before(async () => {
				// build and start the container
				upResult = await devContainerUp(cli, testFolder, {
					logLevel: 'trace',
					extraArgs: `--docker-compose-path trigger-compose-v2`,
					env: {
						...process.env,
						'CUSTOM_NAME': 'devcontainer'
					}
				});
			});
			after(async () => await devContainerDown({ composeProjectName: upResult?.composeProjectName }));
			it('should succeed', () => {
				assert.equal(upResult!.outcome, 'success');
				assert.equal(upResult!.composeProjectName, 'devcontainer');
			});
		});
		describe('for minimal docker-compose with custom project name and custom yaml', () => {
			let upResult: UpResult | null = null;
			const testFolder = `${__dirname}/configs/compose-with-name-and-custom-yaml`;
			before(async () => {
				// build and start the container
				upResult = await devContainerUp(cli, testFolder, { 'logLevel': 'trace', extraArgs: `--docker-compose-path trigger-compose-v2` });
			});
			after(async () => await devContainerDown({ composeProjectName: upResult?.composeProjectName }));
			it('should succeed', () => {
				assert.equal(upResult!.outcome, 'success');
				assert.equal(upResult!.composeProjectName, 'custom-project-name-custom-yaml');
			});
		});
		describe('for minimal docker-compose without custom project name', () => {
			let upResult: UpResult | null = null;
			const testFolder = `${__dirname}/configs/compose-without-name`;
			before(async () => {
				// build and start the container
				upResult = await devContainerUp(cli, testFolder, { 'logLevel': 'trace', extraArgs: `--docker-compose-path trigger-compose-v2` });
			});
			after(async () => await devContainerDown({ composeProjectName: upResult?.composeProjectName }));
			it('should succeed', () => {
				assert.equal(upResult!.outcome, 'success');
				assert.equal(upResult!.composeProjectName, 'compose-without-name_devcontainer');
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
					upResult1 = await devContainerUp(cli, testFolder, { userDataFolder });

					// stop the container but don't delete it
					await shellExec(`docker compose --project-name ${upResult1.composeProjectName} stop`);

					// restart the container
					upResult2 = await devContainerUp(cli, testFolder, { userDataFolder });

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
					upResult1 = await devContainerUp(cli, testFolder, { userDataFolder });

					// stop the container but don't delete it
					await shellExec(`docker compose --project-name ${upResult1.composeProjectName} stop`);
					assert.ok(upResult1?.composeProjectName);

					// recreate directory to delete cached files
					fs.rmSync(userDataFolder, { force: true, recursive: true });
					fs.mkdirSync(userDataFolder);

					// restart the container
					upResult2 = await devContainerUp(cli, testFolder, { userDataFolder });

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

		it('should follow the correct merge logic for containerEnv', async () => {
			const res = await shellExec(`${cli} up --workspace-folder ${__dirname}/configs/image-metadata-containerEnv`);
			const response = JSON.parse(res.stdout);
			assert.equal(response.outcome, 'success');
			const containerId: string = response.containerId;
			assert.ok(containerId, 'Container id not found.');

			const javaHome = await shellExec(`docker exec ${containerId} bash -c 'echo -n $JAVA_HOME'`);
			assert.equal('/usr/lib/jvm/msopenjdk-current', javaHome.stdout);

			const envWithSpaces = await shellExec(`docker exec ${containerId} bash -c 'echo -n $VAR_WITH_SPACES'`);
			assert.equal('value with spaces', envWithSpaces.stdout);

			const evalEnvWithCommand = await shellExec(`docker exec ${containerId} bash -c 'eval $ENV_WITH_COMMAND'`);
			assert.equal('Hello, World!', evalEnvWithCommand.stdout);

			await shellExec(`docker rm -f ${containerId}`);
		});

		it('should follow the correct merge logic for containerEnv using docker compose', async () => {
			const res = await shellExec(`${cli} up --workspace-folder ${__dirname}/configs/image-containerEnv-issue`);
			const response = JSON.parse(res.stdout);
			assert.equal(response.outcome, 'success');
			const containerId: string = response.containerId;
			assert.ok(containerId, 'Container id not found.');

			const somePath = await shellExec(`docker exec ${containerId} bash -c 'echo -n $SOME_PATH'`);
			assert.equal('/tmp/path/doc-ver/loc', somePath.stdout);

			const envWithSpaces = await shellExec(`docker exec ${containerId} bash -c 'echo -n $VAR_WITH_SPACES'`);
			assert.equal('value with spaces', envWithSpaces.stdout);

			const evalEnvWithCommand = await shellExec(`docker exec ${containerId} bash -c 'eval $ENV_WITH_COMMAND'`);
			assert.equal('Hello, World!', evalEnvWithCommand.stdout);

			const envWithTestMessage = await shellExec(`docker exec ${containerId} bash -c 'echo -n $Test_Message'`);
			assert.equal('H"\\n\\ne"\'\'\'llo M:;a/t?h&^iKa%#@!``ni,sk_a-', envWithTestMessage.stdout);			

			const envWithFormat = await shellExec(`docker exec ${containerId} bash -c 'echo -n $ROSCONSOLE_FORMAT'`);
			assert.equal('[$${severity}] [$${walltime:%Y-%m-%d %H:%M:%S}] [$${node}]: $${message}', envWithFormat.stdout);

			const envWithDoubleQuote = await shellExec(`docker exec ${containerId} bash -c 'echo -n $VAR_WITH_QUOTES_WE_WANT_TO_KEEP'`);
			assert.equal('value with \"quotes\" we want to keep', envWithDoubleQuote.stdout);

			const envWithDollar = await shellExec(`docker exec ${containerId} bash -c 'echo -n $VAR_WITH_DOLLAR_SIGN'`);
			assert.equal('value with $dollar sign', envWithDollar.stdout);

			const envWithBackSlash = await shellExec(`docker exec ${containerId} bash -c 'echo -n $VAR_WITH_BACK_SLASH'`);
			assert.equal('value with \\back slash', envWithBackSlash.stdout);	

			await shellExec(`docker rm -f ${containerId}`);
		});		

		it('should run with config in subfolder', async () => {
			const upRes = await shellExec(`${cli} up --workspace-folder ${__dirname}/configs/dockerfile-without-features --config ${__dirname}/configs/dockerfile-without-features/.devcontainer/subfolder/devcontainer.json`);
			const response = JSON.parse(upRes.stdout);
			assert.strictEqual(response.outcome, 'success');

			await shellExec(`docker exec ${response.containerId} test -f /subfolderConfigPostCreateCommand.txt`);

			await shellExec(`docker rm -f ${response.containerId}`);
		});
	});
});
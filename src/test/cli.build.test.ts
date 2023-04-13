/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import * as assert from 'assert';
import * as path from 'path';
import * as os from 'os';
import { buildKitOptions, shellExec } from './testUtils';
import { ImageDetails } from '../spec-shutdown/dockerUtils';
import { envListToObj } from '../spec-node/utils';

const pkg = require('../../package.json');

describe('Dev Containers CLI', function () {
	this.timeout('120s');

	const tmp = path.relative(process.cwd(), path.join(__dirname, 'tmp'));
	const cli = `npx --prefix ${tmp} devcontainer`;

	before('Install', async () => {
		await shellExec(`rm -rf ${tmp}/node_modules`);
		await shellExec(`mkdir -p ${tmp}`);
		await shellExec(`npm --prefix ${tmp} install devcontainers-cli-${pkg.version}.tgz`);
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
				const res = await shellExec(`${cli} build --workspace-folder ${testFolder}${buildKitOption} --log-level trace`);
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

		it('should succeed (dockerfile) with supported --platform', async () => {
			const testFolder = `${__dirname}/configs/dockerfile-with-target`;
			const res = await shellExec(`${cli} build --workspace-folder ${testFolder} --platform linux/amd64`);
			const response = JSON.parse(res.stdout);
			assert.equal(response.outcome, 'success');
		});

		it('should succeed (image) with supported --platform', async () => {
			const testFolder = `${__dirname}/configs/image-with-features`;
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

		it('should succeed with multiple --image-name parameters when DockerFile is present', async () => {
			const testFolder = `${__dirname}/configs/dockerfile-with-features`;
			const image1 = 'image-1';
			const image2 = 'image-2';
			const res = await shellExec(`${cli} build --workspace-folder ${testFolder} --image-name ${image1} --image-name ${image2}`);
			const response = JSON.parse(res.stdout);
			assert.equal(response.outcome, 'success');
			assert.equal(response.imageName[0], image1);
			assert.equal(response.imageName[1], image2);
		});

		it('should succeed with multiple --image-name parameters when dockerComposeFile is present', async () => {
			const testFolder = `${__dirname}/configs/compose-Dockerfile-alpine`;
			const image1 = 'image-1';
			const image2 = 'image-2';
			const res = await shellExec(`${cli} build --workspace-folder ${testFolder} --image-name ${image1} --image-name ${image2}`);
			const response = JSON.parse(res.stdout);
			assert.equal(response.outcome, 'success');
			assert.equal(response.imageName[0], image1);
			assert.equal(response.imageName[1], image2);
		});

		it('should succeed with multiple --image-name parameters when image is present', async () => {
			const testFolder = `${__dirname}/configs/image`;
			const image1 = 'image-1';
			const image2 = 'image-2';
			const res = await shellExec(`${cli} build --workspace-folder ${testFolder} --image-name ${image1} --image-name ${image2}`);
			const response = JSON.parse(res.stdout);
			assert.equal(response.outcome, 'success');
			assert.equal(response.imageName[0], image1);
			assert.equal(response.imageName[1], image2);
		});

		it('should fail with --push true and --output', async () => {
			let success = false;
			const testFolder = `${__dirname}/configs/dockerfile-with-target`;
			try {
				await shellExec(`${cli} build --workspace-folder ${testFolder} --output type=oci,dest=output.tar --push true`);
			} catch (error) {
				assert.equal(error.error.code, 1, 'Should fail with exit code 1');
				const res = JSON.parse(error.stdout);
				assert.equal(res.outcome, 'error');
				assert.match(res.message, /cannot be used with/);
			}
			assert.equal(success, false, 'expect non-successful call');
		});

		it('file ${os.tmpdir()}/output.tar should exist when using --output type=oci,dest=${os.tmpdir()/output.tar', async () => {
			const testFolder = `${__dirname}/configs/dockerfile-with-target`;
			const outputPath = `${os.tmpdir()}/output.tar`;
			await shellExec('docker buildx create --name ocitest');
			await shellExec('docker buildx use ocitest');
			const res = await shellExec(`${cli} build --workspace-folder ${testFolder} --output 'type=oci,dest=${outputPath}'`);
			await shellExec('docker buildx use default');
			await shellExec('docker buildx rm ocitest');
			const response = JSON.parse(res.stdout);
			assert.equal(response.outcome, 'success');
			assert.equal(fs.existsSync(outputPath), true);
		});

		it(`should execute successfully docker-compose without features with container builder`, async () => {
			const builderName = 'test-container-builder';
			try {
				await shellExec(`docker buildx create --name ${builderName} --driver docker-container --use`);

				const testFolder = `${__dirname}/configs/compose-image-without-features-minimal`;
				const res = await shellExec(`${cli} build --workspace-folder ${testFolder} --log-level trace`);
				console.log(res.stdout);
				const response = JSON.parse(res.stdout);
				assert.equal(response.outcome, 'success');

			} finally {
				await shellExec(`docker buildx rm ${builderName}`);
			}
		});

		it('should follow the correct merge logic for containerEnv', async () => {
			const res = await shellExec(`${cli} build --workspace-folder ${__dirname}/configs/image-metadata-containerEnv --image-name "test-metadata"`);
			const response = JSON.parse(res.stdout);
			assert.equal(response.outcome, 'success');

			const resRun = await shellExec(`docker run -it -d "test-metadata"`);
			const containerId: string = resRun.stdout.split('\n')[0];
			assert.ok(containerId, 'Container id not found.');

			const expectedContainerEnv = {
				'JAVA_HOME': '/usr/lib/jvm/msopenjdk-current',
				'VAR_WITH_SPACES': 'value with spaces',
				'VAR_WITH_LOTS_OF_SPACES': '    value with lots of spaces.   ',
				'VAR_WITH_QUOTES_WE_WANT_TO_KEEP': 'value with "quotes" we want to keep',
				'VAR_WITH_DOLLAR_SIGN': 'value with $dollar sign',
				'VAR_WITH_BACK_SLASH': 'value with \\back slash',
				'ENV_WITH_COMMAND': 'bash -c \'echo -n "Hello, World!"\''
			};

			for (const [key, value] of Object.entries(expectedContainerEnv)) {
				const result = await shellExec(`docker exec ${containerId} bash -c 'echo $${key}'`);
				assert.equal(result.stdout, `${value.trim()}\n`);
			}

			await shellExec(`docker rm -f ${containerId}`);
		});

		it('should build with config in subfolder', async () => {
			const res = await shellExec(`${cli} build --workspace-folder ${__dirname}/configs/dockerfile-without-features --config ${__dirname}/configs/dockerfile-without-features/.devcontainer/subfolder/devcontainer.json --image-name test-subfolder-config`);
			const response = JSON.parse(res.stdout);
			assert.strictEqual(response.outcome, 'success');

			const details = JSON.parse((await shellExec(`docker inspect test-subfolder-config`)).stdout)[0] as ImageDetails;
			assert.strictEqual(envListToObj(details.Config.Env).SUBFOLDER_CONFIG_IMAGE_ENV, 'true');
		});
	});
});
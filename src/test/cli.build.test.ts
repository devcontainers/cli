/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as path from 'path';
import { buildKitOptions, shellExec } from './testUtils';
import shelljs from 'shelljs';

const pkg = require(path.join('..', '..', 'package.json'));

// const toGitBashPosixPath = (windowsPath: string) => windowsPath.replace(/^(\w):|\\+/g, '/$1').split(path.win32.sep).join(path.posix.sep);

describe('Dev Containers CLI', function () {
	this.timeout('120s');

	const tmp = path.relative(process.cwd(), path.join(__dirname, 'tmp'));
	const cli = `node ${path.join(tmp, 'node_modules', '@devcontainers', 'cli', 'devcontainer.js')}`;

	before('Install', function () {
		console.log('Pkg Version: ' pkg.version);
		shelljs.rm('-rf', path.posix.join(tmp, 'node_modules'));
		shelljs.mkdir([tmp]);
		const output = shelljs.exec(`npm --prefix ${tmp} install devcontainers-cli-${pkg.version}.tgz`);
		assert.strictEqual(output.code, 0);
	});

	describe('Command build', () => {

		it('jospicer sanity check', async () => {
			const cmd = `${cli} --version`;
			console.log('cmd = ' + cmd);
			const output = shellExec(cmd);

			console.log('code: ' + output.code);
			console.log('stdout: ' + output.stdout);
			console.log('stderr: ' + output.stderr);

			assert.strictEqual(output.code, 0);
			assert.strictEqual(output.error, null);
			assert.match(output.stdout, /0.14.2/);

		});

		buildKitOptions.forEach(({ text, options }) => {
			it(`should execute successfully with valid image config jospicer test [${text}]`, async () => {
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
	});
});

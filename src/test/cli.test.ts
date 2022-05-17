/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as path from 'path';
import * as cp from 'child_process';

const pkg = require('../../package.json');

const buildKitOptions = [
	{ text: 'non-BuildKit', options: { useBuildKit: false }, },
	{ text: 'BuildKit', options: { useBuildKit: true }, },
] as const;

describe('Dev Containers CLI', function () {
	this.timeout('120s');

	const tmp = path.relative(process.cwd(), path.join(__dirname, 'tmp'));
	const cli = `npx --prefix ${tmp} devcontainer`;
	async function devContainerUp(workspaceFolder: string, options?: { useBuildKit?: boolean }) {
		const buildkitOption = (options?.useBuildKit ?? false) ? '' : ' --buildkit=never';
		const res = await shellExec(`${cli} up --workspace-folder ${workspaceFolder}${buildkitOption}`);
		const response = JSON.parse(res.stdout);
		assert.equal(response.outcome, 'success');
		const containerId = response.containerId;
		assert.ok(containerId, 'Container id not found.');
		return containerId;
	}
	async function devContainerDown(containerId: string | null) {
		if (containerId === null) {
			throw new Error('containerId not set');
		}
		if (containerId !== null) {
			await shellExec(`docker rm -f ${containerId}`);
		}
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
		it('should execute successfully with valid config', async () => {
			const testFolder = `${__dirname}/configs/image`;
			const res = await shellExec(`${cli} build --workspace-folder ${testFolder}`);
			const response = JSON.parse(res.stdout);
			assert.equal(response.outcome, 'success');
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
	});

	describe('Command run-user-commands', () => {
		describe('with valid config', () => {
			let containerId: string | null = null;
			const testFolder = `${__dirname}/configs/image`;
			beforeEach(async () => containerId = await devContainerUp(testFolder));
			afterEach(async () => await devContainerDown(containerId));
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
				beforeEach(async () => containerId = await devContainerUp(testFolder, options));
				afterEach(async () => await devContainerDown(containerId));
				it('should execute successfully', async () => {
					const res = await shellExec(`${cli} exec --workspace-folder ${testFolder} echo hi`);
					const response = JSON.parse(res.stdout);
					assert.equal(response.outcome, 'success');
				});
			});
			describe(`with valid (image) config containing features [${text}]`, () => {
				let containerId: string | null = null;
				const testFolder = `${__dirname}/configs/image-with-features`;
				beforeEach(async () => containerId = await devContainerUp(testFolder, options));
				afterEach(async () => await devContainerDown(containerId));
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
				beforeEach(async () => containerId = await devContainerUp(testFolder, options));
				afterEach(async () => await devContainerDown(containerId));
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
				beforeEach(async () => containerId = await devContainerUp(testFolder, options));
				afterEach(async () => await devContainerDown(containerId));
				it('should have marker content', async () => {
					const res = await shellExec(`${cli} exec --workspace-folder ${testFolder} cat /tmp/test-marker`);
					const response = JSON.parse(res.stdout);
					console.log(res.stderr);
					assert.equal(response.outcome, 'success');
					assert.match(res.stderr, /||test-content||/);
				});
			});
		});

		describe('with valid (Dockerfile) config containing #syntax (BuildKit)', () => { // ensure existing '# syntax' lines are handled
			let containerId: string | null = null;
			const testFolder = `${__dirname}/configs/dockerfile-with-syntax`;
			beforeEach(async () => containerId = await devContainerUp(testFolder, { useBuildKit: true }));
			afterEach(async () => await devContainerDown(containerId));
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

function shellExec(command: string, options: cp.ExecOptions = {}) {
	return new Promise<ExecResult>((resolve, reject) => {
		cp.exec(command, options, (error, stdout, stderr) => {
			console.log(stdout);
			console.error(stderr);
			(error ? reject : resolve)({ error, stdout, stderr });
		});
	});
}

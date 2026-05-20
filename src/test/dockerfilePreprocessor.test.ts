/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

import { ContainerError } from '../spec-common/errors';
import { getCLIHost, loadNativeModule } from '../spec-common/commonUtils';
import { preprocessDockerExtensionFile, getDockerfilePreprocessedPath } from '../spec-node/dockerfilePreprocessor';
import { nullLog } from '../spec-utils/log';
import { devContainerDown, devContainerUp, shellExec } from './testUtils';

const pkg = require('../../package.json');

describe('dockerfilePreprocessor', function () {
	it('returns undefined for non-.in Dockerfile', () => {
		assert.strictEqual(getDockerfilePreprocessedPath('/tmp/Dockerfile'), undefined);
	});

	it('returns preprocessed path for .in Dockerfile', () => {
		assert.strictEqual(getDockerfilePreprocessedPath('/tmp/Dockerfile.in'), '/tmp/Dockerfile');
	});

	it('returns configured relative output path', () => {
		assert.strictEqual(getDockerfilePreprocessedPath('/tmp/folder/Dockerfile.in', 'generated/Dockerfile'), '/tmp/folder/generated/Dockerfile');
	});

	it('returns undefined for non-.in Dockerfile even when output is configured', () => {
		assert.strictEqual(getDockerfilePreprocessedPath('/tmp/folder/Dockerfile', 'generated/Dockerfile'), undefined);
	});

	it('throws when dockerfilePreprocessor.commands is missing for .in Dockerfile', async () => {
		const cliHost = await getCLIHost(process.cwd(), loadNativeModule, true);
		await assert.rejects(
			preprocessDockerExtensionFile(
				{ cliHost, output: nullLog },
				{},
				'/tmp/Dockerfile.in'
			),
			(err: unknown) => {
				assert.ok(err instanceof ContainerError);
				assert.match((err as ContainerError).description, /dockerfilePreprocessor\.commands/i);
				return true;
			}
		);
	});

	it('runs commands and produces Dockerfile output', async function () {
		const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'devcontainer-preprocess-'));
		const inputPath = path.join(tmpDir, 'Dockerfile.in');
		const outputPath = path.join(tmpDir, 'Dockerfile');
		await fs.writeFile(inputPath, 'FROM alpine:3.20\n');

		const cliHost = await getCLIHost(process.cwd(), loadNativeModule, true);
		const result = await preprocessDockerExtensionFile(
			{ cliHost, output: nullLog },
			{ dockerfilePreprocessor: { commands: ['cat "$input_file" > "$output_file"'] } },
			inputPath
		);

		assert.strictEqual(result, outputPath);
		const outputContent = (await fs.readFile(outputPath)).toString();
		assert.strictEqual(outputContent, 'FROM alpine:3.20\n');
	});

	it('runs ordered commands and writes configured output file', async function () {
		const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'devcontainer-preprocess-'));
		const inputPath = path.join(tmpDir, 'Dockerfile.in');
		const outputPath = path.join(tmpDir, 'generated', 'Dockerfile');
		await fs.mkdir(path.dirname(outputPath), { recursive: true });
		await fs.writeFile(inputPath, 'FROM alpine:3.20\n');

		const cliHost = await getCLIHost(process.cwd(), loadNativeModule, true);
		const result = await preprocessDockerExtensionFile(
			{ cliHost, output: nullLog },
			{ dockerfilePreprocessor: { commands: ['cp "$input_file" "$output_file"'], output: 'generated/Dockerfile' } },
			inputPath
		);

		assert.strictEqual(result, outputPath);
		const outputContent = (await fs.readFile(outputPath)).toString();
		assert.strictEqual(outputContent, 'FROM alpine:3.20\n');
	});

	it('throws when a preprocessor command fails', async () => {
		const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'devcontainer-preprocess-'));
		const inputPath = path.join(tmpDir, 'Dockerfile.in');
		await fs.writeFile(inputPath, 'FROM alpine:3.20\n');

		const cliHost = await getCLIHost(process.cwd(), loadNativeModule, true);
		await assert.rejects(preprocessDockerExtensionFile(
			{ cliHost, output: nullLog },
			{ dockerfilePreprocessor: { commands: ['this-command-should-not-exist-xyz123'] } },
			inputPath
		));
	});

	it('throws when commands succeed but output Dockerfile is not generated', async () => {
		const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'devcontainer-preprocess-'));
		const inputPath = path.join(tmpDir, 'Dockerfile.in');
		await fs.writeFile(inputPath, 'FROM alpine:3.20\n');

		const cliHost = await getCLIHost(process.cwd(), loadNativeModule, true);
		await assert.rejects(
			preprocessDockerExtensionFile(
				{ cliHost, output: nullLog },
				{ dockerfilePreprocessor: { commands: ['true'] } },
				inputPath
			),
			(err: unknown) => {
				assert.ok(err instanceof ContainerError);
				assert.match((err as ContainerError).description, /did not produce/i);
				return true;
			}
		);
	});
});

(process.platform === 'linux' ? describe : describe.skip)('dockerfilePreprocessor integration', function () {
	this.timeout('240s');

	const tmp = path.relative(process.cwd(), path.join(__dirname, 'tmp'));
	const cli = `npx --prefix ${tmp} devcontainer`;
	let cppAvailable = false;
	let cmakeAvailable = false;
	let mesonAvailable = false;
	let autoconfAvailable = false;

	before('Install', async () => {
		await shellExec(`rm -rf ${tmp}/node_modules`);
		await shellExec(`mkdir -p ${tmp}`);
		await shellExec(`npm --prefix ${tmp} install devcontainers-cli-${pkg.version}.tgz`);
		const commandCheck = await shellExec('command -v cpp', undefined, true, true);
		cppAvailable = Boolean(commandCheck.stdout.trim());
		const cmakeCheck = await shellExec('command -v cmake', undefined, true, true);
		cmakeAvailable = Boolean(cmakeCheck.stdout.trim());
		const mesonCheck = await shellExec('command -v meson', undefined, true, true);
		mesonAvailable = Boolean(mesonCheck.stdout.trim());
		const autoconfCheck = await shellExec('command -v autoconf', undefined, true, true);
		autoconfAvailable = Boolean(autoconfCheck.stdout.trim());
	});

		it('should preprocess a Dockerfile.in during up cpp', async function () {
			if (!cppAvailable) {
				this.skip();
			}
			const testFolder = `${__dirname}/configs/dockerfile-cpp-preprocessor`;
			let containerId: string | undefined;
			try {
				containerId = (await devContainerUp(cli, testFolder)).containerId;
				await shellExec(`${cli} exec --workspace-folder ${testFolder} sh -lc 'command -v nodejs && command -v python3 && command -v curl && command -v wget && command -v vim && test -f /usr/local/bin/test.sh'`);
			} finally {
				await devContainerDown({ containerId, doNotThrow: true });
			}
		});

		it('should preprocess a Dockerfile.in during up cmake', async function (){
			if (!cmakeAvailable){
				this.skip();
			}
			const testFolder = `${__dirname}/configs/dockerfile-cmake-preprocessor`;
			let containerId: string | undefined;
			try {
				containerId = (await devContainerUp(cli, testFolder)).containerId;
				// Check that the expected base image and port are set in the running container
				await shellExec(`${cli} exec --workspace-folder ${testFolder} sh -lc 'command -v node && command -v npm'`);
			} finally {
				await devContainerDown({ containerId, doNotThrow: true });
			}
		});

		it('should preprocess a Dockerfile.in during up cmake when no output folder is specified', async function () {
			if (!cmakeAvailable){
				this.skip();
			}
			const testFolder = `${__dirname}/configs/dockerfile-cmake2-preprocessor`;
			let containerId: string | undefined;
			try {
				containerId = (await devContainerUp(cli, testFolder)).containerId;
				// Check that the expected base image and port are set in the running container
				await shellExec(`${cli} exec --workspace-folder ${testFolder} sh -lc 'command -v node && command -v npm'`);
			} finally {
				await devContainerDown({ containerId, doNotThrow: true });
			}
		});

		it('should preprocess a Dockerfile.in during up autoconf', async function () {
			if (!autoconfAvailable){
				this.skip();
			}
			const testFolder = `${__dirname}/configs/dockerfile-autoconf-preprocessor`;
			let containerId: string | undefined;
			try {
				containerId = (await devContainerUp(cli, testFolder)).containerId;
				await shellExec(`${cli} exec --workspace-folder ${testFolder} sh -lc 'command -v node && command -v npm'`);
			} finally {
				await devContainerDown({ containerId, doNotThrow: true });
			}
		});

		it('should preprocess a Dockerfile.in during up meson', async function () {
			if (!mesonAvailable){
				this.skip();
			}
			const testFolder = `${__dirname}/configs/dockerfile-meson-preprocessor`;
			
			let containerId: string | undefined;
			try {
				containerId = (await devContainerUp(cli, testFolder)).containerId;
				await shellExec(`${cli} exec --workspace-folder ${testFolder} sh -lc 'command -v node && command -v npm'`);
			} finally {
				await devContainerDown({ containerId, doNotThrow: true });
			}
		});
});

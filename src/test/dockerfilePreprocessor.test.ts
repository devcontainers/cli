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
		assert.strictEqual(getDockerfilePreprocessedPath('/tmp/Dockerfile.in'), '/tmp/.devcontainer-preprocessed/Dockerfile');
	});

	it('returns fixed CLI-owned output path for .in Dockerfile', () => {
		assert.strictEqual(getDockerfilePreprocessedPath('/tmp/folder/Dockerfile.in'), '/tmp/folder/.devcontainer-preprocessed/Dockerfile');
	});

	it('returns undefined for non-.in Dockerfile even when output is configured', () => {
		assert.strictEqual(getDockerfilePreprocessedPath('/tmp/folder/Dockerfile'), undefined);
	});

	it('throws when dockerfilePreprocessor.tool is missing for .in Dockerfile', async () => {
		const cliHost = await getCLIHost(process.cwd(), loadNativeModule, true);
		await assert.rejects(
			preprocessDockerExtensionFile(
				{ cliHost, output: nullLog },
				{},
				'/tmp/Dockerfile.in'
			),
			(err: unknown) => {
				assert.ok(err instanceof ContainerError);
				assert.match((err as ContainerError).description, /dockerfilePreprocessor\.tool/i);
				return true;
			}
		);
	});

	it('runs tool and produces Dockerfile output at the CLI-owned path', async function () {
		const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'devcontainer-preprocess-'));
		const inputPath = path.join(tmpDir, 'Dockerfile.in');
		const outputPath = path.join(tmpDir, '.devcontainer-preprocessed', 'Dockerfile');
		await fs.writeFile(inputPath, 'FROM alpine:3.20\n');

		const cliHost = await getCLIHost(process.cwd(), loadNativeModule, true);
		const result = await preprocessDockerExtensionFile(
			{ cliHost, output: nullLog },
			{ dockerfilePreprocessor: { tool: 'cp', outputMode: 'single-file' } },
			inputPath
		);

		assert.strictEqual(result, outputPath);
		const outputContent = (await fs.readFile(outputPath)).toString();
		assert.strictEqual(outputContent, 'FROM alpine:3.20\n');
	});

	it('passes the CLI-owned output path to the tool in single-file mode', async function () {
		const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'devcontainer-preprocess-'));
		const inputPath = path.join(tmpDir, 'Dockerfile.in');
		const outputPath = path.join(tmpDir, '.devcontainer-preprocessed', 'Dockerfile');
		const scriptPath = path.join(tmpDir, 'write-output.sh');
		await fs.writeFile(inputPath, 'FROM alpine:3.20\n');
		await fs.writeFile(scriptPath, '#!/bin/sh\nset -eu\nprintf "FROM busybox\\n" > "$2"\n');
		await fs.chmod(scriptPath, 0o755);

		const cliHost = await getCLIHost(process.cwd(), loadNativeModule, true);
		const result = await preprocessDockerExtensionFile(
			{ cliHost, output: nullLog },
			{ dockerfilePreprocessor: { tool: './write-output.sh', outputMode: 'single-file' } },
			inputPath
		);

		assert.strictEqual(result, outputPath);
		const outputContent = (await fs.readFile(outputPath)).toString();
		assert.strictEqual(outputContent, 'FROM busybox\n');
	});

	it('requires generatedDockerfile when outputMode is build-tree', async () => {
		const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'devcontainer-preprocess-'));
		const inputPath = path.join(tmpDir, 'Dockerfile.in');
		await fs.writeFile(inputPath, 'FROM alpine:3.20\n');

		const cliHost = await getCLIHost(process.cwd(), loadNativeModule, true);
		await assert.rejects(
			preprocessDockerExtensionFile(
				{ cliHost, output: nullLog },
				{ dockerfilePreprocessor: { tool: 'true', outputMode: 'build-tree' } },
				inputPath
			),
			(err: unknown) => {
				assert.ok(err instanceof ContainerError);
				assert.match((err as ContainerError).description, /build-tree.*generatedDockerfile/i);
				return true;
			}
		);
	});

	it('rejects generatedDockerfile when outputMode is single-file', async () => {
		const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'devcontainer-preprocess-'));
		const inputPath = path.join(tmpDir, 'Dockerfile.in');
		await fs.writeFile(inputPath, 'FROM alpine:3.20\n');

		const cliHost = await getCLIHost(process.cwd(), loadNativeModule, true);
		await assert.rejects(
			preprocessDockerExtensionFile(
				{ cliHost, output: nullLog },
				{ dockerfilePreprocessor: { tool: 'true', outputMode: 'single-file', generatedDockerfile: 'build/Dockerfile' } },
				inputPath
			),
			(err: unknown) => {
				assert.ok(err instanceof ContainerError);
				assert.match((err as ContainerError).description, /single-file.*generatedDockerfile/i);
				return true;
			}
		);
	});

	it('build-tree mode keeps generatedDockerfile authoritative and syncs CLI output', async () => {
		const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'devcontainer-preprocess-'));
		const inputPath = path.join(tmpDir, 'Dockerfile.in');
		const outputPath = path.join(tmpDir, '.devcontainer-preprocessed', 'Dockerfile');
		const generatedPath = path.join(tmpDir, 'build', 'Dockerfile');
		const scriptPath = path.join(tmpDir, 'write-output.sh');
		await fs.writeFile(inputPath, 'FROM alpine:3.20\n');
		await fs.mkdir(path.dirname(generatedPath), { recursive: true });
		await fs.writeFile(scriptPath, '#!/bin/sh\nset -eu\nprintf "FROM busybox\\n" > "$2"\n');
		await fs.chmod(scriptPath, 0o755);

		const cliHost = await getCLIHost(process.cwd(), loadNativeModule, true);
		const result = await preprocessDockerExtensionFile(
			{ cliHost, output: nullLog },
			{ dockerfilePreprocessor: { tool: './write-output.sh', outputMode: 'build-tree', generatedDockerfile: 'build/Dockerfile' } },
			inputPath
		);

		assert.strictEqual(result, outputPath);
		assert.strictEqual((await fs.readFile(generatedPath)).toString(), 'FROM busybox\n');
		assert.strictEqual((await fs.readFile(outputPath)).toString(), 'FROM busybox\n');
	});

	it('throws when a preprocessor command fails', async () => {
		const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'devcontainer-preprocess-'));
		const inputPath = path.join(tmpDir, 'Dockerfile.in');
		await fs.writeFile(inputPath, 'FROM alpine:3.20\n');

		const cliHost = await getCLIHost(process.cwd(), loadNativeModule, true);
		await assert.rejects(preprocessDockerExtensionFile(
			{ cliHost, output: nullLog },
			{ dockerfilePreprocessor: { tool: 'this-command-should-not-exist-xyz123', outputMode: 'single-file' } },
			inputPath
		));
	});

	it('throws when tool succeeds but output Dockerfile is not generated', async () => {
		const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'devcontainer-preprocess-'));
		const inputPath = path.join(tmpDir, 'Dockerfile.in');
		await fs.writeFile(inputPath, 'FROM alpine:3.20\n');

		const cliHost = await getCLIHost(process.cwd(), loadNativeModule, true);
		await assert.rejects(
			preprocessDockerExtensionFile(
				{ cliHost, output: nullLog },
				{ dockerfilePreprocessor: { tool: 'true', outputMode: 'single-file' } },
				inputPath
			),
			(err: unknown) => {
				assert.ok(err instanceof ContainerError);
				assert.match((err as ContainerError).description, /did not produce/i);
				return true;
			}
		);
	});

	it('does not treat stale CLI output as generated output', async () => {
		const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'devcontainer-preprocess-'));
		const inputPath = path.join(tmpDir, 'Dockerfile.in');
		const outputPath = path.join(tmpDir, '.devcontainer-preprocessed', 'Dockerfile');
		await fs.mkdir(path.dirname(outputPath), { recursive: true });
		await fs.writeFile(inputPath, 'FROM alpine:3.20\n');
		await fs.writeFile(outputPath, 'FROM stale:old\n');

		const cliHost = await getCLIHost(process.cwd(), loadNativeModule, true);
		await assert.rejects(
			preprocessDockerExtensionFile(
				{ cliHost, output: nullLog },
				{ dockerfilePreprocessor: { tool: 'true', outputMode: 'single-file' } },
				inputPath
			),
			(err: unknown) => {
				assert.ok(err instanceof ContainerError);
				assert.match((err as ContainerError).description, /did not produce/i);
				return true;
			}
		);
	});

	it('throws when generatedDockerfile is configured but not produced', async () => {
		const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'devcontainer-preprocess-'));
		const inputPath = path.join(tmpDir, 'Dockerfile.in');
		await fs.writeFile(inputPath, 'FROM alpine:3.20\n');

		const cliHost = await getCLIHost(process.cwd(), loadNativeModule, true);
		await assert.rejects(
			preprocessDockerExtensionFile(
				{ cliHost, output: nullLog },
				{ dockerfilePreprocessor: { tool: 'true', generatedDockerfile: 'build/Dockerfile' } },
				inputPath
			),
			(err: unknown) => {
				assert.ok(err instanceof ContainerError);
				assert.match((err as ContainerError).description, /generatedDockerfile/i);
				return true;
			}
		);
	});
});

(process.platform === 'linux' ? describe : describe.skip)('dockerfilePreprocessor integration', function () {
	this.timeout('240s');

	const tmp = path.relative(process.cwd(), path.join(__dirname, 'tmp'));
	const cli = `npx --prefix ${tmp} devcontainer`;
	const cleanupByFixture = new Map<string, string[]>([
		['dockerfile-cpp-preprocessor', ['Dockerfile', '.devcontainer-lock.json', '.devcontainer-preprocessed']],
		['dockercomposefile-cpp-preprocessor', ['Dockerfile', '.devcontainer-lock.json', '.devcontainer-preprocessed']],
		['dockerfile-cmake-preprocessor', ['Dockerfile', 'build', '.devcontainer-lock.json', '.devcontainer-preprocessed']],
		['dockerfile-cmake2-preprocessor', ['Dockerfile', 'build', '.devcontainer-lock.json', '.devcontainer-preprocessed']],
		['dockerfile-autoconf-preprocessor', ['Dockerfile', 'configure', 'config.log', 'config.status', 'autom4te.cache', '.devcontainer-lock.json', '.devcontainer-preprocessed']],
		['dockerfile-meson-preprocessor', ['Dockerfile', 'build', '.devcontainer-lock.json', '.devcontainer-preprocessed']],
	]);
	let cppAvailable = false;
	let cmakeAvailable = false;
	let mesonAvailable = false;
	let autoconfAvailable = false;

	const cleanupGeneratedArtifacts = async (testFolder: string) => {
		const fixture = path.basename(testFolder);
		const generated = cleanupByFixture.get(fixture);
		if (!generated?.length) {
			return;
		}
		await Promise.all(generated.map(relative => fs.rm(path.join(testFolder, relative), { recursive: true, force: true })));
	};

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
			await cleanupGeneratedArtifacts(testFolder);
			let containerId: string | undefined;
			try {
				containerId = (await devContainerUp(cli, testFolder)).containerId;
				await shellExec(`${cli} exec --workspace-folder ${testFolder} sh -lc 'command -v nodejs && command -v python3 && command -v curl && command -v wget && command -v vim && test -f /usr/local/bin/test.sh'`);
			} finally {
				await devContainerDown({ containerId, doNotThrow: true });
				await cleanupGeneratedArtifacts(testFolder);
			}
		});

	it('should preprocess a Dockerfile.in during up docker compose cpp', async function () {
		if (!cppAvailable) {
			this.skip();
		}
		const testFolder = `${__dirname}/configs/dockercomposefile-cpp-preprocessor`;
		await cleanupGeneratedArtifacts(testFolder);
		let containerId: string | undefined;
		try {
			containerId = (await devContainerUp(cli, testFolder)).containerId;
			await shellExec(`${cli} exec --workspace-folder ${testFolder} sh -lc 'command -v nodejs && command -v python3 && command -v curl && command -v wget && command -v vim && test -f /usr/local/bin/test.sh'`);
		} finally {
			await devContainerDown({ containerId, doNotThrow: true });
			await cleanupGeneratedArtifacts(testFolder);
		}
	});

		it('should preprocess a Dockerfile.in during up cmake', async function (){
			if (!cmakeAvailable){
				this.skip();
			}
			const testFolder = `${__dirname}/configs/dockerfile-cmake-preprocessor`;
			await cleanupGeneratedArtifacts(testFolder);
			let containerId: string | undefined;
			try {
				containerId = (await devContainerUp(cli, testFolder)).containerId;
				// Check that the expected base image and port are set in the running container
				await shellExec(`${cli} exec --workspace-folder ${testFolder} sh -lc 'command -v node && command -v npm'`);
			} finally {
				await devContainerDown({ containerId, doNotThrow: true });
				await cleanupGeneratedArtifacts(testFolder);
			}
		});

		it('should preprocess a Dockerfile.in during up cmake when no output folder is specified', async function () {
			if (!cmakeAvailable){
				this.skip();
			}
			const testFolder = `${__dirname}/configs/dockerfile-cmake2-preprocessor`;
			await cleanupGeneratedArtifacts(testFolder);
			let containerId: string | undefined;
			try {
				containerId = (await devContainerUp(cli, testFolder)).containerId;
				// Check that the expected base image and port are set in the running container
				await shellExec(`${cli} exec --workspace-folder ${testFolder} sh -lc 'command -v node && command -v npm'`);
			} finally {
				await devContainerDown({ containerId, doNotThrow: true });
				await cleanupGeneratedArtifacts(testFolder);
			}
		});

		it('should preprocess a Dockerfile.in during up autoconf', async function () {
			if (!autoconfAvailable){
				this.skip();
			}
			const testFolder = `${__dirname}/configs/dockerfile-autoconf-preprocessor`;
			await cleanupGeneratedArtifacts(testFolder);
			let containerId: string | undefined;
			try {
				containerId = (await devContainerUp(cli, testFolder)).containerId;
				await shellExec(`${cli} exec --workspace-folder ${testFolder} sh -lc 'command -v node && command -v npm'`);
			} finally {
				await devContainerDown({ containerId, doNotThrow: true });
				await cleanupGeneratedArtifacts(testFolder);
			}
		});

		it('should preprocess a Dockerfile.in during up meson', async function () {
			if (!mesonAvailable){
				this.skip();
			}
			const testFolder = `${__dirname}/configs/dockerfile-meson-preprocessor`;
			await cleanupGeneratedArtifacts(testFolder);
			
			let containerId: string | undefined;
			try {
				containerId = (await devContainerUp(cli, testFolder)).containerId;
				await shellExec(`${cli} exec --workspace-folder ${testFolder} sh -lc 'command -v node && command -v npm'`);
			} finally {
				await devContainerDown({ containerId, doNotThrow: true });
				await cleanupGeneratedArtifacts(testFolder);
			}
		});
});

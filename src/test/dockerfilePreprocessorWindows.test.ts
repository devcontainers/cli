/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as fs from 'fs/promises';
import * as path from 'path';

import { getCLIHost, loadNativeModule } from '../spec-common/commonUtils';
import { preprocessDockerExtensionFile } from '../spec-node/dockerfilePreprocessor';
import { nullLog } from '../spec-utils/log';

(process.platform === 'win32' ? describe : describe.skip)('dockerfilePreprocessor unit (Windows)', function () {
	const fixtureFolder = path.join(__dirname, 'configs', 'dockerfile-clang-preprocessor');
	const inputPath = path.join(fixtureFolder, 'Dockerfile.in');
	const outputPath = path.join(fixtureFolder, '.devcontainer-preprocessed', 'Dockerfile');
	const generatedRelPath = path.join('build', 'Dockerfile.generated');
	const generatedAbsPath = path.join(fixtureFolder, generatedRelPath);
	const expectedSingleFileDockerfile = [
		'FROM mcr.microsoft.com/windows/nanoserver:ltsc2022',
		'SHELL ["powershell", "-NoLogo", "-NoProfile", "-Command"]',
		'RUN Write-Host "Installing Node.js"',
		'RUN Write-Host "Installing Python"',
		'RUN Write-Host "Installing curl and wget"',
		'ENV APP_ENV=development',
		'ENV APP_DEBUG=true',
		'RUN Write-Host "Installing vim"',
		'COPY ./test.ps1 C:/usr/local/bin/test.ps1',
		'',
	].join('\n');

	const cleanupGeneratedArtifacts = async () => {
		await Promise.all([
			fs.rm(outputPath, { recursive: true, force: true }),
			fs.rm(generatedAbsPath, { recursive: true, force: true }),
		]);
	};

	beforeEach(async () => {
		await cleanupGeneratedArtifacts();
	});

	afterEach(async () => {
		await cleanupGeneratedArtifacts();
	});


	it('runs preprocessor in single-file mode and writes CLI-owned output', async () => {
		const cliHost = await getCLIHost(process.cwd(), loadNativeModule, true);
		const result = await preprocessDockerExtensionFile(
			{ cliHost, output: nullLog },
			{
				dockerfilePreprocessor: {
					tool: process.execPath,
					args: ['-e', "const fs=require('fs');const path=require('path');const [input,output]=process.argv.slice(1);if(!input||!output){process.exit(1);}const root=path.dirname(input);const source=fs.readFileSync(input,'utf8');if(!source.includes('#define BASE_IMAGE mcr.microsoft.com/windows/nanoserver:ltsc2022')){process.exit(1);}const common=fs.readFileSync(path.join(root,'common.Dockerfile'),'utf8').trim();const tools=fs.readFileSync(path.join(root,'tools.Dockerfile'),'utf8').trim();const lines=['FROM mcr.microsoft.com/windows/nanoserver:ltsc2022','SHELL [\"powershell\", \"-NoLogo\", \"-NoProfile\", \"-Command\"]','RUN Write-Host \"Installing Node.js\"','RUN Write-Host \"Installing Python\"',common,tools,''];fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,lines.join('\\n'));"],
					outputMode: 'single-file',
				},
			},
			inputPath
		);

		assert.strictEqual(result, outputPath);
		assert.strictEqual(await fs.readFile(outputPath, 'utf8'), expectedSingleFileDockerfile);
	});

	it('promotes generatedDockerfile output into CLI-owned output path', async () => {
		const cliHost = await getCLIHost(process.cwd(), loadNativeModule, true);
		const result = await preprocessDockerExtensionFile(
			{ cliHost, output: nullLog },
			{
				dockerfilePreprocessor: {
					tool: process.execPath,
					args: ['-e', "const fs=require('fs');const path=require('path');const out=process.env.generated_dockerfile;if(!out){process.exit(1);}fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,'FROM mcr.microsoft.com/windows/nanoserver:ltsc2022\\n');"],
					generatedDockerfile: generatedRelPath,
				},
			},
			inputPath
		);

		assert.strictEqual(result, outputPath);
		assert.strictEqual(await fs.readFile(outputPath, 'utf8'), 'FROM mcr.microsoft.com/windows/nanoserver:ltsc2022\n');
		assert.strictEqual(await cliHost.isFile(generatedAbsPath), false);
	});
});

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs/promises';
import * as path from 'path';

import { devContainerDown, devContainerUp, shellExec } from './testUtils';

const pkg = require('../../package.json');

(process.platform === 'win32' ? describe : describe.skip)('dockerfilePreprocessor integration (Windows)', function () {
	this.timeout('240s');

	const tmp = path.relative(process.cwd(), path.join(__dirname, 'tmp'));
	const cli = `npx --prefix ${tmp} devcontainer`;
	const generatedArtifacts = ['Dockerfile', '.devcontainer-lock.json', '.devcontainer-preprocessed'];
	let clangAvailable = false;

	const cleanupGeneratedArtifacts = async (testFolder: string) => {
		await Promise.all(generatedArtifacts.map(relative => fs.rm(path.join(testFolder, relative), { recursive: true, force: true })));
	};

	before('Install', async () => {
		await fs.rm(path.join(__dirname, 'tmp', 'node_modules'), { recursive: true, force: true });
		await fs.mkdir(path.join(__dirname, 'tmp'), { recursive: true });
		await shellExec(`npm --prefix ${tmp} install devcontainers-cli-${pkg.version}.tgz`);
		const clangCheck = await shellExec('where clang', undefined, true, true);
		clangAvailable = !clangCheck.error && Boolean(clangCheck.stdout.trim());
	});

	it('should preprocess a Dockerfile.in during up clang on Windows', async function () {
		if (!clangAvailable) {
			this.skip();
		}
		const testFolder = `${__dirname}/configs/dockerfile-clang-preprocessor`;
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
});

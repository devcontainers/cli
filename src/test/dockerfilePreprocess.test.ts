/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { assert } from 'chai';
import * as fs from 'fs';
import * as path from 'path';
import { CLIHost } from '../spec-common/cliHost';
import { resolveDockerfileIncludesIfNeeded } from '../spec-node/dockerfilePreprocess';

function createMockCLIHost(files: Record<string, string>, platform: NodeJS.Platform = 'linux'): CLIHost {
	const pathModule = platform === 'win32' ? path.win32 : path.posix;
	return {
		type: 'local',
		platform,
		arch: 'x64',
		path: pathModule,
		cwd: platform === 'win32' ? 'C:\\' : '/',
		env: {},
		exec: () => { throw new Error('Not implemented'); },
		ptyExec: () => { throw new Error('Not implemented'); },
		homedir: async () => platform === 'win32' ? 'C:\\Users\\test' : '/home/test',
		tmpdir: async () => platform === 'win32' ? 'C:\\tmp' : '/tmp',
		isFile: async (filepath: string) => filepath in files,
		isFolder: async () => false,
		readFile: async (filepath: string) => {
			if (!(filepath in files)) {
				throw new Error(`File not found: ${filepath}`);
			}
			return Buffer.from(files[filepath]);
		},
		writeFile: async (filepath: string, content: Buffer) => {
			files[filepath] = content.toString();
		},
		rename: async () => { },
		mkdirp: async () => { },
		readDir: async () => [],
		getUsername: async () => 'test',
		toCommonURI: async () => undefined,
		connect: () => { throw new Error('Not implemented'); },
	};
}

describe('resolveDockerfileIncludesIfNeeded', () => {
	it('returns source Dockerfile unchanged when not using .in extension', async () => {
		const files: Record<string, string> = {
			'/workspace/Dockerfile': 'FROM debian:latest\nRUN echo ok',
		};
		const cliHost = createMockCLIHost(files);
		const result = await resolveDockerfileIncludesIfNeeded(cliHost, '/workspace/Dockerfile');
		assert.isFalse(result.preprocessed);
		assert.equal(result.effectiveDockerfilePath, '/workspace/Dockerfile');
		assert.equal(result.effectiveDockerfileContent, files['/workspace/Dockerfile']);
	});

	it('expands #include lines and writes a generated Dockerfile for .in files', async () => {
		const podmanTestConfigPath = path.resolve(__dirname, 'configs', 'podman-test');
		const sourceDockerfilePath = path.join(podmanTestConfigPath, 'cpp.Dockerfile.in');
		const includedDockerfilePath = path.join(podmanTestConfigPath, 'tools.Dockerfile');
		const sourceDockerfileContent = fs.readFileSync(sourceDockerfilePath).toString();
		const includedDockerfileContent = fs.readFileSync(includedDockerfilePath).toString();
		const files: Record<string, string> = {
			[sourceDockerfilePath]: sourceDockerfileContent,
			[includedDockerfilePath]: includedDockerfileContent,
		};
		const cliHost = createMockCLIHost(files);
		const result = await resolveDockerfileIncludesIfNeeded(cliHost, sourceDockerfilePath);
		assert.isTrue(result.preprocessed);
		assert.notEqual(result.effectiveDockerfilePath, sourceDockerfilePath);
		assert.include(result.effectiveDockerfilePath, '/tmp/devcontainercli-test/dockerfile-preprocess/');
		assert.equal(
			result.effectiveDockerfileContent,
			'FROM docker.io/debian:latest\nRUN apt-get update && apt-get install -y vim\nRUN apt-get update && apt-get install -y clang'
		);
		assert.equal(files[result.effectiveDockerfilePath], result.effectiveDockerfileContent);
	});

	it('fails with a clear error when #include has a cycle', async () => {
		const files: Record<string, string> = {
			'/workspace/a.Dockerfile.in': '#include "b.Dockerfile"\nRUN echo a',
			'/workspace/b.Dockerfile': '#include "a.Dockerfile.in"\nRUN echo b',
		};
		const cliHost = createMockCLIHost(files);
		let err: any;
		try {
			await resolveDockerfileIncludesIfNeeded(cliHost, '/workspace/a.Dockerfile.in');
		} catch (e) {
			err = e;
		}
		assert.ok(err);
		assert.include(String(err.message || err), 'Cyclic #include detected while preprocessing Dockerfile');
	});
});

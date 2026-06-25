/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { assert } from 'chai';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { CLIHost } from '../spec-common/cliHost';
import { materializeResolvedDockerfileForBuild, resolveDockerfileIncludesIfNeeded } from '../spec-node/dockerfilePreprocess';
import { getBuildInfoForService } from '../spec-node/dockerCompose';

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
		deleteFile: async (filepath: string) => {
			delete files[filepath];
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
		assert.equal(result.effectiveDockerfileContent, files['/workspace/Dockerfile']);
	});

	it('expands #include lines for .in files without writing a generated Dockerfile yet', async () => {
		const podmanTestConfigPath = path.resolve(__dirname, 'configs', 'podman-test');
		const sourceDockerfilePath = path.join(podmanTestConfigPath, 'Dockerfile.in');
		const commonDockerfilePath = path.join(podmanTestConfigPath, 'common.Dockerfile');
		const includedDockerfilePath = path.join(podmanTestConfigPath, 'tools.Dockerfile');
		const copiedFilePath = path.join(podmanTestConfigPath, 'bootstrap.sh');
		const sourceDockerfileContent = fs.readFileSync(sourceDockerfilePath).toString();
		const commonDockerfileContent = fs.readFileSync(commonDockerfilePath).toString();
		const includedDockerfileContent = fs.readFileSync(includedDockerfilePath).toString();
		const copiedFileContent = fs.readFileSync(copiedFilePath).toString();
		const files: Record<string, string> = {
			[sourceDockerfilePath]: sourceDockerfileContent,
			[commonDockerfilePath]: commonDockerfileContent,
			[includedDockerfilePath]: includedDockerfileContent,
			[copiedFilePath]: copiedFileContent,
		};
		const cliHost = createMockCLIHost(files);
		const result = await resolveDockerfileIncludesIfNeeded(cliHost, sourceDockerfilePath);
		assert.isTrue(result.preprocessed);
		assert.equal(
			result.effectiveDockerfileContent,
			'\nFROM ubuntu:20.04\n\nRUN apt-get update && apt-get install -y nodejs\n\nRUN apt-get update && apt-get install -y python3\n\nRUN apt-get update && apt-get install -y curl wget\n\nENV APP_ENV=development\nENV APP_DEBUG=true\nRUN apt-get update && apt-get install -y vim\nCOPY ./bootstrap.sh /usr/local/bin/bootstrap.sh'
		);
		assert.deepEqual(Object.keys(files).sort(), [sourceDockerfilePath, commonDockerfilePath, includedDockerfilePath, copiedFilePath].sort());
	});

	it('materializes a preprocessed Dockerfile in the source directory and cleans it up', async () => {
		const files: Record<string, string> = {
			'/workspace/.devcontainer/Dockerfile.in': [
				'FROM docker.io/debian:latest',
				'#include "scripts.Dockerfile"',
			].join('\n'),
			'/workspace/.devcontainer/scripts.Dockerfile': [
				'RUN echo preparing scripts',
				'COPY ./bootstrap.sh /usr/local/bin/bootstrap.sh',
			].join('\n'),
			'/workspace/.devcontainer/bootstrap.sh': '#!/bin/sh\necho bootstrap',
		};
		const cliHost = createMockCLIHost(files);
		const result = await resolveDockerfileIncludesIfNeeded(cliHost, '/workspace/.devcontainer/Dockerfile.in');
		const materialized = await materializeResolvedDockerfileForBuild(cliHost, result);

		assert.isTrue(result.preprocessed);
		assert.equal(path.dirname(materialized.dockerfilePath), '/workspace/.devcontainer');
		assert.include(result.effectiveDockerfileContent, 'RUN echo preparing scripts');
		assert.include(result.effectiveDockerfileContent, 'COPY ./bootstrap.sh /usr/local/bin/bootstrap.sh');
		assert.equal(files[materialized.dockerfilePath], result.effectiveDockerfileContent);
		await materialized.dispose();
		assert.notProperty(files, materialized.dockerfilePath);
	});

	it('materializes compose-referenced preprocessed Dockerfiles beside the original Dockerfile to preserve relative COPY paths', async () => {
		const composeFixturePath = path.resolve(__dirname, 'configs', 'podman-preprocess-compose-test');
		const composeFilePath = path.join(composeFixturePath, '.devcontainer', 'docker-compose.yml');
		const dockerfilePath = path.join(composeFixturePath, '.devcontainer', 'Dockerfile.in');
		const commonDockerfilePath = path.join(composeFixturePath, '.devcontainer', 'common.Dockerfile');
		const toolsDockerfilePath = path.join(composeFixturePath, '.devcontainer', 'tools.Dockerfile');
		const copiedFilePath = path.join(composeFixturePath, '.devcontainer', 'bootstrap.sh');
		const composeContent = fs.readFileSync(composeFilePath, 'utf8');
		const files: Record<string, string> = {
			[composeFilePath]: composeContent,
			[dockerfilePath]: fs.readFileSync(dockerfilePath, 'utf8'),
			[commonDockerfilePath]: fs.readFileSync(commonDockerfilePath, 'utf8'),
			[toolsDockerfilePath]: fs.readFileSync(toolsDockerfilePath, 'utf8'),
			[copiedFilePath]: fs.readFileSync(copiedFilePath, 'utf8'),
		};
		const cliHost = createMockCLIHost(files);
		const composeConfig = yaml.load(composeContent) as any;
		const serviceInfo = getBuildInfoForService(composeConfig.services.app, cliHost.path, [composeFilePath]);

		assert.isDefined(serviceInfo.build);
		serviceInfo.build!.context = cliHost.path.resolve(path.dirname(composeFilePath), serviceInfo.build!.context);
		const resolvedDockerfilePath = cliHost.path.isAbsolute(serviceInfo.build!.dockerfilePath)
			? serviceInfo.build!.dockerfilePath
			: cliHost.path.resolve(serviceInfo.build!.context, serviceInfo.build!.dockerfilePath);
		const resolvedDockerfile = await resolveDockerfileIncludesIfNeeded(cliHost, resolvedDockerfilePath);
		const materialized = await materializeResolvedDockerfileForBuild(cliHost, resolvedDockerfile);

		assert.equal(resolvedDockerfilePath, dockerfilePath);
		assert.equal(path.dirname(materialized.dockerfilePath), path.dirname(dockerfilePath));
		assert.include(files[materialized.dockerfilePath], 'COPY ./bootstrap.sh /usr/local/bin/bootstrap.sh');
		assert.equal(path.resolve(path.dirname(materialized.dockerfilePath), 'bootstrap.sh'), copiedFilePath);

		await materialized.dispose();
		assert.notProperty(files, materialized.dockerfilePath);
	});

	it('expands includes for podman-preprocess-without feature without writing a generated Dockerfile yet', async () => {
		const fixturePath = path.resolve(__dirname, 'configs', 'podman-preprocess-without feature');
		const sourceDockerfilePath = path.join(fixturePath, 'Dockerfile.in');
		const commonDockerfilePath = path.join(fixturePath, 'common.Dockerfile');
		const toolsDockerfilePath = path.join(fixturePath, 'tools.Dockerfile');
		const copiedFilePath = path.join(fixturePath, 'bootstrap.sh');
		const files: Record<string, string> = {
			[sourceDockerfilePath]: fs.readFileSync(sourceDockerfilePath, 'utf8'),
			[commonDockerfilePath]: fs.readFileSync(commonDockerfilePath, 'utf8'),
			[toolsDockerfilePath]: fs.readFileSync(toolsDockerfilePath, 'utf8'),
			[copiedFilePath]: fs.readFileSync(copiedFilePath, 'utf8'),
		};
		const cliHost = createMockCLIHost(files);

		const result = await resolveDockerfileIncludesIfNeeded(cliHost, sourceDockerfilePath);

		assert.isTrue(result.preprocessed);
		assert.include(result.effectiveDockerfileContent, 'FROM debian:bookworm-slim');
		assert.include(result.effectiveDockerfileContent, 'RUN apt-get update && apt-get install -y curl wget');
		assert.include(result.effectiveDockerfileContent, 'COPY ./bootstrap.sh /usr/local/bin/bootstrap.sh');
		assert.deepEqual(Object.keys(files).sort(), [sourceDockerfilePath, commonDockerfilePath, toolsDockerfilePath, copiedFilePath].sort());
	});

	it('materializes podman-preprocess-without feature beside the original Dockerfile so relative COPY keeps working', async () => {
		const fixturePath = path.resolve(__dirname, 'configs', 'podman-preprocess-without feature');
		const sourceDockerfilePath = path.join(fixturePath, 'Dockerfile.in');
		const commonDockerfilePath = path.join(fixturePath, 'common.Dockerfile');
		const toolsDockerfilePath = path.join(fixturePath, 'tools.Dockerfile');
		const copiedFilePath = path.join(fixturePath, 'bootstrap.sh');
		const files: Record<string, string> = {
			[sourceDockerfilePath]: fs.readFileSync(sourceDockerfilePath, 'utf8'),
			[commonDockerfilePath]: fs.readFileSync(commonDockerfilePath, 'utf8'),
			[toolsDockerfilePath]: fs.readFileSync(toolsDockerfilePath, 'utf8'),
			[copiedFilePath]: fs.readFileSync(copiedFilePath, 'utf8'),
		};
		const cliHost = createMockCLIHost(files);

		const resolvedDockerfile = await resolveDockerfileIncludesIfNeeded(cliHost, sourceDockerfilePath);
		const materialized = await materializeResolvedDockerfileForBuild(cliHost, resolvedDockerfile);

		assert.equal(path.dirname(materialized.dockerfilePath), fixturePath);
		assert.include(files[materialized.dockerfilePath], 'COPY ./bootstrap.sh /usr/local/bin/bootstrap.sh');
		assert.equal(path.resolve(path.dirname(materialized.dockerfilePath), 'bootstrap.sh'), copiedFilePath);

		await materialized.dispose();
		assert.notProperty(files, materialized.dockerfilePath);
		assert.property(files, copiedFilePath);
	});

	it('returns the original Dockerfile path when materialization is unnecessary', async () => {
		const files: Record<string, string> = {
			'/workspace/Dockerfile': 'FROM debian:latest\nRUN echo ok',
		};
		const cliHost = createMockCLIHost(files);
		const result = await resolveDockerfileIncludesIfNeeded(cliHost, '/workspace/Dockerfile');
		const materialized = await materializeResolvedDockerfileForBuild(cliHost, result);

		assert.equal(materialized.dockerfilePath, '/workspace/Dockerfile');
		await materialized.dispose();
		assert.equal(files['/workspace/Dockerfile'], 'FROM debian:latest\nRUN echo ok');
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

	it('supports #define/#undef with conditionals and #warning', async () => {
		const files: Record<string, string> = {
			'/workspace/Dockerfile.in': [
				'#define BASE_IMAGE docker.io/debian:bookworm',
				'#if defined(BASE_IMAGE)',
				'FROM BASE_IMAGE',
				'#else',
				'#error BASE_IMAGE must be defined',
				'#endif',
				'#warning Using BASE_IMAGE',
				'#undef BASE_IMAGE',
				'#ifndef BASE_IMAGE',
				'RUN echo fallback-ok',
				'#endif',
			].join('\n'),
		};
		const cliHost = createMockCLIHost(files);
		const result = await resolveDockerfileIncludesIfNeeded(cliHost, '/workspace/Dockerfile.in');

		assert.isTrue(result.preprocessed);
		assert.include(result.effectiveDockerfileContent, 'FROM docker.io/debian:bookworm');
		assert.include(result.effectiveDockerfileContent, '# warning: Using docker.io/debian:bookworm');
		assert.include(result.effectiveDockerfileContent, 'RUN echo fallback-ok');
	});

	it('fails with a clear error when preprocessed output has no resolved FROM', async () => {
		const files: Record<string, string> = {
			'/workspace/Dockerfile.in': '#if 0\nFROM docker.io/debian:latest\n#endif\nRUN echo missing-from',
		};
		const cliHost = createMockCLIHost(files);
		let err: any;
		try {
			await resolveDockerfileIncludesIfNeeded(cliHost, '/workspace/Dockerfile.in');
		} catch (e) {
			err = e;
		}

		assert.ok(err);
		assert.include(String(err.message || err), 'contains no resolved FROM instruction');
	});
});

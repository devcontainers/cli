/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { CLIVariant } from '../spec-shutdown/dockerUtils';
import { CLIHost } from '../spec-common/cliHost';
import { DockerResolverParameters } from '../spec-node/utils';
import { isBakeableUidGid, shouldFallbackToKeepId, resolveUpdateRemoteUserUID } from '../spec-node/containerFeatures';

function makeCliHost(overrides: Partial<CLIHost> = {}): CLIHost {
	return {
		type: 'local',
		platform: 'linux',
		arch: 'x64',
		exec: async () => { throw new Error('not implemented'); },
		ptyExec: async () => { throw new Error('not implemented'); },
		cwd: '/',
		env: {},
		path: require('path').posix,
		homedir: async () => '/home/user',
		tmpdir: async () => '/tmp',
		isFile: async () => false,
		isFolder: async () => false,
		readFile: async () => Buffer.alloc(0),
		writeFile: async () => { },
		rename: async () => { },
		mkdirp: async () => { },
		readDir: async () => [],
		getUsername: async () => 'user',
		getuid: async () => 1000,
		getgid: async () => 1000,
		toCommonURI: async () => undefined,
		connect: () => { throw new Error('not implemented'); },
		...overrides,
	};
}

function makeParams(overrides: Partial<DockerResolverParameters> = {}): DockerResolverParameters {
	return {
		common: {
			prebuild: false,
			computeExtensionHostEnv: false,
			package: { version: '0.0.0' } as any,
			containerDataFolder: undefined,
			containerSystemDataFolder: undefined,
			appRoot: undefined,
			extensionPath: '/ext',
			sessionId: 'session',
			sessionStart: new Date(),
			cliHost: makeCliHost(),
			env: {},
			cwd: '/',
			isLocalContainer: true,
			dotfilesConfiguration: {} as any,
			progress: () => { },
			output: { write: () => { }, raw: () => { }, start: () => 0, stop: () => { }, event: () => { } } as any,
			allowSystemConfigChange: false,
			defaultUserEnvProbe: {} as any,
			lifecycleHook: {} as any,
			getLogLevel: () => 0 as any,
			onDidChangeLogLevel: () => () => { },
			loadNativeModule: async () => undefined,
			allowInheritTTY: false,
			shutdowns: [],
			backgroundTasks: [],
			persistedFolder: '/tmp',
			remoteEnv: {},
		} as any,
		parsedAuthority: undefined,
		dockerCLI: 'docker',
		cliVariant: CLIVariant.Podman,
		dockerComposeCLI: async () => { throw new Error('not implemented'); },
		dockerEnv: {},
		workspaceMountConsistencyDefault: 'cached',
		gpuAvailability: 'detect',
		mountWorkspaceGitRoot: false,
		mountGitWorktreeCommonDir: false,
		updateRemoteUserUIDOnMacOS: false,
		cacheMount: 'bind',
		userRepositoryConfigurationPaths: [],
		additionalMounts: [],
		updateRemoteUserUIDDefault: 'on',
		additionalCacheFroms: [],
		buildKitVersion: undefined,
		dockerEngineVersion: undefined,
		buildxPlatform: undefined,
		buildxPush: false,
		additionalLabels: [],
		buildxOutput: undefined,
		buildxCacheTo: undefined,
		buildPlatformInfo: {} as any,
		targetPlatformInfo: {} as any,
		isTTY: false,
		...overrides,
	};
}

describe('isBakeableUidGid', function () {
	it('should return true for uid/gid within the subuid range', () => {
		assert.strictEqual(isBakeableUidGid(1000, 1000), true);
		assert.strictEqual(isBakeableUidGid(65536, 65536), true);
	});

	it('should return false when the uid exceeds the subuid range', () => {
		assert.strictEqual(isBakeableUidGid(1400601154, 1000), false);
	});

	it('should return false when the gid exceeds the subuid range', () => {
		assert.strictEqual(isBakeableUidGid(1000, 1400601513), false);
	});

	it('should return false when both exceed the subuid range', () => {
		assert.strictEqual(isBakeableUidGid(1400601154, 1400601513), false);
	});
});

describe('shouldFallbackToKeepId', function () {
	it('should fall back for rootless podman with a non-bakeable host uid', async () => {
		const params = makeParams();
		params.common.cliHost = makeCliHost({ getuid: async () => 1400601154, getgid: async () => 1400601513 });
		assert.strictEqual(await shouldFallbackToKeepId(params, {} as any, params.common.cliHost), true);
	});

	it('should not fall back when the host uid is bakeable', async () => {
		const params = makeParams();
		params.common.cliHost = makeCliHost({ getuid: async () => 1000, getgid: async () => 1000 });
		assert.strictEqual(await shouldFallbackToKeepId(params, {} as any, params.common.cliHost), false);
	});

	it('should not fall back for docker (non-podman)', async () => {
		const params = makeParams({ cliVariant: CLIVariant.Docker });
		params.common.cliHost = makeCliHost({ getuid: async () => 1400601154, getgid: async () => 1400601513 });
		assert.strictEqual(await shouldFallbackToKeepId(params, {} as any, params.common.cliHost), false);
	});

	it('should not fall back on a non-linux platform', async () => {
		const params = makeParams();
		params.common.cliHost = makeCliHost({ platform: 'darwin', getuid: async () => 1400601154, getgid: async () => 1400601513 });
		assert.strictEqual(await shouldFallbackToKeepId(params, {} as any, params.common.cliHost), false);
	});

	it('should not fall back when the user explicitly set updateRemoteUserUID', async () => {
		const params = makeParams();
		params.common.cliHost = makeCliHost({ getuid: async () => 1400601154, getgid: async () => 1400601513 });
		assert.strictEqual(await shouldFallbackToKeepId(params, { updateRemoteUserUID: true } as any, params.common.cliHost), false);
		assert.strictEqual(await shouldFallbackToKeepId(params, { updateRemoteUserUID: false } as any, params.common.cliHost), false);
	});

	it('should not fall back when the default is not "on"', async () => {
		const params = makeParams({ updateRemoteUserUIDDefault: 'never' });
		params.common.cliHost = makeCliHost({ getuid: async () => 1400601154, getgid: async () => 1400601513 });
		assert.strictEqual(await shouldFallbackToKeepId(params, {} as any, params.common.cliHost), false);
	});

	it('should not fall back when getuid/getgid are unavailable', async () => {
		const params = makeParams();
		params.common.cliHost = makeCliHost({ getuid: undefined, getgid: undefined });
		assert.strictEqual(await shouldFallbackToKeepId(params, {} as any, params.common.cliHost), false);
	});
});

describe('resolveUpdateRemoteUserUID', function () {
	it('should return false (disable bake) when the fallback applies', async () => {
		const params = makeParams();
		params.common.cliHost = makeCliHost({ getuid: async () => 1400601154, getgid: async () => 1400601513 });
		assert.strictEqual(await resolveUpdateRemoteUserUID(params, {} as any, params.common.cliHost), false);
	});

	it('should return undefined when the host uid is bakeable', async () => {
		const params = makeParams();
		params.common.cliHost = makeCliHost({ getuid: async () => 1000, getgid: async () => 1000 });
		assert.strictEqual(await resolveUpdateRemoteUserUID(params, {} as any, params.common.cliHost), undefined);
	});

	it('should return undefined when the user explicitly configured updateRemoteUserUID', async () => {
		const params = makeParams();
		params.common.cliHost = makeCliHost({ getuid: async () => 1400601154, getgid: async () => 1400601513 });
		assert.strictEqual(await resolveUpdateRemoteUserUID(params, { updateRemoteUserUID: true } as any, params.common.cliHost), undefined);
	});
});

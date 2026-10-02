/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createPlainLog, LogLevel, makeLog, nullLog } from '../spec-utils/log';
import { inspectImageInRegistry, qualifyImageName } from '../spec-node/utils';
import assert from 'assert';
import { CLIVariant, DockerCLIParameters, dockerBuildKitVersion, dockerCLI, dockerEngineVersion, dockerExecFunction, dockerPtyCLI, dockerPtyExecFunction, getEvents, inspectContainer, inspectImage, listContainers, lookupCLIVariant, PartialExecParameters, removeContainer, toExecParameters, toPtyExecParameters } from '../spec-shutdown/dockerUtils';
import { CLIHost, ExecFunction, ExecParameters, PtyExecFunction } from '../spec-common/commonUtils';
import { PassThrough } from 'stream';
import { dockerComposeCLIConfig } from '../spec-node/dockerCompose';
import { execFileSync } from 'child_process';
import * as path from 'path';
import { createDockerParams } from '../spec-node/devContainers';
import { staticProvisionParams } from '../spec-node/featuresCLI/utils';
import { createCLIParams } from './testUtils';

export const output = makeLog(createPlainLog(text => process.stdout.write(text), () => LogLevel.Trace));

describe('Docker utils', function () {
	this.timeout(20 * 1000);

	it('inspect image in docker.io', async () => {
		const imageName = 'docker.io/library/ubuntu:latest';
		const config = await inspectImageInRegistry(output, { arch: 'amd64', os: 'linux' }, imageName);
		assert.ok(config);
		assert.ok(config.Id);
		assert.ok(config.Config.Cmd);
	});

	it('inspect image in mcr.microsoft.com', async () => {
		const imageName = 'mcr.microsoft.com/devcontainers/rust:1';
		const config = await inspectImageInRegistry(output, { arch: 'amd64', os: 'linux' }, imageName);
		assert.ok(config);
		assert.ok(config.Id);
		assert.ok(config.Config.Cmd);
		const metadataStr = config.Config.Labels?.['devcontainer.metadata'];
		assert.ok(metadataStr);
		const obj = JSON.parse(metadataStr);
		assert.ok(obj && typeof obj === 'object');
	});

	it('inspect image in ghcr.io', async () => {
		const imageName = 'ghcr.io/chrmarti/cache-from-test/images/test-cache:latest';
		const config = await inspectImageInRegistry(output, { arch: 'amd64', os: 'linux' }, imageName);
		assert.ok(config);
		assert.ok(config.Id);
		assert.ok(config.Config.Cmd);
	});

	it('qualifies docker.io shorthands', async () => {
		assert.strictEqual(qualifyImageName('ubuntu'), 'docker.io/library/ubuntu');
		assert.strictEqual(qualifyImageName('docker.io/ubuntu'), 'docker.io/library/ubuntu');
		assert.strictEqual(qualifyImageName('random/image'), 'docker.io/random/image');
		assert.strictEqual(qualifyImageName('foo/random/image'), 'foo/random/image');
	});

	it('protects against concurrent removal', async () => {
		const params = await createCLIParams(__dirname);
		const verboseParams = { ...toExecParameters(params), output: makeLog(output, LogLevel.Info), print: 'continuous' as 'continuous' };
		const { stdout } = await dockerCLI(verboseParams, 'run', '-d', 'ubuntu:latest', 'sleep', 'inf');
		const containerId = stdout.toString().trim();
		const start = Date.now();
		await Promise.all([
			testRemoveContainer(verboseParams, containerId),
			testRemoveContainer(verboseParams, containerId),
			testRemoveContainer(verboseParams, containerId),
		]);
		console.log('removal took', Date.now() - start, 'ms');
	});
});

describe('Container inspect', () => {
	const bindings = { '8080/tcp': [{ HostIp: '127.0.0.1', HostPort: '18080' }] };
	const container = {
		Id: 'container', Created: '2026-09-11T00:00:00Z', Name: '/container',
		State: { Status: 'running', StartedAt: '', FinishedAt: '' },
		Config: { Image: 'image', User: 'root', Env: ['PATH=/usr/bin'], Labels: { project: 'demo' } },
		Mounts: [{ Type: 'bind', Source: '/workspace', Destination: '/workspaces/demo' }],
		NetworkSettings: { Networks: { bridge: { IPAddress: '172.17.0.2' } } },
	};

	function inspectParams(results: object[]): PartialExecParameters {
		return {
			cmd: 'runtime', env: {}, output: nullLog,
			exec: async () => {
				const stdout = new PassThrough();
				const stderr = new PassThrough();
				return {
					stdin: new PassThrough(), stdout, stderr,
					exit: new Promise(resolve => setImmediate(() => {
						stdout.end(Buffer.from(JSON.stringify(results)));
						stderr.end();
						resolve({ code: 0, signal: null });
					})),
					terminate: async () => {},
				};
			},
		};
	}

	it('preserves Docker nested port flattening', async () => {
		const raw = { ...container, NetworkSettings: { ...container.NetworkSettings, Ports: bindings } };
		assert.deepStrictEqual(await inspectContainer(inspectParams([raw]), container.Id), {
			...raw, Ports: [{ IP: '127.0.0.1', PrivatePort: 8080, PublicPort: 18080, Type: 'tcp' }],
		});
	});

	it('preserves WSLC metadata without nested ports and ignores top-level mappings', async () => {
		const raw = { ...container, Ports: bindings };
		assert.deepStrictEqual(await inspectContainer(inspectParams([raw]), container.Id), {
			...container, Ports: [],
		});
	});
});

describe('Runtime argument prefixes', () => {
	const prefix = ['--context', 'context with spaces', '001', 'a=b', '"literal quotes"', ''];

	function recordingHost(response = '[]') {
		const calls: ExecParameters[] = [];
		const exec: ExecFunction = async params => {
			calls.push(params);
			const stdout = new PassThrough();
			const stderr = new PassThrough();
			return {
				stdin: new PassThrough(), stdout, stderr,
				exit: new Promise(resolve => setImmediate(() => {
					stdout.end(Buffer.from(response));
					stderr.end();
					resolve({ code: 0, signal: null });
				})),
				terminate: async () => {},
			};
		};
		const ptyExec: PtyExecFunction = async params => {
			calls.push(params);
			return {
				onData: () => ({ dispose() {} }),
				resize() {},
				exit: Promise.resolve({ code: 0, signal: undefined }),
				terminate: async () => {},
			};
		};
		const cliHost = { exec, ptyExec } as CLIHost;
		const params: DockerCLIParameters = {
			cliHost, dockerCLI: 'docker', runtimeArgs: prefix,
			dockerComposeCLI: dockerComposeCLIConfig({ exec, env: {}, output: nullLog }, 'docker', 'docker-compose'),
			env: {}, output: nullLog,
			buildPlatformInfo: { os: 'linux', arch: 'amd64' },
			targetPlatformInfo: { os: 'linux', arch: 'amd64' },
		};
		const resolver = {
			dockerCLI: params.dockerCLI, runtimeArgs: prefix, cliVariant: CLIVariant.Docker,
			dockerComposeCLI: params.dockerComposeCLI, dockerEnv: params.env,
			common: { cliHost, output: nullLog },
		};
		return { calls, params, resolver };
	}

	it('converts CLI and resolver parameters without changing partial arguments', () => {
		const { params, resolver } = recordingHost();
		for (const input of [params, resolver]) {
			assert.deepStrictEqual(toExecParameters(input).args, prefix);
			assert.deepStrictEqual(toPtyExecParameters(input).args, prefix);
			const exec = { ...toExecParameters(input), args: [...prefix, 'existing'] };
			const pty = { ...toPtyExecParameters(input), args: [...prefix, 'existing'] };
			assert.deepStrictEqual(toExecParameters(exec), exec);
			assert.deepStrictEqual(toPtyExecParameters(pty), pty);
			assert.deepStrictEqual(toExecParameters({ ...input, runtimeArgs: undefined }).args, []);
			assert.deepStrictEqual(toPtyExecParameters({ ...input, runtimeArgs: [] }).args, []);
		}
	});

	it('prefixes inspect, events, plain and PTY commands once without mutating arguments', async () => {
		const { calls, params, resolver } = recordingHost();
		const original = prefix.slice();
		await inspectImage(params, 'image');
		await listContainers(resolver);
		const events = await getEvents(resolver);
		await events.exit;
		await dockerCLI(toExecParameters(params), 'build', '.');
		await dockerPtyCLI(resolver, 'run', 'image');
		assert.deepStrictEqual(calls.map(call => call.args), [
			[...prefix, 'inspect', '--type', 'image', 'image'],
			[...prefix, 'ps', '-q'],
			[...prefix, 'events', '--format', '{{json .}}'],
			[...prefix, 'build', '.'],
			[...prefix, 'run', 'image'],
		]);
		assert.deepStrictEqual(prefix, original);
	});

	it('prefixes container exec including native PTY and plain fallback', async () => {
		const { calls, params, resolver } = recordingHost();
		const command = { cmd: 'printf', args: ['a b', ''], output: nullLog };
		await (await dockerExecFunction(params, 'container', 'user')(command)).exit;
		const pty = await dockerPtyExecFunction(resolver, 'container', 'user', async <T>() => ({} as T), false);
		await (await pty(command)).exit;
		const fallback = await dockerPtyExecFunction(resolver, 'container', 'user', async () => undefined, false);
		await (await fallback(command)).exit;
		assert.deepStrictEqual(calls.map(call => call.args), [
			[...prefix, 'exec', '-i', '-u', 'user', 'container', 'printf', 'a b', ''],
			[...prefix, 'exec', '-i', '-t', '-u', 'user', 'container', 'printf', 'a b', ''],
			[...prefix, 'exec', '-i', '-u', 'user', 'container', 'printf', 'a b', ''],
		]);
	});

	it('prefixes all Docker version probes', async () => {
		const { calls, params } = recordingHost('Docker 28.0.0');
		assert.strictEqual((await dockerBuildKitVersion(params))?.versionMatch, '28.0.0');
		assert.strictEqual((await dockerEngineVersion(params))?.versionMatch, '28.0.0');
		assert.strictEqual(await lookupCLIVariant(toExecParameters(params)), CLIVariant.Docker);
		assert.deepStrictEqual(calls.map(call => call.args), [
			[...prefix, 'buildx', 'version'],
			[...prefix, 'version', '--format', '{{.Server.Version}}'],
			[...prefix, '-v'],
		]);
	});

	it('propagates ProvisionOptions through createDockerParams and its probes', async function () {
		this.timeout(20000);
		// Node stands in for Docker; its inline script reports the exact received arguments.
		const runtimeArgs = ['-e', 'process.stdout.write("podman " + JSON.stringify(process.argv.slice(1)))', '--', 'prefix value'];
		const disposables: (() => Promise<unknown> | undefined)[] = [];
		try {
			const params = await createDockerParams({
				...staticProvisionParams,
				dockerPath: process.execPath, runtimeArgs,
				workspaceFolder: __dirname, persistedFolder: __dirname,
				mountWorkspaceGitRoot: false, mountGitWorktreeCommonDir: false,
				log: () => {}, logLevel: LogLevel.Error,
				remoteEnv: {}, additionalLabels: [],
				skipFeatureAutoMapping: false, skipPersistingCustomizationsFromFeatures: false,
				dotfiles: {},
			}, disposables);
			assert.deepStrictEqual(params.runtimeArgs, runtimeArgs);
			assert.strictEqual(params.cliVariant, CLIVariant.Podman);
			assert.strictEqual(params.buildKitVersion?.versionString, 'podman ["prefix value","buildx","version"]');
			assert.strictEqual(params.dockerEngineVersion?.versionString, 'podman ["prefix value","version","--format","{{.Server.Version}}"]');
			const result = await dockerCLI(params, 'ps');
			assert.strictEqual(result.stdout.toString(), 'podman ["prefix value","ps"]');
		} finally {
			await Promise.all(disposables.map(dispose => dispose()));
		}
	});
});

// Use the real CLI parser in a child process, replacing only command handlers so no Docker is needed.
describe('Runtime argument parsing', function () {
	this.timeout(30000);
	const cli = path.resolve(__dirname, '../spec-node/devContainersSpecCLI.ts');
	const project = path.resolve(__dirname, 'tsconfig.json');
	function parse(args: string[]) {
		const script = `
			require(${JSON.stringify(require.resolve('ts-node'))}).register({ project: ${JSON.stringify(project)}, transpileOnly: true });
			const yargsPath = ${JSON.stringify(require.resolve('yargs'))};
			const original = require(yargsPath);
			require.cache[yargsPath].exports = (...args) => {
				const y = original(...args);
				const command = y.command;
				y.command = (...args) => {
					if (typeof args[3] === 'function') {
						args[3] = argv => process.stdout.write(JSON.stringify(argv));
					}
					return command.apply(y, args);
				};
				return y;
			};
			process.argv = [process.execPath, ${JSON.stringify(cli)}, ...${JSON.stringify(args)}];
			require(${JSON.stringify(cli)});
		`;
		return JSON.parse(execFileSync(process.execPath, ['-e', script], { encoding: 'utf8', stdio: 'pipe' }));
	}

	for (const command of ['set-up', 'run-user-commands']) {
		const args = [command, '--docker-path', 'custom-docker', '--container-id', 'container'];
		it(`preserves repeated exact strings for ${command}`, () => {
			const values = ['--session', 'a b', '001', 'a=b', '"quoted"', "'quoted'", '', '--', 'a\\b', ''];
			assert.deepStrictEqual(parse([...args, ...values.map(value => `--runtime-arg=${value}`)])['runtime-arg'], values);
		});

		it(`normalizes a single empty argument and leaves an omitted option undefined for ${command}`, () => {
			assert.deepStrictEqual(parse([...args, '--runtime-arg='])['runtime-arg'], ['']);
			assert.strictEqual(parse(args)['runtime-arg'], undefined);
		});
	}

	for (const command of ['up', 'build', 'read-configuration', 'exec', 'upgrade']) {
		it(`rejects unsupported runtime arguments before the command handler for ${command}`, () => {
			const args = [command, '--runtime-arg=--session'];
			if (command === 'exec') {
				args.push('printf', 'a b');
			}
			assert.throws(() => parse(args), (error: { status: number; stdout: string; stderr: string }) => {
				assert.strictEqual(error.status, 1);
				assert.strictEqual(error.stdout, '');
				assert.match(error.stderr, /Unknown arguments?: runtime-arg/);
				return true;
			});
		});
	}

	it('preserves literal runtime-arg arguments after the public exec child command', () => {
		const command = ['printf', '--runtime-arg=container-argument', '--runtime-arg', 'a b', ''];
		const parsed = parse(['exec', '--container-id', 'container', ...command]);
		assert.strictEqual(parsed['runtime-arg'], undefined);
		assert.deepStrictEqual(parsed._, command);
	});
});

async function testRemoveContainer(params: PartialExecParameters, nameOrId: string) {
	await removeContainer(params, nameOrId);
	const all = await listContainers(params, true);
	if (all.some(shortId => nameOrId.startsWith(shortId))) {
		throw new Error('container still exists');
	}
}

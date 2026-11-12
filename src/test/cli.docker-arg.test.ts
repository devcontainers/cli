/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as cp from 'child_process';
import * as path from 'path';
import { promisify } from 'util';

const execFile = promisify(cp.execFile);

// The Docker CLI and its plugins prefer -H over DOCKER_HOST, so with an unreachable DOCKER_HOST only invocations that
// received the --docker-arg values reach the Docker engine. Runs the built CLI without a shell so this also runs on Windows.
describe('Dev Containers CLI --docker-arg', function () {
	this.timeout('300s');

	const cli = path.join(__dirname, '..', '..', 'devcontainer.js');
	const env = { ...process.env, DOCKER_HOST: 'tcp://127.0.0.1:9' };
	const dockerfileFolder = path.join(__dirname, 'configs', 'docker-arg-dockerfile');
	const composeFolder = path.join(__dirname, 'configs', 'docker-arg-compose');
	let dockerArgs: string[];

	before(async () => {
		const { stdout } = await execFile('docker', ['context', 'inspect', '--format', '{{.Endpoints.docker.Host}}']);
		dockerArgs = ['-H', stdout.trim()].map(arg => `--docker-arg=${arg}`);
	});

	async function devcontainer(command: string, args: string[], withDockerArgs = true) {
		const { stdout } = await execFile(process.execPath, [cli, command, ...(withDockerArgs ? dockerArgs : []), ...args], { env, maxBuffer: 100 * 1024 * 1024 });
		return stdout;
	}

	function parseResult(stdout: string) {
		return JSON.parse(stdout.trim().split(/\r?\n/).pop()!);
	}

	it('cannot reach Docker without --docker-arg', async () => {
		await assert.rejects(devcontainer('up', ['--workspace-folder', dockerfileFolder], false), (err: { stdout: string }) => {
			assert.strictEqual(parseResult(err.stdout).outcome, 'error');
			return true;
		});
	});

	it('uses the Docker arguments for up, exec, set-up, run-user-commands and read-configuration', async () => {
		const up = parseResult(await devcontainer('up', ['--workspace-folder', dockerfileFolder, '--remove-existing-container']));
		assert.strictEqual(up.outcome, 'success');
		try {
			assert.strictEqual((await devcontainer('exec', ['--workspace-folder', dockerfileFolder, 'cat', '/tmp/docker-arg-marker'])).trim(), 'post-create');

			const config = path.join(dockerfileFolder, '.devcontainer.json');
			for (const command of ['set-up', 'run-user-commands']) {
				assert.strictEqual(parseResult(await devcontainer(command, ['--container-id', up.containerId, '--config', config])).outcome, 'success', command);
			}

			// Only resolved when the container was found.
			const read = parseResult(await devcontainer('read-configuration', ['--container-id', up.containerId, '--workspace-folder', dockerfileFolder]));
			assert.strictEqual(read.configuration.remoteEnv.FROM_CONTAINER, 'from-image');
		} finally {
			await execFile('docker', ['rm', '-f', up.containerId]);
		}
	});

	it('uses the Docker arguments for build', async () => {
		const imageName = `devcontainers-docker-arg-test:${Date.now()}`;
		const build = parseResult(await devcontainer('build', ['--workspace-folder', dockerfileFolder, '--image-name', imageName]));
		assert.strictEqual(build.outcome, 'success');
		await execFile('docker', ['rmi', '-f', imageName]);
	});

	it('uses the Docker arguments for the Docker Compose plugin', async () => {
		const read = parseResult(await devcontainer('read-configuration', ['--workspace-folder', composeFolder, '--include-merged-configuration']));
		assert.ok(read.mergedConfiguration);

		const up = parseResult(await devcontainer('up', ['--workspace-folder', composeFolder, '--remove-existing-container']));
		assert.strictEqual(up.outcome, 'success');
		try {
			assert.strictEqual((await devcontainer('exec', ['--workspace-folder', composeFolder, 'cat', '/tmp/docker-arg-marker'])).trim(), 'post-create');
		} finally {
			await execFile('docker', ['compose', '--project-name', up.composeProjectName, 'down']);
		}
	});
});

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as path from 'path';
import { shellExec } from './testUtils';

const pkg = require('../../package.json');

describe('Dev Containers CLI using Podman', function () {
	this.timeout('240s');

	const tmp = path.relative(process.cwd(), path.join(__dirname, 'tmp'));
	const cli = `npx --prefix ${tmp} devcontainer`;

	before('Install', async () => {
		await shellExec(`rm -rf ${tmp}/node_modules`);
		await shellExec(`mkdir -p ${tmp}`);
		await shellExec(`npm --prefix ${tmp} install devcontainers-cli-${pkg.version}.tgz`);
	});

	describe('Command up using Podman', () => {

		it('should execute successfully with valid config with features', async () => {
			const res = await shellExec(`${cli} up --docker-path podman --workspace-folder ${__dirname}/configs/image-with-features`);
			const response = JSON.parse(res.stdout);
			assert.equal(response.outcome, 'success');
			const containerId: string = response.containerId;
			assert.ok(containerId, 'Container id not found.');
			await shellExec(`podman rm -f ${containerId}`);
		});

		it('should execute successfully with valid config with features', async () => {
			const res = await shellExec(`${cli} up --docker-path podman --workspace-folder ${__dirname}/configs/dockerfile-with-features`);
			const response = JSON.parse(res.stdout);
			assert.equal(response.outcome, 'success');
			const containerId: string = response.containerId;
			assert.ok(containerId, 'Container id not found.');
			await shellExec(`podman rm -f ${containerId}`);
		});

		it('should map the remote user uid/gid with an explicit --userns=keep-id mapping', async () => {
			const testFolder = `${__dirname}/configs/podman-keep-id`;
			const res = await shellExec(`${cli} up --docker-path podman --workspace-folder ${testFolder}`);
			const response = JSON.parse(res.stdout);
			assert.equal(response.outcome, 'success');
			const containerId: string = response.containerId;
			assert.ok(containerId, 'Container id not found.');

			// The container user 'foo' is baked to uid 1234 / gid 4321. With an explicit
			// keep-id mapping, files the remote user creates in the bind-mounted workspace
			// must be owned by the host user (not by host uid 1234).
			const marker = `keepidtest_${Date.now()}`;
			await shellExec(`podman exec ${containerId} sh -c "touch /workspaces/cli/${marker}"`);
			const hostStat = await shellExec(`stat -c '%u:%g' ${path.join(__dirname, '..', '..', marker)}`);
			assert.strictEqual(hostStat.stdout.trim(), `${process.getuid!()}:${process.getgid!()}`);
			await shellExec(`rm -f ${path.join(__dirname, '..', '..', marker)}`);

			await shellExec(`podman rm -f ${containerId}`);
		});

		it('should map a numeric remote user uid/gid without resolving from the image', async () => {
			const testFolder = `${__dirname}/configs/podman-keep-id-numeric`;
			const res = await shellExec(`${cli} up --docker-path podman --workspace-folder ${testFolder}`);
			const response = JSON.parse(res.stdout);
			assert.equal(response.outcome, 'success');
			const containerId: string = response.containerId;
			assert.ok(containerId, 'Container id not found.');

			// The remote user is specified numerically (1234), so the CLI must derive the
			// keep-id mapping directly from config rather than running a throwaway container.
			// Files the remote user creates in the bind-mounted workspace must be owned by
			// the host user (not by host uid 1234).
			const marker = `keepidtest_${Date.now()}`;
			await shellExec(`podman exec ${containerId} sh -c "touch /workspaces/cli/${marker}"`);
			const hostStat = await shellExec(`stat -c '%u:%g' ${path.join(__dirname, '..', '..', marker)}`);
			assert.strictEqual(hostStat.stdout.trim(), `${process.getuid!()}:${process.getgid!()}`);
			await shellExec(`rm -f ${path.join(__dirname, '..', '..', marker)}`);

			await shellExec(`podman rm -f ${containerId}`);
		});
	});
});
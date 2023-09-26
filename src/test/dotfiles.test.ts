/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as path from 'path';
import { shellExec, pathExists } from './testUtils';

const pkg = require('../../package.json');

describe('Dotfiles', function () {

	this.timeout('240s');
	const tmp = path.relative(process.cwd(), path.join(__dirname, 'tmp'));
	const cli = `npx --prefix ${tmp} devcontainer`;

	before('Install', async () => {
		await shellExec(`rm -rf ${tmp}/node_modules`);
		await shellExec(`mkdir -p ${tmp}`);
		await shellExec(`npm --prefix ${tmp} install devcontainers-cli-${pkg.version}.tgz`);
	});

	let containerId = '';
	this.afterEach('Cleanup', async () => {
		assert.ok(containerId, 'In Cleanup: Container id not found.');
		await shellExec(`docker rm -f ${containerId}`);
		containerId = '';
	});

	it('should execute successfully with valid config and dotfiles', async () => {
		const res = await shellExec(`${cli} up --workspace-folder ${__dirname}/configs/image-with-git-feature --dotfiles-repository https://github.com/codspace/test-dotfiles`);
		const response = JSON.parse(res.stdout);
		assert.equal(response.outcome, 'success');
		containerId = response.containerId;

		const dotfiles = await pathExists(cli, `${__dirname}/configs/image-with-git-feature`, `/tmp/.dotfilesMarker`);
		assert.ok(dotfiles, 'Dotfiles not found.');
	});

	it('should execute successfully with valid config and dotfiles with custom install path as filename', async () => {
		const res = await shellExec(`${cli} up --workspace-folder ${__dirname}/configs/image-with-git-feature --dotfiles-repository https://github.com/codspace/test-dotfiles --dotfiles-install-command install.sh`);
		const response = JSON.parse(res.stdout);
		assert.equal(response.outcome, 'success');
		containerId = response.containerId;

		const dotfiles = await pathExists(cli, `${__dirname}/configs/image-with-git-feature`, `/tmp/.dotfilesMarker`);
		assert.ok(dotfiles, 'Dotfiles not found.');
	});

	it('should execute successfully with valid config and dotfiles with custom install path as relative path', async () => {
		const res = await shellExec(`${cli} up --workspace-folder ${__dirname}/configs/image-with-git-feature --dotfiles-repository https://github.com/codspace/test-dotfiles --dotfiles-install-command ./install.sh`);
		const response = JSON.parse(res.stdout);
		assert.equal(response.outcome, 'success');
		containerId = response.containerId;

		const dotfiles = await pathExists(cli, `${__dirname}/configs/image-with-git-feature`, `/tmp/.dotfilesMarker`);
		assert.ok(dotfiles, 'Dotfiles not found.');
	});

	it('should execute successfully with valid config and dotfiles with custom install path as absolute path', async () => {
		const res = await shellExec(`${cli} up --workspace-folder ${__dirname}/configs/image-with-git-feature --dotfiles-repository https://github.com/codspace/test-dotfiles --dotfiles-install-command /home/node/dotfiles/install.sh`);
		const response = JSON.parse(res.stdout);
		assert.equal(response.outcome, 'success');
		containerId = response.containerId;

		const dotfiles = await pathExists(cli, `${__dirname}/configs/image-with-git-feature`, `/tmp/.dotfilesMarker`);
		assert.ok(dotfiles, 'Dotfiles not found.');
	});

	it('should execute successfully with valid config and dotfiles with non executable install script', async () => {
		const res = await shellExec(`${cli} up --workspace-folder ${__dirname}/configs/image-with-git-feature --dotfiles-repository codspace/test-dotfiles-non-executable --dotfiles-install-command .run-my-dotfiles-script`);
		const response = JSON.parse(res.stdout);
		assert.equal(response.outcome, 'success');
		containerId = response.containerId;

		const dotfiles = await pathExists(cli, `${__dirname}/configs/image-with-git-feature`, `/tmp/.dotfilesMarker`);
		assert.ok(dotfiles, 'Dotfiles not found.');
	});

	it('should execute successfully with valid config and dotfiles with non executable absolute path install script', async () => {
		const res = await shellExec(`${cli} up --workspace-folder ${__dirname}/configs/image-with-git-feature --dotfiles-repository codspace/test-dotfiles-non-executable --dotfiles-install-command /home/node/dotfiles/.run-my-dotfiles-script`);
		const response = JSON.parse(res.stdout);
		assert.equal(response.outcome, 'success');
		containerId = response.containerId;

		const dotfiles = await pathExists(cli, `${__dirname}/configs/image-with-git-feature`, `/tmp/.dotfilesMarker`);
		assert.ok(dotfiles, 'Dotfiles not found.');
	});

	it('should execute successfully with valid config and dotfiles with secrets', async () => {
		const testFolder = `${__dirname}/configs`;
		await shellExec(`rm -f ${testFolder}/*.testMarker`, undefined, undefined, true);
		const secrets = {
			'SECRET1': 'SecretValue1',
			'MASK_IT': 'container',
		};
		await shellExec(`printf '${JSON.stringify(secrets)}' > ${testFolder}/test-secrets-temp.json`, undefined, undefined, true);

		const res = await shellExec(`${cli} up --workspace-folder ${__dirname}/configs/image-with-git-feature --dotfiles-repository https://github.com/codspace/test-dotfiles --secrets-file ${testFolder}/test-secrets-temp.json --log-level trace --log-format json`);
		const response = JSON.parse(res.stdout);
		assert.equal(response.outcome, 'success');
		containerId = response.containerId;
		assert.ok(containerId, 'Container id not found.');
		const dotfiles = await pathExists(cli, `${__dirname}/configs/image-with-git-feature`, `/tmp/.dotfilesMarker`);
		assert.ok(dotfiles, 'Dotfiles not found.');

		// assert file contents to ensure secrets & remoteEnv were available to the command
		const catResp = await shellExec(`${cli} exec --workspace-folder ${__dirname}/configs/image-with-git-feature cat /tmp/.dotfileEnvs`);
		const { stdout, error } = catResp;
		assert.strictEqual(error, null);
		assert.match(stdout, /SECRET1=SecretValue1/);
		assert.match(stdout, /TEST_REMOTE_ENV=Value 1/);

		// assert secret masking
		// We log the message `Starting container` from CLI. Since the word `container` is specified as a secret here, that should get masked
		const logs = res.stderr;
		assert.match(logs, /Starting \*\*\*\*\*\*\*\*/);
		assert.doesNotMatch(logs, /Starting container/);
	});
});
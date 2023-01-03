/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { assert } from 'chai';
import * as path from 'path';
import { devContainerDown, devContainerUp, shellExec } from '../testUtils';

const pkg = require('../../../package.json');

describe('Registry Compatibility', function () {
	this.timeout('120s');

	const tmp = path.relative(process.cwd(), path.join(__dirname, 'tmp'));
	const cli = `npx --prefix ${tmp} devcontainer`;

	before('Install', async () => {
		await shellExec(`rm -rf ${tmp}/node_modules`);
		await shellExec(`mkdir -p ${tmp}`);
		await shellExec(`npm --prefix ${tmp} install devcontainers-cli-${pkg.version}.tgz`);
	});

	// TODO: Matrix this test against all tested registries
	describe('Azure Container Registry', () => {

		describe(`'devcontainer up' with a Feature anonymously pulled from ACR`, () => {
			let containerId: string | null = null;
			const testFolder = `${__dirname}/configs/azure-container-registry`;

			before(async () => containerId = (await devContainerUp(cli, testFolder, { 'logLevel': 'trace' })).containerId);
			after(async () => await devContainerDown({ containerId }));

			it('should exec the color command', async () => {
				const res = await shellExec(`${cli} exec --workspace-folder ${testFolder} color`);
				const response = JSON.parse(res.stdout);
				console.log(res.stderr);
				assert.equal(response.outcome, 'success');
				assert.match(res.stderr, /my favorite color is pink/);
			});
		});

		describe(`devcontainer features info manifest`, async () => {

			it('fetches manifest anonymously from ACR', async () => {

				let infoManifestResult: { stdout: string; stderr: string } | null = null;
				let success = false;
				try {
					infoManifestResult = await shellExec(`${cli} features info manifest devcontainercli.azurecr.io/features/hello --log-level trace`);
					success = true;
				} catch (error) {
					assert.fail('features info tags sub-command should not throw');
				}

				assert.isTrue(success);
				assert.isDefined(infoManifestResult);
				const manifest = infoManifestResult.stdout;
				const regex = /application\/vnd\.devcontainers\.layer\.v1\+tar/;
				assert.match(manifest, regex);
			});
		});
	});

});
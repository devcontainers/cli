/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { assert } from 'chai';
import * as path from 'path';
import { devContainerDown, devContainerUp, shellExec } from '../testUtils';

const pkg = require('../../../package.json');

interface TestPlan {
	name: string;
	configName: string;
	testFeatureId: string;
	testCommand?: string;
	testCommandResult?: RegExp;
}

const defaultTestPlan = {
	testCommand: 'color',
	testCommandResult: /my favorite color is pink/,
};

const registryCompatibilityTestPlan: TestPlan[] = [
	{
		name: 'Anonymous access of Azure Container Registry',
		configName: 'azure-anonymous',
		testFeatureId: 'devcontainercli.azurecr.io/features/color',
	},
	{
		name: 'Anonymous access of GHCR',
		configName: 'github-anonymous',
		testFeatureId: 'ghcr.io/devcontainers/feature-starter/color',
	}
];

describe('Registry Compatibility', function () {
	this.timeout('1200s');
	const tmp = path.relative(process.cwd(), path.join(__dirname, 'tmp'));
	const cli = `npx --prefix ${tmp} devcontainer`;

	before('Install', async () => {
		await shellExec(`rm -rf ${tmp}/node_modules`);
		await shellExec(`mkdir -p ${tmp}`);
		await shellExec(`npm --prefix ${tmp} install devcontainers-cli-${pkg.version}.tgz`);
	});

	registryCompatibilityTestPlan.forEach(({ name, configName, testFeatureId, testCommand, testCommandResult }) => {
		this.timeout('120s');
		describe(name, () => {
			describe('devcontainer up', () => {
				let containerId: string | null = null;
				const testFolder = `${__dirname}/configs/registry-compatibility/${configName}`;

				before(async () => containerId = (await devContainerUp(cli, testFolder, { 'logLevel': 'trace' })).containerId);
				after(async () => await devContainerDown({ containerId }));

				const cmd = testCommand ?? defaultTestPlan.testCommand;
				const expected = testCommandResult ?? defaultTestPlan.testCommandResult;

				it(`should exec the ${cmd} command`, async () => {
					const res = await shellExec(`${cli} exec --workspace-folder ${testFolder} ${cmd} `);
					assert.strictEqual(res.error, null);
					assert.match(res.stdout, expected);
				});
			});

			describe(`devcontainer features info manifest`, async () => {
				it('fetches manifest', async () => {
					let infoManifestResult: { stdout: string; stderr: string } | null = null;
					let success = false;
					try {
						infoManifestResult = await shellExec(`${cli} features info manifest ${testFeatureId} --log-level trace`);
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

});
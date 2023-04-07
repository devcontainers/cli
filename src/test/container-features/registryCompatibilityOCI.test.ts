/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { assert } from 'chai';
import * as path from 'path';
import { devContainerDown, devContainerUp, shellExec } from '../testUtils';

const pkg = require('../../../package.json');

enum AuthStrategy {
	Anonymous,
	DockerConfigAuthFile,
	// PlatformCredentialHelper,
	// RefreshToken,
}

interface TestPlan {
	name: string;
	configName: string;
	testFeatureId: string;
	testCommand?: string;
	testCommandResult?: RegExp;
	// Optionally tell the test to set up with a specfic auth strategy.
	// If not set, the test will run with anonymous.
	// NOTE:
	// 	These will be skipped unless the environment has the relevant 'authCredentialEnvSecret' set in the environment.
	useAuthStrategy?: AuthStrategy;
	// Format: registry|username|passwordOrToken
	authCredentialEnvSecret?: string;
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
	},
	// https://learn.microsoft.com/en-us/azure/container-registry/container-registry-repository-scoped-permissions
	{
		name: 'Authenticated access of Azure Container Registry with registry scoped token',
		configName: 'azure-registry-scoped',
		testFeatureId: 'privatedevcontainercli.azurecr.io/features/rabbit',
		useAuthStrategy: AuthStrategy.DockerConfigAuthFile,
		authCredentialEnvSecret: 'FEATURES_TEST__AZURE_REGISTRY_SCOPED_CREDENTIAL',
		testCommand: 'rabbit',
		testCommandResult: /rabbit-is-the-best-animal/,
	}
];

function constructAuthFromStrategy(tmpFolder: string, authStrategy: AuthStrategy, authCredentialEnvSecret?: string): string | undefined {
	const generateAuthFolder = () => {
		const randomChars = Math.random().toString(36).substring(2, 6);
		const tmpAuthFolder = path.join(tmpFolder, randomChars, 'auth');
		shellExec(`mkdir -p ${tmpAuthFolder}`);
		return tmpAuthFolder;
	};

	switch (authStrategy) {
		case AuthStrategy.Anonymous:
			return;
		case AuthStrategy.DockerConfigAuthFile:
			if (!authCredentialEnvSecret) {
				return;
			}
			const split = process.env[authCredentialEnvSecret]?.split('|');
			if (!split || split.length !== 3) {
				return;
			}
			const tmpAuthFolder = generateAuthFolder();

			const registry = split?.[0];
			const username = split?.[1];
			const passwordOrToken = split?.[2];
			const encodedAuth = Buffer.from(`${username}:${passwordOrToken}`).toString('base64');

			shellExec(`echo '{"auths":{"${registry}":{"auth": "${encodedAuth}"}}}' > ${tmpAuthFolder}/config.json`);
			return tmpAuthFolder;
		default:
			return;
	}
}

describe('Registry Compatibility', function () {
	this.timeout('120s');
	const tmp = path.relative(process.cwd(), path.join(__dirname, 'tmp'));
	const cli = `npx --prefix ${tmp} devcontainer`;

	before('Install', async () => {
		await shellExec(`rm -rf ${tmp}/node_modules`);
		await shellExec(`mkdir -p ${tmp}`);
		await shellExec(`npm --prefix ${tmp} install devcontainers-cli-${pkg.version}.tgz`);
	});

	registryCompatibilityTestPlan.forEach(({ name, configName, testFeatureId, testCommand, testCommandResult, useAuthStrategy, authCredentialEnvSecret }) => {
		this.timeout('120s');
		describe(name, async function () {
			((authCredentialEnvSecret && !process.env[authCredentialEnvSecret]) ? describe.skip : describe)('devcontainer up', async function () {

				const authFolder = constructAuthFromStrategy(tmp, useAuthStrategy ?? AuthStrategy.Anonymous, authCredentialEnvSecret);

				let containerId: string | null = null;
				const testFolder = `${__dirname}/configs/registry-compatibility/${configName}`;

				before(async () => containerId = (await devContainerUp(cli, testFolder, {
					'logLevel': 'trace', prefix: authFolder ? `DOCKER_CONFIG=${authFolder}` : undefined
				})).containerId);
				after(async () => await devContainerDown({ containerId }));

				const cmd = testCommand ?? defaultTestPlan.testCommand;
				const expected = testCommandResult ?? defaultTestPlan.testCommandResult;

				it(`should exec the ${cmd} command`, async () => {
					const res = await shellExec(`${cli} exec --workspace-folder ${testFolder} ${cmd} `);
					assert.strictEqual(res.error, null);
					assert.match(res.stdout, expected);
				});
			});

			((authCredentialEnvSecret && !process.env[authCredentialEnvSecret]) ? describe.skip : describe)(`devcontainer features info manifest`, async function () {

				const authFolder = constructAuthFromStrategy(tmp, useAuthStrategy ?? AuthStrategy.Anonymous, authCredentialEnvSecret);

				it('fetches manifest', async function () {
					let infoManifestResult: { stdout: string; stderr: string } | null = null;
					let success = false;
					try {
						if (authFolder) {
							infoManifestResult = await shellExec(`DOCKER_CONFIG=${authFolder} ${cli} features info manifest ${testFeatureId} --log-level trace`);

						} else {
							infoManifestResult = await shellExec(`${cli} features info manifest ${testFeatureId} --log-level trace`);
						}
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
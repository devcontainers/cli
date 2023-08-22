/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { assert } from 'chai';
import * as os from 'os';
import * as path from 'path';
import { devContainerDown, devContainerUp, shellExec } from '../testUtils';

const pkg = require('../../../package.json');

enum AuthStrategy {
	Anonymous,
	GitHubToken,
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
	// NOTE: These will be skipped unless the environment has the relevant 'authStrategyKey' set in the environment.
	//       This data is specific to each strategy and parsed about below accordingly.
	useAuthStrategy?: AuthStrategy;
	authStrategyKey?: string;
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
		authStrategyKey: 'FEATURES_TEST__AZURE_REGISTRY_SCOPED_CREDENTIAL',
		testCommand: 'rabbit',
		testCommandResult: /rabbit-is-the-best-animal/,
	},
	// Via GHCR visibility settings, this repo's GitHub Actions CI should be able to access this Feature via its GITHUB_TOKEN.
	{
		name: 'Private access of GHCR via an environment GITHUB_TOKEN',
		configName: 'github-private',
		testFeatureId: 'ghcr.io/devcontainers/private-feature-set-for-tests/color',
		useAuthStrategy: AuthStrategy.GitHubToken,
		authStrategyKey: 'RUNNING_IN_DEVCONTAINERS_CLI_REPO_CI'
	}
];

function envVariableExists(key: string): boolean {
	return !!process.env[key] && process.env[key] !== '';
}

function constructAuthFromStrategy(tmpFolder: string, authStrategy: AuthStrategy, authStrategyKey?: string): string | undefined {
	const generateAuthFolder = () => {
		const randomChars = Math.random().toString(36).substring(2, 6);
		const tmpAuthFolder = path.join(tmpFolder, randomChars, 'auth');
		shellExec(`mkdir -p ${tmpAuthFolder}`);
		return tmpAuthFolder;
	};

	switch (authStrategy) {
		case AuthStrategy.Anonymous:
		case AuthStrategy.GitHubToken:
			return;
		case AuthStrategy.DockerConfigAuthFile:
			// Format: registry|username|passwordOrToken
			if (!authStrategyKey) {
				return;
			}
			const split = process.env[authStrategyKey]?.split('|');
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

	registryCompatibilityTestPlan.forEach(({ name, configName, testFeatureId, testCommand, testCommandResult, useAuthStrategy, authStrategyKey }) => {
		this.timeout('120s');
		describe(name, async function () {
			((authStrategyKey && !envVariableExists(authStrategyKey)) ? describe.skip : describe)('devcontainer up', async function () {

				const authFolder = constructAuthFromStrategy(tmp, useAuthStrategy ?? AuthStrategy.Anonymous, authStrategyKey) || path.join(os.homedir(), 'fake-path');
				const gitHubToken = (useAuthStrategy === AuthStrategy.GitHubToken) ? (process.env.GITHUB_TOKEN ?? '') : '';

				let containerId: string | null = null;
				const testFolder = `${__dirname}/configs/registry-compatibility/${configName}`;

				before(async () => containerId = (await devContainerUp(cli, testFolder, {
					'logLevel': 'trace', prefix: `DOCKER_CONFIG=${authFolder} GITHUB_TOKEN=${gitHubToken}`
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

			((authStrategyKey && !envVariableExists(authStrategyKey)) ? describe.skip : describe)(`devcontainer features info manifest`, async function () {

				const authFolder = constructAuthFromStrategy(tmp, useAuthStrategy ?? AuthStrategy.Anonymous, authStrategyKey) || path.join(os.homedir(), 'fake-path');
				const gitHubToken = (useAuthStrategy === AuthStrategy.GitHubToken) ? (process.env.GITHUB_TOKEN ?? '') : '';

				it('fetches manifest', async function () {
					let infoManifestResult: { stdout: string; stderr: string } | null = null;
					let success = false;
					try {
						infoManifestResult =
							await shellExec(`DOCKER_CONFIG=${authFolder} GITHUB_TOKEN=${gitHubToken} ${cli} features info manifest ${testFeatureId} --log-level trace`);
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
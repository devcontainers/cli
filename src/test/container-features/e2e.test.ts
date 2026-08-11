/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { assert } from 'chai';
import * as path from 'path';
import { FeatureSet } from '../../spec-configuration/containerFeaturesConfiguration';
import { devContainerDown, devContainerUp, shellExec } from '../testUtils';
import { delay } from '../../spec-common/async';

const pkg = require('../../../package.json');

describe('Dev Container Features E2E (remote)', function () {
    this.timeout('300s');

    const tmp = path.relative(process.cwd(), path.join(__dirname, 'tmp'));
    const cli = `npx --prefix ${tmp} devcontainer`;

    before('Install', async () => {
        await shellExec(`rm -rf ${tmp}/node_modules`);
        await shellExec(`mkdir -p ${tmp}`);
        await shellExec(`npm --prefix ${tmp} install devcontainers-cli-${pkg.version}.tgz`);
    });

    describe('Configs with invalid features should fail', () => {
        it('should fail when a non-existent v1 feature is in the config', async () => {
            const testFolder = `${__dirname}/configs/invalid-configs/invalid-v1-features`;
            let success = false;
            try {
                await shellExec(`${cli} build --workspace-folder ${testFolder} --log-level trace`);
                success = true;
            } catch (error) {
                assert.equal(error.error.code, 1, 'Should fail with exit code 1');
                // "Failed to fetch tarball" happens if the test is executed without a $GITHUB_TOKEN
                // "HTTP 404: Not Found" happens if the test is executed with a $GITHUB_TOKEN
                assert.ok(error.stderr.indexOf('Failed to fetch tarball') > -1 || error.stderr.indexOf('HTTP 404: Not Found') > -1, `Actual error msg:  ${error.stderr}`);
            }
            assert.equal(success, false, 'expect non-successful call');
        });

        it('should fail when a non-existent v2 feature is in the config', async () => {
            const testFolder = `${__dirname}/configs/invalid-configs/invalid-v2-features`;
            let success = false;
            try {
                await shellExec(`${cli} build --workspace-folder ${testFolder} --log-level trace`);
                success = true;
            } catch (error) {
                assert.equal(error.error.code, 1, 'Should fail with exit code 1');
                assert.ok(error.stderr.indexOf('Could not resolve Feature') > -1, `Actual error msg:  ${error.stderr}`);
            }
            assert.equal(success, false, 'expect non-successful call');
        });
    });

    describe('v2 - Dockerfile feature Configs', () => {

        describe(`dockerfile-with-v2-oci-features`, () => {
            let containerId: string | null = null;
            const testFolder = `${__dirname}/configs/dockerfile-with-v2-oci-features`;
            beforeEach(async () => {
                const res = await shellExec(`${cli} up --workspace-folder ${testFolder} --skip-feature-auto-mapping`);
                const response = JSON.parse(res.stdout);
                containerId = response.containerId;
            });
            afterEach(async () => await devContainerDown({ containerId }));
            it('should detect docker installed (--privileged flag implicitly passed)', async () => {
                // NOTE: Doing a docker ps will ensure that the --privileged flag was set by the feature
                for (let i = 2; i >= 0; i--) {
                    try {
                        const res = await shellExec(`${cli} exec --workspace-folder ${testFolder} docker ps`);
                        await shellExec(`${cli} exec --workspace-folder ${testFolder} ps ax`);
                        assert.isNull(res.error);
                        assert.match(res.stdout, /CONTAINER ID/);
                        break;
                    } catch (err) {
                        await shellExec(`${cli} exec --workspace-folder ${testFolder} ps ax`);
                        if (i === 0) {
                            throw err;
                        }
                        delay(2000);
                    }
                }
            });

            it('should read configuration with features', async () => {
                const res = await shellExec(`${cli} read-configuration --workspace-folder ${testFolder} --include-features-configuration  --skip-feature-auto-mapping`);
                const response = JSON.parse(res.stdout);
                console.log(res.stderr);

                assert.strictEqual(response.featuresConfiguration?.featureSets.length, 3);

                const dind = response?.featuresConfiguration.featureSets.find((f: FeatureSet) => f?.features[0]?.id === 'docker-in-docker');
                assert.exists(dind);
                assert.includeMembers(dind.features[0].customizations.vscode.extensions, ['ms-azuretools.vscode-docker']);

                const node = response?.featuresConfiguration.featureSets.find((f: FeatureSet) => f?.features[0]?.id === 'node');
                assert.exists(node);
                assert.includeMembers(node.features[0].customizations.vscode.extensions, ['dbaeumer.vscode-eslint']);
            });
        });
    });

    describe('v2 - Image property feature Configs', () => {

        describe(`image-with-v2-tarball`, () => {
            let containerId: string | null = null;
            const testFolder = `${__dirname}/configs/image-with-v2-tarball`;
            beforeEach(async () => containerId = (await devContainerUp(cli, testFolder, { 'logLevel': 'trace' })).containerId);
            afterEach(async () => await devContainerDown({ containerId }));
            it('should detect docker installed (--privileged flag implicitly passed)', async () => {
                // NOTE: Doing a docker ps will ensure that the --privileged flag was set by the feature
                for (let i = 2; i >= 0; i--) {
                    try {
                        const res = await shellExec(`${cli} exec --workspace-folder ${testFolder} docker ps`);
                        await shellExec(`${cli} exec --workspace-folder ${testFolder} ps ax`);
                        assert.isNull(res.error);
                        assert.match(res.stdout, /CONTAINER ID/);
                        break;
                    } catch (err) {
                        await shellExec(`${cli} exec --workspace-folder ${testFolder} ps ax`);
                        if (i === 0) {
                            throw err;
                        }
                        delay(2000);
                    }
                }
            });
        });
    });
});

describe('Dev Container Features E2E - local cache/short-hand notation', function () {
    this.timeout('300s');

    const tmp = path.resolve(process.cwd(), path.join(__dirname, 'tmp3'));
    const cli = `npx --prefix ${tmp} devcontainer`;

    before('Install', async () => {
        await shellExec(`rm -rf ${tmp}/node_modules`);
        await shellExec(`mkdir -p ${tmp}`);
        await shellExec(`npm --prefix ${tmp} install devcontainers-cli-${pkg.version}.tgz`);
    });

    describe(`image-with-v1-features-node-python-local-cache with --skipFeatureAutoMapping`, () => {
        let containerId: string | null = null;
        const testFolder = `${__dirname}/configs/image-with-v1-features-node-python-local-cache`;
        beforeEach(async () => containerId = (await devContainerUp(cli, testFolder, { 'logLevel': 'trace', 'extraArgs': '--skipFeatureAutoMapping' })).containerId);
        afterEach(async () => await devContainerDown({ containerId }));

        it('should exec a PATH without the string \'ENV\'', async () => {
            const res = await shellExec(`${cli} exec --workspace-folder ${testFolder} echo \${PATH}`);
            assert.isNull(res.error);
            assert.notMatch(res.stdout, /ENV/);
        });
    });
});


describe('Dev Container Features E2E (local-path)', function () {
    this.timeout('120s');

    const tmp = path.resolve(process.cwd(), path.join(__dirname, 'tmp1'));
    const cli = `npx --prefix ${tmp} devcontainer`;

    before('Install', async () => {
        await shellExec(`rm -rf ${tmp}/node_modules`);
        await shellExec(`mkdir -p ${tmp}`);
        await shellExec(`npm --prefix ${tmp} install devcontainers-cli-${pkg.version}.tgz`);
    });

    describe(`dockerfile-with-v2-local-features-config-inside-dev-container-folder `, () => {
        let containerId: string | null = null;
        const testFolder = `${__dirname}/configs/dockerfile-with-v2-local-features-config-inside-dev-container-folder`;
        beforeEach(async () => containerId = (await devContainerUp(cli, testFolder, { 'logLevel': 'trace' })).containerId);
        afterEach(async () => await devContainerDown({ containerId }));

        it('should exec the color command', async () => {
            const res = await shellExec(`${cli} exec --workspace-folder ${testFolder} color`);
            assert.isNull(res.error);
            assert.match(res.stdout, /my favorite color is gold/);
        });
        it('should read configuration with features', async () => {
            const res = await shellExec(`${cli} read-configuration --workspace-folder ${testFolder} --include-features-configuration`);
            const response = JSON.parse(res.stdout);
            console.log(res.stderr);
            assert.equal(response?.featuresConfiguration?.featureSets[0]?.features[0]?.id, 'localFeatureA', `localFeatureA not found: ${JSON.stringify(response, undefined, '  ')}`);
        });
    });

        describe(`dockerfile-with-v2-local-features-config-outside-dev-container-folder `, () => {
            let containerId: string | null = null;
            const testFolder = `${__dirname}/configs/dockerfile-with-v2-local-features-config-outside-dev-container-folder`;
            beforeEach(async () => containerId = (await devContainerUp(cli, testFolder, { 'logLevel': 'trace' })).containerId);
            afterEach(async () => await devContainerDown({ containerId }));

            it('should exec the color command', async () => {
                const res = await shellExec(`${cli} exec --workspace-folder ${testFolder} color`);
                assert.isNull(res.error);
                assert.match(res.stdout, /my favorite color is gold/);
            });

            it('should exec the helloworld command', async () => {
            const res = await shellExec(`${cli} exec --workspace-folder ${testFolder} hello`);
            assert.isNull(res.error);
            assert.match(res.stdout, /Hello there, vscode!!!!/);
        });

        it('should read configuration with features', async () => {
            const res = await shellExec(`${cli} read-configuration --workspace-folder ${testFolder} --include-features-configuration`);
            const response = JSON.parse(res.stdout);
            console.log(res.stderr);
            assert.equal(response?.featuresConfiguration?.featureSets[0]?.features[0]?.id, 'localFeatureA', `localFeatureA not found: ${JSON.stringify(response, undefined, '  ')}`);
        });
    });

    describe(`dockerfile-with-v2-local-features-config-inside-dev-container-folder `, () => {
        let containerId: string | null = null;
        const testFolder = `${__dirname}/configs/dockerfile-with-v2-local-features-config-inside-dev-container-folder`;
        beforeEach(async () => containerId = (await devContainerUp(cli, testFolder, { 'logLevel': 'trace' })).containerId);
        afterEach(async () => await devContainerDown({ containerId }));

        it('should exec the color commmand', async () => {
            const res = await shellExec(`${cli} exec --workspace-folder ${testFolder} color`);
            assert.isNull(res.error);
            assert.match(res.stdout, /my favorite color is gold/);
        });

        it('should exec the helloworld commmand', async () => {
            const res = await shellExec(`${cli} exec --workspace-folder ${testFolder} hello`);
            assert.isNull(res.error);
            assert.match(res.stdout, /Hello there, vscode!!!!/);
        });

        it('should read configuration with features with customizations', async () => {
            const res = await shellExec(`${cli} read-configuration --workspace-folder ${testFolder} --include-features-configuration`);
            const response = JSON.parse(res.stdout);
            console.log(res.stderr);
            assert.equal(response?.featuresConfiguration?.featureSets[0]?.features[0]?.id, 'localFeatureA', `localFeatureA not found: ${JSON.stringify(response, undefined, '  ')}`);

            const featureA = response?.featuresConfiguration.featureSets.find((f: FeatureSet) => f?.features[0]?.id === 'localFeatureA');
            assert.exists(featureA);
            assert.includeMembers(featureA.features[0].customizations.vscode.extensions, ['dbaeumer.vscode-eslint']);
            const featureASettings = featureA?.features[0]?.customizations?.vscode?.settings;
            assert.isObject(featureASettings);

            // With top level "extensions" and "settings"
            const featureB = response?.featuresConfiguration.featureSets.find((f: FeatureSet) => f?.features[0]?.id === 'localFeatureB');
            assert.exists(featureB);
            assert.includeMembers(featureB.features[0].customizations.vscode.extensions, ['ms-dotnettools.csharp']);
            const featureBSettings = featureB?.features[0]?.customizations?.vscode?.settings;
            assert.isObject(featureBSettings);
        });
    });
});

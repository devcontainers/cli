/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { OCISourceInformation, processFeatureIdentifier, userFeaturesToArray } from '../../spec-configuration/containerFeaturesConfiguration';
import { computeDependsOnInstallationOrder } from '../../spec-configuration/containerFeaturesOrder';
import { DevContainerConfig, DevContainerFeature } from '../../spec-configuration/configuration';
import { CommonParams } from '../../spec-configuration/containerCollectionsOCI';
import { LogLevel, createPlainLog, makeLog } from '../../spec-utils/log';
import { isLocalFile, readLocalFile } from '../../spec-utils/pfs';

// const pkg = require('../../../package.json');
export const output = makeLog(createPlainLog(text => process.stdout.write(text), () => LogLevel.Info));

async function setupInstallOrderTest(testWorkspaceFolder: string) {
    const params: CommonParams = {
        env: process.env,
        output,
        cachedAuthHeader: {}
    };

    const configPath = `${testWorkspaceFolder}/.devcontainer/devcontainer.json`;
    if (!(await isLocalFile(configPath))) {
        assert.fail(`Test: Config is not at the expected location: ${configPath}`);
    }

    const buffer = await readLocalFile(configPath);
    const config = JSON.parse(buffer.toString()) as DevContainerConfig;
    const userFeatures = userFeaturesToArray(config);

    if (!userFeatures) {
        assert.fail(`Test: Could not extract userFeatures from config: ${configPath}`);
    }

    const processFeature = async (_userFeature: DevContainerFeature) => {
        return await processFeatureIdentifier(params, configPath, testWorkspaceFolder, _userFeature);
    };

    return {
        params,
        userFeatures,
        config,
        processFeature
    };
}

describe('Feature Dependencies', function () {
    this.timeout('10s');
    const baseTestConfigPath = `${__dirname}/configs/feature-dependencies`;

    describe('installsAfter', function () {

        // 'local Features', Features that are checked into the repo alongside the devcontainer.json
        it('valid installsAfter with file-path Features', async function () {
            const testFolder = `${baseTestConfigPath}/installsAfter/local-simple`;
            const { params, userFeatures, processFeature, config } = await setupInstallOrderTest(testFolder);

            const installOrderNodes = await computeDependsOnInstallationOrder(params, processFeature, userFeatures, config);
            if (!installOrderNodes) {
                assert.fail();
            }

            // Assert all sourceInformation is of type 'local'
            assert.ok(installOrderNodes.every(fs => fs.sourceInformation.type === 'file-path'));

            const actual = installOrderNodes.map(fs => {
                return {
                    userFeatureId: fs.sourceInformation.userFeatureId,
                    options: fs.features[0].value
                };
            });

            assert.deepStrictEqual(actual.length, 2);
            assert.deepStrictEqual(actual,
                [
                    {
                        userFeatureId: './c',
                        options: { magicNumber: '321' }
                    },
                    {
                        userFeatureId: './a',
                        options: {}
                    }
                ]);
        });
    });

    describe('dependsOn', function () {

        // 'local Features', Features that are checked into the repo alongside the devcontainer.json
        it('valid dependsOn with file-path Features', async function () {
            const testFolder = `${baseTestConfigPath}/dependsOn/local-simple`;
            const { params, userFeatures, processFeature, config } = await setupInstallOrderTest(testFolder);

            const installOrderNodes = await computeDependsOnInstallationOrder(params, processFeature, userFeatures, config);
            if (!installOrderNodes) {
                assert.fail();
            }

            // Assert all sourceInformation is of type 'local'
            assert.ok(installOrderNodes.every(fs => fs.sourceInformation.type === 'file-path'));

            const actual = installOrderNodes.map(fs => {
                return {
                    userFeatureId: fs.sourceInformation.userFeatureId,
                    options: fs.features[0].value
                };
            });

            assert.deepStrictEqual(actual.length, 2);
            assert.deepStrictEqual(actual,
                [
                    {
                        userFeatureId: './b',
                        options: { magicNumber: '50' }
                    },
                    {
                        userFeatureId: './a',
                        options: {}
                    }
                ]);
        });

        it('valid dependsOn with published oci Features', async function () {
            const testFolder = `${baseTestConfigPath}/dependsOn/oci-ab`;
            const { params, userFeatures, processFeature, config } = await setupInstallOrderTest(testFolder);

            const installOrderNodes = await computeDependsOnInstallationOrder(params, processFeature, userFeatures, config);
            if (!installOrderNodes) {
                assert.fail();
            }

            // Assert all sourceInformation is of type 'oci'
            assert.ok(installOrderNodes.every(fs => fs.sourceInformation.type === 'oci'));

            const actual = installOrderNodes.map(fs => {
                const srcInfo = fs.sourceInformation as OCISourceInformation;
                return {
                    userFeatureId: fs.sourceInformation.userFeatureId,
                    options: fs.features[0].value,
                    canonicalId: `${srcInfo.featureRef.resource}@${srcInfo.manifestDigest}`
                };
            });

            assert.deepStrictEqual(actual.length, 6);

            // Despite having different options, these two Features should have the same canconical ID (same exact contents, just run with a different set of options)
            const firstA = actual[2];
            const secondA = actual[3];
            assert.strictEqual(firstA.canonicalId, secondA.canonicalId);
            assert.deepStrictEqual(actual,
                [
                    {
                        userFeatureId: 'ghcr.io/codspace/dependsOnExperiment/D',
                        options: { magicNumber: '30' },
                        canonicalId: 'ghcr.io/codspace/dependsonexperiment/d@sha256:7f7e5a6d0acc9d28ce9b9a2080a677b24dc8c16146aa21283a33b6b0da3a933a',
                    },
                    {
                        userFeatureId: 'ghcr.io/codspace/dependsOnExperiment/E',
                        options: { magicNumber: '50' },
                        canonicalId: 'ghcr.io/codspace/dependsonexperiment/e@sha256:3e8900ecf32ab5e6ec53d57af27aac30ae88f9587f67669c7dfad151a7aa0841',
                    },
                    {
                        userFeatureId: 'ghcr.io/codspace/dependsonexperiment/a',
                        options: { magicNumber: '10' },
                        canonicalId: 'ghcr.io/codspace/dependsonexperiment/a@sha256:fcf65d5e171f1d339b50f5bc5a35159af11366eefd6f6b433f8bf9765863a699',
                    },
                    {
                        userFeatureId: 'ghcr.io/codspace/dependsOnExperiment/A',
                        options: { magicNumber: '40' },
                        canonicalId: 'ghcr.io/codspace/dependsonexperiment/a@sha256:fcf65d5e171f1d339b50f5bc5a35159af11366eefd6f6b433f8bf9765863a699',
                    },
                    {
                        userFeatureId: 'ghcr.io/codspace/dependsOnExperiment/C',
                        options: { magicNumber: '20' },
                        canonicalId: 'ghcr.io/codspace/dependsonexperiment/c@sha256:11186388aa7c428f4c73456c3d012947d3c45c7f2f0638b892fb7cdb49e8a1d9',
                    },
                    {
                        userFeatureId: 'ghcr.io/codspace/dependsonexperiment/b',
                        options: { magicNumber: '400' },
                        canonicalId: 'ghcr.io/codspace/dependsonexperiment/b@sha256:ec7e5ac599c1d6feaaa9e7dfe1564e5484b6fea9359e7a7ab8f16ae12c21a2fc',
                    }
                ]);
        });
    });

    describe('dependsOnAndInstallsAfter', function () {

        it('valid dependsOn/installsAfter with file-path Features', async function () {
            const testFolder = `${baseTestConfigPath}/dependsOn-and-installsAfter/local-simple`;
            const { params, userFeatures, processFeature, config } = await setupInstallOrderTest(testFolder);

            const installOrderNodes = await computeDependsOnInstallationOrder(params, processFeature, userFeatures, config);
            if (!installOrderNodes) {
                assert.fail();
            }

            // Assert all sourceInformation is of type 'local'
            assert.ok(installOrderNodes.every(fs => fs.sourceInformation.type === 'file-path'));

            const actual = installOrderNodes.map(fs => {
                return {
                    userFeatureId: fs.sourceInformation.userFeatureId,
                    options: fs.features[0].value
                };
            });

            assert.deepStrictEqual(actual.length, 2);
            assert.deepStrictEqual(actual,
                [
                    {
                        userFeatureId: './c',
                        options: { magicNumber: '321' }
                    },
                    {
                        userFeatureId: './a',
                        options: {}
                    }
                ]);
        });
    });

    describe('overrideFeatureInstallOrder', function () {

        it('valid 1 override with file-path Features', async function () {
            const testFolder = `${baseTestConfigPath}/overrideFeatureInstallOrder/local-simple`;
            const { params, userFeatures, processFeature, config } = await setupInstallOrderTest(testFolder);

            const installOrderNodes = await computeDependsOnInstallationOrder(params, processFeature, userFeatures, config);
            if (!installOrderNodes) {
                assert.fail();
            }

            // Assert all sourceInformation is of type 'local'
            assert.ok(installOrderNodes.every(fs => fs.sourceInformation.type === 'file-path'));

            const actual = installOrderNodes.map(fs => {
                return {
                    userFeatureId: fs.sourceInformation.userFeatureId,
                    options: fs.features[0].value
                };
            });

            assert.deepStrictEqual(actual.length, 4);
            assert.deepStrictEqual(actual,
                [
                    {
                        userFeatureId: './c',
                        options: {}
                    },
                    {
                        userFeatureId: './b',
                        options: {}
                    },
                    {
                        userFeatureId: './d',
                        options: {}
                    },
                    {
                        userFeatureId: './a',
                        options: {}
                    }
                ]);
        });

        it('valid 2 overrides with file-path Features', async function () {
            const testFolder = `${baseTestConfigPath}/overrideFeatureInstallOrder/local-intermediate`;
            const { params, userFeatures, processFeature, config } = await setupInstallOrderTest(testFolder);

            const installOrderNodes = await computeDependsOnInstallationOrder(params, processFeature, userFeatures, config);
            if (!installOrderNodes) {
                assert.fail();
            }

            // Assert all sourceInformation is of type 'local'
            assert.ok(installOrderNodes.every(fs => fs.sourceInformation.type === 'file-path'));

            const actual = installOrderNodes.map(fs => {
                return {
                    userFeatureId: fs.sourceInformation.userFeatureId,
                    options: fs.features[0].value
                };
            });

            assert.deepStrictEqual(actual.length, 4);
            assert.deepStrictEqual(actual,
                [
                    {
                        userFeatureId: './c',
                        options: {}
                    },
                    {
                        userFeatureId: './d',
                        options: {}
                    },
                    {
                        userFeatureId: './b',
                        options: {}
                    },
                    {
                        userFeatureId: './a',
                        options: {}
                    }
                ]);
        });
    });

});
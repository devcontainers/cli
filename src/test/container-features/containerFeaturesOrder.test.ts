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
                        userFeatureId: 'ghcr.io/codspace/dependson/D',
                        options: { magicNumber: '30' },
                        canonicalId: 'ghcr.io/codspace/dependson/d@sha256:3795caa1e32ba6b30a08260039804eed6f3cf40811f0c65c118437743fa15ce8',
                    },
                    {
                        userFeatureId: 'ghcr.io/codspace/dependson/E',
                        options: { magicNumber: '50' },
                        canonicalId: 'ghcr.io/codspace/dependson/e@sha256:9f36f159c70f8bebff57f341904b030733adb17ef12a5d58d4b3d89b2a6c7d5a',
                    },
                    {
                        userFeatureId: 'ghcr.io/codspace/dependson/a',
                        options: { magicNumber: '10' },
                        canonicalId: 'ghcr.io/codspace/dependson/a@sha256:932027ef71da186210e6ceb3294c3459caaf6b548d2b547d5d26be3fc4b2264a',
                    },
                    {
                        userFeatureId: 'ghcr.io/codspace/dependson/A',
                        options: { magicNumber: '40' },
                        canonicalId: 'ghcr.io/codspace/dependson/a@sha256:932027ef71da186210e6ceb3294c3459caaf6b548d2b547d5d26be3fc4b2264a',
                    },
                    {
                        userFeatureId: 'ghcr.io/codspace/dependson/C',
                        options: { magicNumber: '20' },
                        canonicalId: 'ghcr.io/codspace/dependson/c@sha256:db651708398b6d7af48f184c358728eaaf959606637133413cb4107b8454a868',
                    },
                    {
                        userFeatureId: 'ghcr.io/codspace/dependson/b',
                        options: { magicNumber: '400' },
                        canonicalId: 'ghcr.io/codspace/dependson/b@sha256:e7e6b52884ae7f349baf207ac59f78857ab64529c890b646bb0282f962bb2941',
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

        it('valid 2 overrides with mixed Feature types', async function () {
            const testFolder = `${baseTestConfigPath}/overrideFeatureInstallOrder/mixed`;
            const { params, userFeatures, processFeature, config } = await setupInstallOrderTest(testFolder);

            const installOrderNodes = await computeDependsOnInstallationOrder(params, processFeature, userFeatures, config);
            if (!installOrderNodes) {
                assert.fail();
            }

            assert.ok(installOrderNodes.every(fs => fs.sourceInformation.type === 'file-path' || fs.sourceInformation.type === 'oci'));

            const actual = installOrderNodes.map(fs => {
                switch (fs.sourceInformation.type) {
                    case 'oci':
                        const srcInfo = fs.sourceInformation as OCISourceInformation;
                        const ref = srcInfo.featureRef;
                        return {
                            id: `${ref.resource}@${srcInfo.manifestDigest}`,
                            options: fs.features[0].value,
                        };
                    default:
                        return {
                            id: fs.sourceInformation.userFeatureId,
                            options: fs.features[0].value
                        };
                }
            });

            assert.deepStrictEqual(actual.length, 9);
            assert.deepStrictEqual(actual,
                [
                    {
                        'id': './d',
                        'options': {}
                    },
                    {
                        'id': './b',
                        'options': {}
                    },
                    {
                        'id': './c',
                        'options': {}
                    },
                    {
                        'id': 'ghcr.io/codspace/dependson/d@sha256:3795caa1e32ba6b30a08260039804eed6f3cf40811f0c65c118437743fa15ce8',
                        'options': {
                            'magicNumber': '30'
                        }
                    },
                    {
                        'id': 'ghcr.io/codspace/dependson/e@sha256:9f36f159c70f8bebff57f341904b030733adb17ef12a5d58d4b3d89b2a6c7d5a',
                        'options': {
                            'magicNumber': '50'
                        }
                    },
                    {
                        'id': 'ghcr.io/codspace/dependson/a@sha256:932027ef71da186210e6ceb3294c3459caaf6b548d2b547d5d26be3fc4b2264a',
                        'options': {
                            'magicNumber': '40'
                        }
                    },
                    {
                        'id': 'ghcr.io/codspace/dependson/c@sha256:db651708398b6d7af48f184c358728eaaf959606637133413cb4107b8454a868',
                        'options': {
                            'magicNumber': '20'
                        }
                    },
                    {
                        'id': 'ghcr.io/codspace/dependson/b@sha256:e7e6b52884ae7f349baf207ac59f78857ab64529c890b646bb0282f962bb2941',
                        'options': {
                            'magicNumber': '400'
                        }
                    },
                    {
                        'id': './a',
                        'options': {}
                    }
                ]);
        });
    });
});
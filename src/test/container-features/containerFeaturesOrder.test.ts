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

        it('invalid circular dependency', async function () {
            const testFolder = `${baseTestConfigPath}/installsAfter/invalid-circular`;
            const { params, userFeatures, processFeature, config } = await setupInstallOrderTest(testFolder);

            const installOrderNodes = await computeDependsOnInstallationOrder(params, processFeature, userFeatures, config);
            assert.ok(!installOrderNodes);
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

        it('valid dependsOn with round sorting based on options', async function () {
            const testFolder = `${baseTestConfigPath}/dependsOn/local-with-options`;
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

            assert.deepStrictEqual(actual.length, 9);
            assert.deepStrictEqual(actual,
                [
                    {
                        userFeatureId: './b',
                        options: {}
                    },
                    {
                        userFeatureId: './b',
                        options: {
                            optA: 'a',
                            optB: 'a'
                        }
                    },
                    {
                        userFeatureId: './b',
                        options: {
                            optA: 'a',
                            optB: 'b'
                        }
                    },
                    {
                        userFeatureId: './b',
                        options: {
                            optA: 'b',
                            optB: 'a'
                        }
                    },
                    {
                        userFeatureId: './b',
                        options: {
                            optA: 'b',
                            optB: 'b'
                        }
                    },
                    {
                        userFeatureId: './d',
                        options: {}
                    },
                    {
                        userFeatureId: './e',
                        options: {}
                    },
                    {
                        userFeatureId: './c',
                        options: {}
                    },
                    {
                        userFeatureId: './a',
                        options: {
                            optA: 'a',
                            optB: 'b'
                        }
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

        it('valid dependsOn with published tgz and oci Features', async function () {
            const testFolder = `${baseTestConfigPath}/dependsOn/tgz-ab`;
            const { params, userFeatures, processFeature, config } = await setupInstallOrderTest(testFolder);

            const installOrderNodes = await computeDependsOnInstallationOrder(params, processFeature, userFeatures, config);
            if (!installOrderNodes) {
                assert.fail();
            }

            // Assert all sourceInformation is of type 'oci' or 'direct-tarball'
            assert.ok(installOrderNodes.every(fs => fs.sourceInformation.type === 'oci' || fs.sourceInformation.type === 'direct-tarball'));

            const actual = installOrderNodes.map(fs => {
                const srcInfo = fs.sourceInformation;
                switch (srcInfo.type) {
                    case 'oci':
                        return {
                            userFeatureId: fs.sourceInformation.userFeatureId,
                            options: fs.features[0].value,
                            canonicalId: `${srcInfo.featureRef.resource}@${srcInfo.manifestDigest}`
                        };
                    case 'direct-tarball':
                        return {
                            tarballUri: srcInfo.tarballUri,
                            options: fs.features[0].value,
                        };
                    default:
                        assert.fail();
                }
            });

            assert.deepStrictEqual(actual.length, 6);
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
                        userFeatureId: 'ghcr.io/codspace/dependson/A',
                        options: { magicNumber: '40' },
                        canonicalId: 'ghcr.io/codspace/dependson/a@sha256:932027ef71da186210e6ceb3294c3459caaf6b548d2b547d5d26be3fc4b2264a',
                    },
                    {
                        tarballUri: 'https://github.com/codspace/tgz-features-with-dependson/releases/download/0.0.2/devcontainer-feature-A.tgz',
                        options: { magicNumber: '10' },
                    },
                    {
                        userFeatureId: 'ghcr.io/codspace/dependson/C',
                        options: { magicNumber: '20' },
                        canonicalId: 'ghcr.io/codspace/dependson/c@sha256:db651708398b6d7af48f184c358728eaaf959606637133413cb4107b8454a868',
                    },
                    {
                        tarballUri: 'https://github.com/codspace/tgz-features-with-dependson/releases/download/0.0.2/devcontainer-feature-B.tgz',
                        options: { magicNumber: '400' }
                    }
                ]);
        });

        it('invalid circular dependency', async function () {
            const testFolder = `${baseTestConfigPath}/dependsOn/invalid-circular`;
            const { params, userFeatures, processFeature, config } = await setupInstallOrderTest(testFolder);

            const installOrderNodes = await computeDependsOnInstallationOrder(params, processFeature, userFeatures, config);
            assert.ok(!installOrderNodes);
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

        it('valid 3 overrides with file-path Feature where round priority beats independent feature', async function () {
            const testFolder = `${baseTestConfigPath}/overrideFeatureInstallOrder/local-roundPriority`;
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

            assert.deepStrictEqual(actual.length, 3);
            assert.deepStrictEqual(actual,
                [
                    {
                        userFeatureId: './a',
                        options: {}
                    },
                    {
                        userFeatureId: './b',
                        options: {}
                    },
                    {
                        userFeatureId: './c',
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

        it('valid 3 overrides with mixed v2 Feature types', async function () {
            const testFolder = `${baseTestConfigPath}/overrideFeatureInstallOrder/image-with-v2-features-with-overrideFeatureInstallOrder`;
            const { params, userFeatures, processFeature, config } = await setupInstallOrderTest(testFolder);

            const installOrderNodes = await computeDependsOnInstallationOrder(params, processFeature, userFeatures, config);
            if (!installOrderNodes) {
                assert.fail();
            }

            assert.ok(installOrderNodes.every(fs => fs.sourceInformation.type === 'file-path' || fs.sourceInformation.type === 'direct-tarball' || fs.sourceInformation.type === 'oci'));

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

            assert.deepStrictEqual(actual.length, 5);
            assert.deepStrictEqual(actual,
                [
                    {
                        id: './localFeatureA',
                        options: {
                            'greeting': 'buongiorno'
                        }
                    },
                    {
                        id: 'https://github.com/codspace/features/releases/download/tarball02/devcontainer-feature-docker-in-docker.tgz',
                        options: {
                            'version': 'latest'
                        }
                    },
                    {
                        id: 'ghcr.io/devcontainers/features/python@sha256:675f3c93e52fa4b205827e3aae744905ae67951f70e3ec2611f766304b31f4a2',
                        options: {
                            version: 'none'
                        }
                    },
                    {
                        id: './localFeatureB',
                        options: {
                            'greeting': 'buongiorno'
                        }
                    },
                    {
                        id: 'ghcr.io/codspace/features/python@sha256:e4034c2a24d6c5d1cc0f6cb03091fc72d4e89f5cc64fa692cb69b671c81633d2',
                        options: {
                            'version': 'none'
                        }
                    }
                ]
            );
        });

        it('valid 3 overrides with mixed v1 Feature types', async function () {
            const testFolder = `${baseTestConfigPath}/overrideFeatureInstallOrder/image-with-v1-features-with-overrideFeatureInstallOrder`;
            const { params, userFeatures, processFeature, config } = await setupInstallOrderTest(testFolder);

            const installOrderNodes = await computeDependsOnInstallationOrder(params, processFeature, userFeatures, config);
            if (!installOrderNodes) {
                assert.fail();
            }

            assert.ok(installOrderNodes.every(fs => fs.sourceInformation.type === 'github-repo' || fs.sourceInformation.type === 'direct-tarball' || fs.sourceInformation.type === 'oci'));

            const actual = installOrderNodes.map(fs => {
                switch (fs.sourceInformation.type) {
                    case 'oci':
                        const srcInfo = fs.sourceInformation as OCISourceInformation;
                        const ref = srcInfo.featureRef;
                        return {
                            id: ref.resource,
                            options: fs.features[0].value,
                        };
                    default:
                        return {
                            id: fs.sourceInformation.userFeatureId,
                            options: fs.features[0].value
                        };
                }
            });

            assert.deepStrictEqual(actual.length, 3);
            assert.deepStrictEqual(actual,
                [
                    {
                        id: 'codspace/features/devcontainer-feature-go@tarball02',
                        options: {}
                    },
                    {
                        id: 'codspace/myfeatures/helloworld',
                        options: {
                            greeting: 'howdy'
                        }
                    },
                    {
                        id: 'ghcr.io/devcontainers/features/terraform',
                        options: 'latest'
                    }
                ]
            );
        });


    });
});
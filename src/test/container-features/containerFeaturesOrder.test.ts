/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { FeatureSet, OCISourceInformation, processFeatureIdentifier, userFeaturesToArray } from '../../spec-configuration/containerFeaturesConfiguration';
import { computeDependsOnInstallationOrder, computeInstallationOrder, computeOverrideInstallationOrder } from '../../spec-configuration/containerFeaturesOrder';
import { URI } from 'vscode-uri';
import { devContainerDown, shellExec } from '../testUtils';
import path from 'path';
import { DevContainerConfig, DevContainerFeature } from '../../spec-configuration/configuration';
import { CommonParams } from '../../spec-configuration/containerCollectionsOCI';
import { LogLevel, createPlainLog, makeLog } from '../../spec-utils/log';
import { isLocalFile, readLocalFile } from '../../spec-utils/pfs';

const pkg = require('../../../package.json');
export const output = makeLog(createPlainLog(text => process.stdout.write(text), () => LogLevel.Info));

describe('dependsOn', function () {
    this.timeout('10s');

    const params: CommonParams = {
        env: process.env,
        output,
        cachedAuthHeader: {}
    };

    it('valid installation order with all OCI Features', async function () {
        const testFolder = `${__dirname}/configs/dependsOn/ab`;
        if (!(await isLocalFile(`${testFolder}/.devcontainer.json`))) {
            assert.fail();
        }
        const buffer = await readLocalFile(`${testFolder}/.devcontainer.json`);
        const config = JSON.parse(buffer.toString()) as DevContainerConfig;
        const userFeatures = userFeaturesToArray(config);

        if (!userFeatures) {
            assert.fail();
        }

        const processFeature = async (_userFeature: DevContainerFeature) => {
            return await processFeatureIdentifier(params, `${testFolder}/.devcontainer.json`, testFolder, _userFeature);
        };

        const installOrderNodes = await computeDependsOnInstallationOrder(params, processFeature, userFeatures);
        if (!installOrderNodes) {
            assert.fail();
        }

        // Assert all sourceInformation is of type 'oci'
        assert.ok(installOrderNodes.every(n => n.featureSet!.sourceInformation.type === 'oci'));


        const actual = installOrderNodes.map(n => {
            const srcInfo = n.featureSet!.sourceInformation as OCISourceInformation;
            return {
                userFeatureId: n.userFeatureId,
                options: n.options,
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
            ]
        );
    });
});

describe('Container features install order [before dependsOn]', function () {

    it('has stable order among independent features', () => {
        assert.deepEqual(
            computeInstallationOrder([
                installAfter('C'),
                installAfter('A'),
                installAfter('B'),
            ]).map(f => f.features[0].id),
            ['A', 'B', 'C']
        );
    });

    it('orders "installAfter" first in breadth-first order (tree)', () => {
        assert.deepEqual(
            computeInstallationOrder([
                installAfter('A', 'B'),
                installAfter('B', 'C'),
                installAfter('C'),
                installAfter('D', 'E'),
                installAfter('E', 'C'),
            ]).map(f => f.features[0].id),
            ['C', 'B', 'E', 'A', 'D']
        );
    });

    it('orders "installAfter" first in breadth-first order (DAG)', () => {
        assert.deepEqual(
            computeInstallationOrder([
                installAfter('A', 'B', 'C'),
                installAfter('B', 'C'),
                installAfter('C'),
                installAfter('D', 'C'),
            ]).map(f => f.features[0].id),
            ['C', 'B', 'D', 'A']
        );
    });

    it('treats "installAfter" is a soft dependency', () => {
        assert.deepEqual(
            computeInstallationOrder([
                installAfter('A', 'B', 'C'),
                installAfter('B'),
            ]).map(f => f.features[0].id),
            ['B', 'A']
        );
    });

    it('orders independent features last', () => {
        assert.deepEqual(
            computeInstallationOrder([
                installAfter('A'),
                installAfter('B', 'C'),
                installAfter('C'),
            ]).map(f => f.features[0].id),
            ['C', 'B', 'A']
        );
    });

    it('detects cycles', () => {
        try {
            computeInstallationOrder([
                installAfter('A', 'B'),
                installAfter('B'),
                installAfter('C', 'D'),
                installAfter('D', 'C'),
            ]);
            assert.fail('Cyclic dependency not detected.');
        } catch (err) {
            assert.ok(err instanceof Error);
            assert.ok(err.message.indexOf('cyclic'));
        }
    });

    it('respects OverrideConfig', () => {
        assert.deepEqual(
            computeOverrideInstallationOrder(
                { image: 'ubuntu', configFilePath: URI.from({ 'scheme': 'https' }), overrideFeatureInstallOrder: ['A', 'B', 'C'] },
                [
                    installAfter('A', 'C'),
                    installAfter('B', 'C'),
                    installAfter('C', 'D'),
                ]).map(f => f.features[0].id),
            ['A', 'B', 'C']
        );
    });

    it('respects overrideFeatureInstallOrder for OCI features', () => {
        const orderedFeatures = computeOverrideInstallationOrder(
            { image: 'ubuntu', configFilePath: URI.from({ 'scheme': 'https' }), overrideFeatureInstallOrder: ['ghcr.io/user/repo/node'] },
            [
                getOCIFeatureSet('ghcr.io/devcontainers/features/node:1'),
                getOCIFeatureSet('ghcr.io/user/repo/node:1')
            ]).map(f => f.sourceInformation.type === 'oci' ? f.sourceInformation.featureRef.resource : '');

        assert.equal(orderedFeatures[0], 'ghcr.io/user/repo/node');
        assert.equal(orderedFeatures[1], 'ghcr.io/devcontainers/features/node');
    });

    it('throws an error for features referenced in overrideFeatureInstallOrder without fully qualified id', () => {
        assert.throws(() => {
            computeOverrideInstallationOrder(
                { image: 'ubuntu', configFilePath: URI.from({ 'scheme': 'https' }), overrideFeatureInstallOrder: ['node'] },
                [
                    getOCIFeatureSet('ghcr.io/devcontainers/features/node:1'),
                    getOCIFeatureSet('ghcr.io/user/repo/node:1')
                ]);
        }, { message: 'Feature node not found' });
    });

    function installAfter(id: string, ...installsAfter: string[]): FeatureSet {
        return {
            sourceInformation: {
                type: 'local-cache',
                userFeatureId: id
            },
            features: [{
                id,
                name: id,
                installsAfter,
                value: true,
                included: true,
            }],
        };
    }

    function getOCIFeatureSet(id: string): FeatureSet {
        // example - ghcr.io/devcontainers/features/node:1
        const splitOnColon = id.split(':');
        const spiltOnSlash = splitOnColon[0].split('/');
        return {
            sourceInformation: {
                type: 'oci',
                featureRef: {
                    id: spiltOnSlash[3],
                    namespace: `${spiltOnSlash[1]}/${spiltOnSlash[2]}`,
                    owner: spiltOnSlash[1],
                    registry: spiltOnSlash[0],
                    resource: splitOnColon[0],
                    tag: splitOnColon[1],
                    version: splitOnColon[1],
                    path: `${spiltOnSlash[1]}/${spiltOnSlash[2]}/spiltOnSlash[3]`
                },
                manifest: {
                    schemaVersion: 123,
                    mediaType: 'test',
                    config: {
                        digest: 'test',
                        mediaType: 'test',
                        size: 100
                    },
                    layers: []
                },
                manifestDigest: 'test',
                userFeatureId: id,
                userFeatureIdWithoutVersion: splitOnColon[0]
            },
            features: [{
                id: spiltOnSlash[3],
                name: spiltOnSlash[3],
                value: true,
                included: true,
            }],
        };
    }
});

describe('test overrideFeatureInstall option', function() {
    this.timeout('500s');

    const tmp = path.relative(process.cwd(), path.join(__dirname, 'tmp'));
    const cli = `npx --prefix ${tmp} devcontainer`;

    before('Install', async () => {
        await shellExec(`rm -rf ${tmp}/node_modules`);
        await shellExec(`mkdir -p ${tmp}`);
        await shellExec(`npm --prefix ${tmp} install devcontainers-cli-${pkg.version}.tgz`);
    });

    describe('image-with-v2-features-with-overrideFeatureInstallOrder', function () {
        it('should succeed', async () => {
            const testFolder = `${__dirname}/configs/image-with-v2-features-with-overrideFeatureInstallOrder`;
            const res = await shellExec(`${cli} build --workspace-folder ${testFolder} --log-level trace`);
            const response = JSON.parse(res.stdout);
            assert.equal(response.outcome, 'success');
            const containerId = response.containerId;
            await devContainerDown({ containerId });
        });
    });

    describe('image-with-v1-features-with-overrideFeatureInstallOrder', function () {
        it('should succeed with --skip-feature-auto-mapping', async () => {
            const testFolder = `${__dirname}/configs/image-with-v1-features-with-overrideFeatureInstallOrder`;
            const res = await shellExec(`${cli} build --workspace-folder ${testFolder} --skip-feature-auto-mapping`);
            const response = JSON.parse(res.stdout);
            assert.equal(response.outcome, 'success');
            const containerId = response.containerId;
            await devContainerDown({ containerId });
        });

        it('should succeed without --skip-feature-auto-mapping', async () => {
            const testFolder = `${__dirname}/configs/image-with-v1-features-with-overrideFeatureInstallOrder`;
            const res = await shellExec(`${cli} build --workspace-folder ${testFolder}`);
            const response = JSON.parse(res.stdout);
            assert.equal(response.outcome, 'success');
            const containerId = response.containerId;
            await devContainerDown({ containerId });
        });
    });
});

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { FeatureSet } from '../../spec-configuration/containerFeaturesConfiguration';
import { computeDependsOnInstallationOrder, computeInstallationOrder, computeOverrideInstallationOrder } from '../../spec-configuration/containerFeaturesOrder';
import { URI } from 'vscode-uri';
import { devContainerDown, shellExec } from '../testUtils';
import path from 'path';
import { DevContainerConfig } from '../../spec-configuration/configuration';
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

    it('should resolve a valid dependency tree', async function () {
        const configFolder = `${__dirname}/configs/dependsOn/ab`;
        if (!(await isLocalFile(`${configFolder}/.devcontainer.json`))) {
            assert.fail();
        }
        const buffer = await readLocalFile(`${configFolder}/.devcontainer.json`);
        const config = JSON.parse(buffer.toString()) as DevContainerConfig;
        const installOrderNodes = await computeDependsOnInstallationOrder(params, config);
        if (!installOrderNodes) {
            assert.fail();
        }
        assert.deepStrictEqual(installOrderNodes.map(n => {
            return {
                id: n.id,
                canonicalId: n.canonicalId,
                options: n.options,
            };
        }),
            [
                {
                    id: 'ghcr.io/codspace/dependsOnExperiment/D',
                    options: { magicNumber: '30' },
                    canonicalId: 'ghcr.io/codspace/dependsonexperiment/d@sha256:a564cac1b4bac326ec0d5f7efabf5e1ffd37e99633462eb9e1c7cad41193fcb0',
                },
                {
                    id: 'ghcr.io/codspace/dependsOnExperiment/E',
                    options: { magicNumber: '50' },
                    canonicalId: 'ghcr.io/codspace/dependsonexperiment/e@sha256:0b0a20e11d24233de703135f9d3f4bf5f577ff63bb3e5b74634ccb9bc53ad4f9',
                },
                {
                    id: 'ghcr.io/codspace/dependsonexperiment/a',
                    options: { magicNumber: '10' },
                    canonicalId: 'ghcr.io/codspace/dependsonexperiment/a@sha256:651dbae53a21fe5bd790c8d1a54af414553408295d5639f9f4fc19359775f641',
                },
                {
                    id: 'ghcr.io/codspace/dependsOnExperiment/A',
                    options: { magicNumber: '40' },
                    canonicalId: 'ghcr.io/codspace/dependsonexperiment/a@sha256:651dbae53a21fe5bd790c8d1a54af414553408295d5639f9f4fc19359775f641',
                },
                {
                    id: 'ghcr.io/codspace/dependsOnExperiment/C',
                    options: { magicNumber: '20' },
                    canonicalId: 'ghcr.io/codspace/dependsonexperiment/c@sha256:828bbebde73e6f16455cb5da01f3f72ad3fe1c4619af2ed8b68a8af8ef70dcc8',
                },
                {
                    id: 'ghcr.io/codspace/dependsonexperiment/b',
                    options: { magicNumber: '400' },
                    canonicalId: 'ghcr.io/codspace/dependsonexperiment/b@sha256:ff19723761146ed90980c70fbe8d1ad6b3efd3e27c55f8972f8fe54ca0979d5a',
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

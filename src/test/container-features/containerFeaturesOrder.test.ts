/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { FeatureSet } from '../../spec-configuration/containerFeaturesConfiguration';
import { computeInstallationOrder, computeOverrideInstallationOrder } from '../../spec-configuration/containerFeaturesOrder';
import { URI } from 'vscode-uri';
import { devContainerDown, devContainerUp, shellExec, UpResult } from '../testUtils';
import path from 'path';

const pkg = require('../../../package.json');

describe('Container features install order', function () {
    this.timeout('500s');

    const tmp = path.relative(process.cwd(), path.join(__dirname, 'tmp'));
    const cli = `npx --prefix ${tmp} devcontainer`;

    before('Install', async () => {
        await shellExec(`rm -rf ${tmp}/node_modules`);
        await shellExec(`mkdir -p ${tmp}`);
        await shellExec(`npm --prefix ${tmp} install devcontainers-cli-${pkg.version}.tgz`);
    });

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

    describe('image-with-v2-features-with-overrideFeatureInstallOrder', function () {
        let upResult: UpResult | null = null;
        const testFolder = `${__dirname}/configs/image-with-v2-features-with-overrideFeatureInstallOrder`;
        before(async () => {
            // build and start the container
            upResult = await devContainerUp(cli, testFolder);
        });
        after(async () => await devContainerDown({ composeProjectName: upResult?.composeProjectName }));
        it('should succeed', () => {
            assert.equal(upResult!.outcome, 'success');
        });
    });

    describe('image-with-v1-features-with-overrideFeatureInstallOrder', function () {
        let upResult: UpResult | null = null;
        const testFolder = `${__dirname}/configs/image-with-v1-features-with-overrideFeatureInstallOrder`;
        before(async () => {
            // build and start the container
            upResult = await devContainerUp(cli, testFolder);
        });
        after(async () => await devContainerDown({ composeProjectName: upResult?.composeProjectName }));
        it('should succeed', () => {
            assert.equal(upResult!.outcome, 'success');
        });
    });

    function installAfter(id: string, ...installAfter: string[]): FeatureSet {
        return {
            sourceInformation: {
                type: 'local-cache',
                referenceId: id
            },
            features: [{
                id,
                name: id,
                installAfter,
                value: true,
                included: true,
            }],
        };
    }

    function getOCIFeatureSet(id: string): FeatureSet {
        // example - ghcr.io/devcontainers/features/node:1
        const splitOnCollon = id.split(':');
        const spiltOnSlash = splitOnCollon[0].split('/');
        return {
            sourceInformation: {
                type: 'oci',
                featureRef: {
                    id: spiltOnSlash[3],
                    namespace: `${spiltOnSlash[1]}/${spiltOnSlash[2]}`,
                    owner: spiltOnSlash[1],
                    registry: spiltOnSlash[0],
                    resource: splitOnCollon[0],
                    version: splitOnCollon[1]
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
                referenceId: id
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

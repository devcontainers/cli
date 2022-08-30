import { assert } from 'chai';
import { generateFeaturesConfig, getFeatureLayers, FeatureSet, getContainerFeaturesFolder } from '../../spec-configuration/containerFeaturesConfiguration';
import { createPlainLog, LogLevel, makeLog } from '../../spec-utils/log';
import * as path from 'path';
import { mkdirpLocal } from '../../spec-utils/pfs';
import { DevContainerConfig } from '../../spec-configuration/configuration';
import { URI } from 'vscode-uri';
import { getLocalCacheFolder } from '../../spec-node/utils';

export const output = makeLog(createPlainLog(text => process.stdout.write(text), () => LogLevel.Trace));

// Test fetching/generating the devcontainer-features.json config
describe('validate generateFeaturesConfig()', function () {

    // Setup
    const env = { 'SOME_KEY': 'SOME_VAL' };
    const params = { extensionPath: '', cwd: '', output, env, persistedFolder: '', skipFeatureAutoMapping: false };

    // Mocha executes with the root of the project as the cwd.
    const localFeaturesFolder = (_: string) => {
        return './src/test/container-features/example-v1-features-sets/simple';
    };

    it('should correctly return a featuresConfig with just local features', async function () {

        const version = 'unittest';
        const tmpFolder: string = path.join(await getLocalCacheFolder(), 'container-features', `${version}-${Date.now()}`);
        await mkdirpLocal(tmpFolder);


        const config: DevContainerConfig = {
            configFilePath: URI.from({ 'scheme': 'https' }),
            dockerFile: '.',
            features: {
                first: {
                    'version': 'latest'
                },
                second: {
                    'value': true
                },
            },
        };

        const featuresConfig = await generateFeaturesConfig(params, tmpFolder, config, localFeaturesFolder);
        if (!featuresConfig) {
            assert.fail();
        }

        assert.strictEqual(featuresConfig?.featureSets.length, 2);

        const first = featuresConfig.featureSets[0].features.find((f) => f.id === 'first');
        assert.exists(first);

        const second = featuresConfig.featureSets[1].features.find((f) => f.id === 'second');
        assert.exists(second);

        assert.isObject(first?.value);
        assert.isObject(second?.value);

        // -- Test containerFeatures.ts helper functions

        // generateContainerEnvs
        // TODO
        //         const actualEnvs = generateContainerEnvs(featuresConfig);
        //         const expectedEnvs = `ENV MYKEYONE=MYRESULTONE
        // ENV MYKEYTHREE=MYRESULTHREE`;
        //         assert.strictEqual(actualEnvs, expectedEnvs);

        // getFeatureLayers
        const actualLayers = getFeatureLayers(featuresConfig);
        const expectedLayers = `RUN cd /tmp/build-features/first_1 \\
&& chmod +x ./install.sh \\
&& ./install.sh

RUN cd /tmp/build-features/second_2 \\
&& chmod +x ./install.sh \\
&& ./install.sh

`;
        assert.strictEqual(actualLayers, expectedLayers);
    });

    it('should correctly return featuresConfig with customizations', async function () {
        this.timeout('10s');
        const version = 'unittest';
        const tmpFolder: string = path.join(await getLocalCacheFolder(), 'container-features', `${version}-${Date.now()}`);
        await mkdirpLocal(tmpFolder);

        const config: DevContainerConfig = {
            configFilePath: URI.from({ 'path': './src/test/container-features/configs/dockerfile-with-v2-local-features-config-inside-dev-container-folder', scheme: 'file' }),
            dockerFile: '.',
            features: {
                node: {
                    'version': 'none'
                },
                'ghcr.io/devcontainers/features/docker-in-docker:1': {
                    'version': 'latest'
                },
                'ghcr.io/devcontainers/features/java:1': {
                    'version': 'none'
                },
                '/local-features/localFeatureA': {
                    'greeting': 'buongiorno'
                },
                './src/test/container-features/configs/dockerfile-with-v2-local-features-config-inside-dev-container-folder/local-features/localFeatureB': {
                    'favorite': 'gold'
                }
            },
        };

        params.skipFeatureAutoMapping = true;

        const featuresConfig = await generateFeaturesConfig(params, tmpFolder, config, getContainerFeaturesFolder);
        if (!featuresConfig) {
            assert.fail();
        }

        assert.strictEqual(featuresConfig?.featureSets.length, 5);

        const dind = featuresConfig.featureSets.find((f: FeatureSet) => f?.features[0]?.id === 'docker-in-docker');
        assert.exists(dind);
        const dindExtensions = dind?.features[0]?.customizations?.vscode?.extensions || [''];
        assert.includeMembers(dindExtensions, ['ms-azuretools.vscode-docker']);

        const node = featuresConfig.featureSets.find((f: FeatureSet) => f?.features[0]?.id === 'node');
        assert.exists(node);
        const nodeExtensions = node?.features[0]?.customizations?.vscode?.extensions || [''];
        assert.includeMembers(nodeExtensions, ['dbaeumer.vscode-eslint']);

        const java = featuresConfig.featureSets.find((f: FeatureSet) => f?.features[0]?.id === 'java');
        assert.exists(java);
        const javaExtensions = java?.features[0]?.customizations?.vscode?.extensions || [''];
        assert.includeMembers(javaExtensions, ['vscjava.vscode-java-pack']);
        const javaSettings = java?.features[0]?.customizations?.vscode?.settings;
        assert.isObject(javaSettings);

        const featureA = featuresConfig.featureSets.find((f: FeatureSet) => f?.features[0]?.id === 'localFeatureA');
        assert.exists(featureA);
        const featureAExtensions = featureA?.features[0]?.customizations?.vscode?.extensions || [''];
        assert.includeMembers(featureAExtensions, ['dbaeumer.vscode-eslint']);
        const featureASettings = featureA?.features[0]?.customizations?.vscode?.settings;
        assert.isObject(featureASettings);

        // With top level "extensions" and "settings"
        const featureB = featuresConfig.featureSets.find((f: FeatureSet) => f?.features[0]?.id === 'localFeatureB');
        assert.exists(featureB);
        const featureBExtensions = featureB?.features[0]?.customizations?.vscode?.extensions || [''];
        assert.includeMembers(featureBExtensions, ['ms-dotnettools.csharp']);
        const featureBSettings = featureB?.features[0]?.customizations?.vscode?.settings;
        assert.isObject(featureBSettings);
    });
});

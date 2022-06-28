import { assert } from 'chai';
import { generateFeaturesConfig, getFeatureLayers } from '../../spec-configuration/containerFeaturesConfiguration';
import { createPlainLog, LogLevel, makeLog } from '../../spec-utils/log';
import * as path from 'path';
import { mkdirpLocal } from '../../spec-utils/pfs';
import { DevContainerConfig } from '../../spec-configuration/configuration';
import { URI } from 'vscode-uri';
import { getLocalCacheFolder } from '../../spec-node/utils';

export const output = makeLog(createPlainLog(text => process.stdout.write(text), () => LogLevel.Trace));

// Test fetching/generating the devcontainer-features.json config
describe('validate (offline) generateFeaturesConfig()', function () {

    // Setup
    const env = { 'SOME_KEY': 'SOME_VAL' };
    const params = { extensionPath: '', cwd: '', output, env, persistedFolder: '' };

    // Mocha executes with the root of the project as the cwd.
    const localFeaturesFolder = (_: string) => {
        return './src/test/container-features/example-features-sets/simple';
    };

    const labels = async () => {
        const record: Record<string, string | undefined> = {
            'com.visualstudio.code.devcontainers.id': 'ubuntu',
            'com.visualstudio.code.devcontainers.release': 'v0.194.2',
            'com.visualstudio.code.devcontainers.source': 'https://github.com/microsoft/vscode-dev-containers/',
            'com.visualstudio.code.devcontainers.timestamp': 'Fri, 03 Sep 2021 03:00:16 GMT',
            'com.visualstudio.code.devcontainers.variant': 'focal',
        };
        return record;
    };

    it('should correctly return a featuresConfig with just local features', async function () {

        const version = 'unittest';
        const tmpFolder: string = path.join(getLocalCacheFolder(), 'container-features', `${version}-${Date.now()}`);
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

        const featuresConfig = await generateFeaturesConfig(params, tmpFolder, config, labels, localFeaturesFolder);
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
        const actualLayers = await getFeatureLayers(featuresConfig);
        const expectedLayers = `RUN cd /tmp/build-features/first_1 \\
&& chmod +x ./install.sh \\
&& ./install.sh

RUN cd /tmp/build-features/second_2 \\
&& chmod +x ./install.sh \\
&& ./install.sh

`;
        assert.strictEqual(actualLayers, expectedLayers);
    });



});
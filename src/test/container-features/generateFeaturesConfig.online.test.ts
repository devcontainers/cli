import { assert } from 'chai';
import { generateFeaturesConfig } from '../../spec-configuration/containerFeaturesConfiguration';
import { createPlainLog, LogLevel, makeLog } from '../../spec-utils/log';
import * as os from 'os';
import * as path from 'path';
import { mkdirpLocal } from '../../spec-utils/pfs';
import { DevContainerConfig } from '../../spec-configuration/configuration';
import { URI } from 'vscode-uri';

export const output = makeLog(createPlainLog(text => process.stdout.write(text), () => LogLevel.Trace));

// Test fetching/generating the devcontainer-features.json config
describe('validate online functionality of generateFeaturesConfig() ', function () {

    // Setup
    const env = { 'SOME_KEY': 'SOME_VAL' };
    const params = { extensionPath: '', output, env, persistedFolder: '' };

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

    it('should correct return a featuresConfig fetched from a remote tgz', async function () {
        const version = 'unittest2';
        const tmpFolder: string = path.join(os.tmpdir(), 'vsch', 'container-features', `${version}-${Date.now()}`);
        await mkdirpLocal(tmpFolder);

        const config: DevContainerConfig = {
            configFilePath: URI.from({ 'scheme': 'https' }),
            dockerFile: '.',
            features: {
                'https://github.com/codspace/myfeatures/releases/latest/download/devcontainer-features.tgz#helloworld': {
                    'greeting': 'howdy'
                },
                third: 'latest'
            },
        };
        const featuresConfig = await generateFeaturesConfig(params, tmpFolder, config, labels, localFeaturesFolder);

        assert.exists(featuresConfig);

        assert.strictEqual(featuresConfig?.featureSets
            .map(x => x.features)
            .flat()
            .length, 4);

        // Get the sets
        const localSet = featuresConfig?.featureSets.find(x => x.sourceInformation.type === 'local-cache');
        assert.exists(localSet);
        assert.exists(localSet?.features.find(x => x.id === 'third'));
        const tarballSet = featuresConfig?.featureSets.find(x => x.sourceInformation.type === 'direct-tarball');
        assert.exists(tarballSet);
        assert.exists(tarballSet?.features.find(x => x.id === 'helloworld'));
    });

    it('should correctly return a featuresConfig with github-hosted remote features from two remote repos', async function () {

        const version = 'unittest3';
        const tmpFolder: string = path.join(os.tmpdir(), 'vsch', 'container-features', `${version}-${Date.now()}`);
        await mkdirpLocal(tmpFolder);

        const config: DevContainerConfig = {
            configFilePath: URI.from({ 'scheme': 'https' }),
            dockerFile: '.',
            features: {
                'codspace/myfeatures/helloworld': {
                    'greeting': 'howdy'
                },
                'codspace/myotherfeatures/helloworld': {
                    'greeting': 'heythere'
                },
                third: 'latest'
            },
        };

        const featuresConfig = await generateFeaturesConfig(params, tmpFolder, config, labels, localFeaturesFolder);

        assert.exists(featuresConfig);
        // 3 local features + 1 from codspace/myfeatures + 1 from codspace/myotherfeatures == 5
        assert.strictEqual(featuresConfig?.featureSets
            .map(x => x.features)
            .flat()
            .length, 5);

        // Get the sets
        const localSet = featuresConfig?.featureSets.find(x => x.sourceInformation.type === 'local-cache');
        assert.exists(localSet);
        const myfeaturesSet = featuresConfig?.featureSets
            .find(x =>
                x.sourceInformation.type === 'github-repo' &&
                x.sourceInformation.repo === 'myfeatures');
        assert.exists(myfeaturesSet);
        const myotherFeaturesSet = featuresConfig?.featureSets
            .find(x =>
                x.sourceInformation.type === 'github-repo' &&
                x.sourceInformation.repo === 'myotherfeatures');
        assert.exists(myotherFeaturesSet);
    });
});
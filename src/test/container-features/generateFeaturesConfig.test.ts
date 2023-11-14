import { assert } from 'chai';
import { generateFeaturesConfig, getFeatureLayers, FeatureSet } from '../../spec-configuration/containerFeaturesConfiguration';
import { createPlainLog, LogLevel, makeLog } from '../../spec-utils/log';
import * as path from 'path';
import * as process from 'process';
import * as os from 'os';
import * as crypto from 'crypto';
import { mkdirpLocal } from '../../spec-utils/pfs';
import { DevContainerConfig } from '../../spec-configuration/configuration';
import { URI } from 'vscode-uri';
import { getLocalCacheFolder } from '../../spec-node/utils';
import { shellExec } from '../testUtils';
import { getEntPasswdShellCommand } from '../../spec-common/commonUtils';

export const output = makeLog(createPlainLog(text => process.stdout.write(text), () => LogLevel.Trace));

// Test fetching/generating the devcontainer-features.json config
describe('validate generateFeaturesConfig()', function () {

    // Setup
    const env = { 'SOME_KEY': 'SOME_VAL' };
    const platform = process.platform;
	const cacheFolder = path.join(os.tmpdir(), `devcontainercli-test-${crypto.randomUUID()}`);
    const params = { extensionPath: '', cwd: '', output, env, cacheFolder, persistedFolder: '', skipFeatureAutoMapping: false, platform };

    it('should correctly return a featuresConfig with v2 local features', async function () {
        const version = 'unittest';
        const tmpFolder: string = path.join(await getLocalCacheFolder(), 'container-features', `${version}-${Date.now()}`);
        await mkdirpLocal(tmpFolder);

        const devcontainerFolder = path.resolve(tmpFolder, '.devcontainer');
        await mkdirpLocal(devcontainerFolder);
        await shellExec(`cp -R ./src/test/container-features/example-v2-features-sets/simple/src/* ${devcontainerFolder}`);

        const config: DevContainerConfig = {
            configFilePath: URI.from({ 'path': path.resolve(devcontainerFolder, 'devcontainer.json'), scheme: 'file' }),
            dockerFile: '.',
            features: {
                './color': {
                    'favorite': 'gold'
                },
                './hello': {
                    'greeting': 'howdy'
                },
            },
        };
        
        const featuresConfig = await generateFeaturesConfig({ ...params, cwd: tmpFolder }, tmpFolder, config, {});
        if (!featuresConfig) {
            assert.fail();
        }

        assert.strictEqual(featuresConfig?.featureSets.length, 2);

        const first = featuresConfig.featureSets[0].features.find((f) => f.id === 'color');
        assert.exists(first);

        const second = featuresConfig.featureSets[1].features.find((f) => f.id === 'hello');
        assert.exists(second);

        assert.isObject(first?.value);
        assert.isObject(second?.value);

        // -- Test containerFeatures.ts helper functions

        // getFeatureLayers
        const actualLayers = getFeatureLayers(featuresConfig, 'testContainerUser', 'testRemoteUser');
        const expectedLayers = `RUN \\
echo "_CONTAINER_USER_HOME=$(${getEntPasswdShellCommand('testContainerUser')} | cut -d: -f6)" >> /tmp/dev-container-features/devcontainer-features.builtin.env && \\
echo "_REMOTE_USER_HOME=$(${getEntPasswdShellCommand('testRemoteUser')} | cut -d: -f6)" >> /tmp/dev-container-features/devcontainer-features.builtin.env


COPY --chown=root:root --from=dev_containers_feature_content_source /tmp/build-features/color_0 /tmp/dev-container-features/color_0
RUN chmod -R 0755 /tmp/dev-container-features/color_0 \\
&& cd /tmp/dev-container-features/color_0 \\
&& chmod +x ./devcontainer-features-install.sh \\
&& ./devcontainer-features-install.sh


COPY --chown=root:root --from=dev_containers_feature_content_source /tmp/build-features/hello_1 /tmp/dev-container-features/hello_1
RUN chmod -R 0755 /tmp/dev-container-features/hello_1 \\
&& cd /tmp/dev-container-features/hello_1 \\
&& chmod +x ./devcontainer-features-install.sh \\
&& ./devcontainer-features-install.sh

`;
        assert.strictEqual(actualLayers, expectedLayers);
    });

    it('should correctly return featuresConfig with customizations', async function () {
        this.timeout('20s');
        const version = 'unittest';
        const tmpFolder: string = path.join(await getLocalCacheFolder(), 'container-features', `${version}-${Date.now()}`);
        await mkdirpLocal(tmpFolder);

        const config: DevContainerConfig = {
            configFilePath: URI.from({ 'path': './.devcontainer/devcontainer.json', scheme: 'file' }),
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
                }
            },
        };

        params.skipFeatureAutoMapping = true;

        const featuresConfig = await generateFeaturesConfig(params, tmpFolder, config, {});
        if (!featuresConfig) {
            assert.fail();
        }

        assert.strictEqual(featuresConfig?.featureSets.length, 3);

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
    });
});
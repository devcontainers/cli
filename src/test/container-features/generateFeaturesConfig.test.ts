import { assert } from 'chai';
import { generateFeaturesConfig, getFeatureLayers, getContainerFeaturesBaseDockerFile, FeatureSet } from '../../spec-configuration/containerFeaturesConfiguration';
import { createPlainLog, LogLevel, makeLog, nullLog } from '../../spec-utils/log';
import * as path from 'path';
import * as process from 'process';
import * as os from 'os';
import * as crypto from 'crypto';
import { mkdirpLocal, readLocalFile } from '../../spec-utils/pfs';
import { DevContainerConfig } from '../../spec-configuration/configuration';
import { URI } from 'vscode-uri';
import { getLocalCacheFolder } from '../../spec-node/utils';
import { createTestCommonParams, findFromArgsWithoutDefault, shellExec } from '../testUtils';
import { getEntPasswdShellCommand } from '../../spec-common/commonUtils';
import { createDockerParams } from '../../spec-node/devContainers';
import { staticProvisionParams } from '../../spec-node/featuresCLI/utils';
import { getExtendImageBuildInfo } from '../../spec-node/containerFeatures';
import { CLIVariant } from '../../spec-shutdown/dockerUtils';
import { PassThrough } from 'stream';
import * as fs from 'fs/promises';

export const output = makeLog(createPlainLog(text => process.stdout.write(text), () => LogLevel.Trace));

describe('Feature content transport', function () {
    this.timeout(20000);

    for (const mode of ['copy', 'mount', 'no-buildkit'] as const) {
        it(`keeps content images, contexts and installer paths consistent in ${mode} mode`, async () => {
            const disposables: (() => Promise<unknown> | undefined)[] = [];
            let workspaceFolder: string | undefined;
            try {
                workspaceFolder = await fs.mkdtemp(path.join(os.tmpdir(), 'feature-transport-'));
                await fs.cp(path.resolve(__dirname, 'example-v2-features-sets/simple/src'), path.join(workspaceFolder, '.devcontainer'), { recursive: true });
                const params = await createDockerParams({
                    ...staticProvisionParams,
                    dockerPath: process.execPath,
                    dockerArgs: ['-e', 'process.stdout.write("Docker 28.0.0")', '--'],
                    workspaceFolder, persistedFolder: os.tmpdir(),
                    mountWorkspaceGitRoot: false, mountGitWorktreeCommonDir: false,
                    log: () => { }, logLevel: LogLevel.Error,
                    remoteEnv: {}, additionalLabels: [], dotfiles: {},
                    skipFeatureAutoMapping: false, skipPersistingCustomizationsFromFeatures: false,
                }, disposables);
                params.isTTY = false;
                const calls: string[][] = [];
                const hostExec = params.common.cliHost.exec;
                params.common.cliHost = {
                    ...params.common.cliHost,
                    exec: async options => {
                        if (options.cmd !== 'selected-engine' && options.cmd !== 'getenforce') {
                            return hostExec(options);
                        }
                        calls.push([options.cmd, ...options.args || []]);
                        const stdout = new PassThrough();
                        const stderr = new PassThrough();
                        return {
                            stdin: new PassThrough(), stdout, stderr,
                            exit: new Promise(resolve => setImmediate(() => {
                                stdout.end('Disabled');
                                stderr.end();
                                resolve({ code: 0, signal: null });
                            })),
                            terminate: async () => { },
                        };
                    },
                };
                params.common.output = nullLog;
                params.noLockfile = true;
                params.dockerCLI = 'selected-engine';
                params.dockerArgs = ['--connection', 'test'];
                params.cliVariant = CLIVariant.Podman;
                params.useFeatureCopyFallback = mode === 'copy';
                params.buildKitVersion = mode === 'no-buildkit' ? undefined : { versionString: '0.12.0', versionMatch: '0.12.0' };
                const config: DevContainerConfig = {
                    configFilePath: URI.file(path.join(workspaceFolder, '.devcontainer/devcontainer.json')),
                    image: 'debian:bookworm-slim',
                    features: { './color': { favorite: 'green' }, './hello': { greeting: 'hello' } },
                };
                const result = await getExtendImageBuildInfo(params, { config, raw: config, substitute: value => value }, 'debian:bookworm-slim', {
                    user: 'root', metadata: { config: [], raw: [], substitute: value => value },
                }, undefined, {}, false);
                const build = result?.featureBuildInfo;
                assert.exists(build);
                const contentBuilds = calls.filter(call => call.includes('build'));
                if (mode === 'mount') {
                    assert.deepEqual(build!.buildKitContexts, { dev_containers_feature_content_source: build!.dstFolder });
                    assert.lengthOf(contentBuilds, 0);
                    assert.include(build!.dockerfileContent, 'RUN --mount=type=bind,from=dev_containers_feature_content_source,source=color_0,');
                    assert.notInclude(build!.dockerfileContent, 'FROM dev_container_feature_content_temp');
                } else {
                    assert.deepEqual(build!.buildKitContexts, {});
                    assert.lengthOf(contentBuilds, 1);
                    assert.deepEqual(contentBuilds[0], ['selected-engine', '--connection', 'test', 'build', '-t', 'dev_container_feature_content_temp', '-f', path.join(build!.dstFolder, 'Dockerfile.buildContent'), build!.dstFolder]);
                    assert.include(build!.dockerfileContent, 'FROM dev_container_feature_content_temp as dev_containers_feature_content_source');
                    assert.include(build!.dockerfileContent, 'COPY --chown=root:root --from=dev_containers_feature_content_source /tmp/build-features/color_0');
                    assert.notInclude(build!.dockerfileContent, 'RUN --mount');
                }
                assert.include(build!.dockerfileContent, 'hello_1');
                assert.strictEqual((build!.dockerfileContent.match(/&&? \.\/devcontainer-features-install.sh/g) || []).length, 2);
                assert.isBelow(build!.dockerfileContent.indexOf('color_0'), build!.dockerfileContent.indexOf('hello_1'));
                assert.strictEqual(params.buildKitVersion?.versionMatch, mode === 'no-buildkit' ? undefined : '0.12.0');
            } finally {
                try {
                    await Promise.all(disposables.map(dispose => dispose()));
                } finally {
                    if (workspaceFolder) {
                        await fs.rm(workspaceFolder, { recursive: true, force: true });
                    }
                }
            }
        });
    }
});

// Testing fetching/generating the devcontainer-features.json config
describe('validate generateFeaturesConfig()', function () {

    // Setup for tests
    const env = { 'SOME_KEY': 'SOME_VAL' };
    const platform = process.platform;
	const cacheFolder = path.join(os.tmpdir(), `devcontainercli-test-${crypto.randomUUID()}`);
    const params = { ...createTestCommonParams(output, env), extensionPath: '', cwd: '', cacheFolder, persistedFolder: '', skipFeatureAutoMapping: false, platform, noLockfile: true };

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
        this.timeout('40s');
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

describe('validate generated Dockerfiles avoid InvalidDefaultArgInFrom', function () {

    it('feature base Dockerfile declares _DEV_CONTAINERS_BASE_IMAGE with a default before FROM', function () {
        const dockerfile = getContainerFeaturesBaseDockerFile('/tmp/build-features');
        assert.match(dockerfile, /ARG _DEV_CONTAINERS_BASE_IMAGE=\S+/, 'ARG should have a default value');
        assert.match(dockerfile, /FROM \$_DEV_CONTAINERS_BASE_IMAGE\b/, 'FROM should reference the ARG directly');
        assert.notMatch(dockerfile, /FROM \$\{_DEV_CONTAINERS_BASE_IMAGE:-/, 'should not rely on ${VAR:-default} shell fallback');
        assert.deepStrictEqual(findFromArgsWithoutDefault(dockerfile), []);
    });

    it('validate that updateUID.Dockerfile declares BASE_IMAGE with a default before FROM', async function () {
        const content = (await readLocalFile('scripts/updateUID.Dockerfile')).toString();
        assert.match(content, /ARG BASE_IMAGE=\S+/, 'BASE_IMAGE ARG should have a default value');
        assert.deepStrictEqual(
            findFromArgsWithoutDefault(content),
            [],
            'updateUID.Dockerfile FROM references an ARG without a default'
        );
    });
});
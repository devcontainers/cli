import { assert } from 'chai';
import path from 'path';
import { DevContainerFeature } from '../../spec-configuration/configuration';
import { getBackwardCompatibleFeatureId, getSourceInfoString, processFeatureIdentifier, SourceInformation } from '../../spec-configuration/containerFeaturesConfiguration';
import { getSafeId } from '../../spec-node/containerFeatures';
import { createPlainLog, LogLevel, makeLog } from '../../spec-utils/log';
export const output = makeLog(createPlainLog(text => process.stdout.write(text), () => LogLevel.Trace));

describe('getIdSafe should return safe environment variable name', function () {

    it('should replace a "-" with "_"', function () {
        const ex = 'option-name';
        assert.strictEqual(getSafeId(ex), 'OPTION_NAME');
    });

    it('should replace all "-" with "_"', function () {
        const ex = 'option1-name-with_dashes-';
        assert.strictEqual(getSafeId(ex), 'OPTION1_NAME_WITH_DASHES_');
    });

    it('should only be capitalized if no special characters', function () {
        const ex = 'myOptionName';
        assert.strictEqual(getSafeId(ex), 'MYOPTIONNAME');
    });

    it('should delete a leading numbers and add a _', function () {
        const ex = '1name';
        assert.strictEqual(getSafeId(ex), '_NAME');
    });

    it('should delete all leading numbers and add a _', function () {
        const ex = '12345_option-name';
        assert.strictEqual(getSafeId(ex), '_OPTION_NAME');
    });
});

describe('validate function parseRemoteFeatureToDownloadUri', function () {

    // // -- Valid 

    const cwd = process.cwd();
    console.log(`cwd: ${cwd}`);

    it('should parse local features and return an undefined tarballUrl', async function () {
        const feature: DevContainerFeature = {
            id: 'helloworld',
            options: {},
        };

        const result = await processFeatureIdentifier(output, process.env, cwd, feature);
        assert.exists(result);
        assert.strictEqual(result?.features[0].id, 'helloworld');
        assert.strictEqual(result?.sourceInformation.type, 'local-cache');
    });

    it('should parse gitHub without version', async function () {
        const feature: DevContainerFeature = {
            id: 'octocat/myfeatures/helloworld',
            options: {},
        };
        const result = await processFeatureIdentifier(output, process.env, cwd, feature);
        assert.exists(result);
        assert.strictEqual(result?.features[0].id, 'helloworld');
        assert.deepEqual(result?.sourceInformation, {
            type: 'github-repo',
            owner: 'octocat',
            repo: 'myfeatures',
            apiUri: 'https://api.github.com/repos/octocat/myfeatures/releases/latest',
            unauthenticatedUri: 'https://github.com/octocat/myfeatures/releases/latest/download',
            isLatest: true
                                                    });
    });

    it('should parse gitHub with version', async function () {
        const feature: DevContainerFeature = {
            id: 'octocat/myfeatures/helloworld@v0.0.4',
            options: {},
        };

        const result = await processFeatureIdentifier(output, process.env, cwd, feature);
        assert.exists(result);
        assert.strictEqual(result?.features[0].id, 'helloworld');
        assert.deepEqual(result?.sourceInformation, {
            type: 'github-repo',
            owner: 'octocat',
            repo: 'myfeatures',
            tag: 'v0.0.4',
            apiUri: 'https://api.github.com/repos/octocat/myfeatures/releases/tags/v0.0.4',
            unauthenticatedUri: 'https://github.com/octocat/myfeatures/releases/download/v0.0.4',
            isLatest: false
        });
    });

    it('should parse generic tar', async function () {
        const feature: DevContainerFeature = {
            id: 'https://example.com/some/long/path/devcontainer-features.tgz#helloworld',
            options: {},
        };

        const result = await processFeatureIdentifier(output, process.env, cwd, feature);
        assert.exists(result);
        assert.strictEqual(result?.features[0].id, 'helloworld');
        assert.deepEqual(result?.sourceInformation, { type: 'direct-tarball', tarballUri: 'https://example.com/some/long/path/devcontainer-features.tgz' });
    });

    it('should parse when provided a local-filesystem relative path', async function () {
        const feature: DevContainerFeature = {
            id: './some/long/path/to/helloworld',
            options: {},
        };

        const result = await processFeatureIdentifier(output, process.env, cwd, feature);
        assert.exists(result);
        assert.strictEqual(result?.features[0].id, 'helloworld');
        assert.deepEqual(result?.sourceInformation, { type: 'file-path', resolvedFilePath: path.join(cwd, '/some/long/path/to/helloworld') });
    });


    it('should parse when provided a local-filesystem relative path, starting with ../', async function () {
        const feature: DevContainerFeature = {
            id: '../some/long/path/to/helloworld',
            options: {},
        };

        const result = await processFeatureIdentifier(output, process.env, cwd, feature);
        
        assert.exists(result);
        assert.strictEqual(result?.features[0].id, 'helloworld');
        assert.deepEqual(result?.sourceInformation, { type: 'file-path', resolvedFilePath: path.join(path.dirname(cwd), '/some/long/path/to/helloworld') });
    });

    it('should parse when provided a local-filesystem absolute path', async function () {
        const feature: DevContainerFeature = {
            id: '/some/long/path/to/helloworld',
            options: {},
        };
        const result = await processFeatureIdentifier(output, process.env, cwd, feature);
        assert.exists(result);
        assert.strictEqual(result?.features[0].id, 'helloworld');
        assert.deepEqual(result?.sourceInformation, { type: 'file-path', resolvedFilePath: '/some/long/path/to/helloworld' });
    });


    // -- Invalid

    it('should fail parsing a generic tar with no feature and trailing slash', async function () {
        const feature: DevContainerFeature = {
            id: 'https://example.com/some/long/path/devcontainer-features.tgz/',
            options: {},
        };

        const result = await processFeatureIdentifier(output, process.env, cwd, feature);
        assert.notExists(result);
    });

    it('should not parse gitHub without triple slash', async function () {
        const feature: DevContainerFeature = {
            id: 'octocat/myfeatures#helloworld',
            options: {},
        };

        const result = await processFeatureIdentifier(output, process.env, cwd, feature);
        assert.notExists(result);
    });

    it('should fail parsing a generic tar with no feature and no trailing slash', async function () {
        const feature: DevContainerFeature = {
            id: 'https://example.com/some/long/path/devcontainer-features.tgz',
            options: {},
        };

        const result = await processFeatureIdentifier(output, process.env, cwd, feature);
        assert.notExists(result);
    });

    it('should fail parsing a generic tar with a hash but no feature', async function () {
        const feature: DevContainerFeature = {
            id: 'https://example.com/some/long/path/devcontainer-features.tgz#',
            options: {},
        };

        const result = await processFeatureIdentifier(output, process.env, cwd, feature);
        assert.notExists(result);
    });

    it('should fail parsing a marketplace shorthand with only two segments and a hash with no feature', async function () {
        const feature: DevContainerFeature = {
            id: 'octocat/myfeatures#',
            options: {},
        };

        const result = await processFeatureIdentifier(output, process.env, cwd, feature);
        assert.notExists(result);
    });

    it('should fail parsing a marketplace shorthand with only two segments (no feature)', async function () {
        const feature: DevContainerFeature = {
            id: 'octocat/myfeatures',
            options: {},
        };

        const result = await processFeatureIdentifier(output, process.env, cwd, feature);
        assert.notExists(result);
    });

    it('should fail parsing a marketplace shorthand with an invalid feature name (1)', async function () {
        const feature: DevContainerFeature = {
            id: 'octocat/myfeatures/@mycoolfeature',
            options: {},
        };

        const result = await processFeatureIdentifier(output, process.env, cwd, feature);
        assert.notExists(result);
    });

    it('should fail parsing a marketplace shorthand with an invalid feature name (2)', async function () {
        const feature: DevContainerFeature = {
            id: 'octocat/myfeatures/MY_$UPER_COOL_FEATURE',
            options: {},
        };

        const result = await processFeatureIdentifier(output, process.env, cwd, feature);
        assert.notExists(result);
    });

    it('should fail parsing a marketplace shorthand with only two segments, no hash, and with a version', async function () {
        const feature: DevContainerFeature = {
            id: 'octocat/myfeatures@v0.0.1',
            options: {},
        };
        
        const result = await processFeatureIdentifier(output, process.env, cwd, feature);
        assert.notExists(result);
    });
});


describe('validate function getSourceInfoString', function () {

    it('should work for local-cache', async function () {
        const srcInfo: SourceInformation = {
            type: 'local-cache',
        };
        const output = getSourceInfoString(srcInfo);
        assert.include(output, 'local-cache');
    });

    it('should work for github-repo without a tag (implicit latest)', async function () {
        const srcInfo: SourceInformation = {
            type: 'github-repo',
            owner: 'bob',
            repo: 'mobileapp',
            isLatest: true,
            apiUri: 'https://api.github.com/repos/bob/mobileapp/releases/latest',
            unauthenticatedUri: 'https://github.com/bob/mobileapp/releases/latest/download'
        };
        const output = getSourceInfoString(srcInfo);
        assert.include(output, 'github-bob-mobileapp-latest');
    });

    it('should work for github-repo with a tag', async function () {
        const srcInfo: SourceInformation = {
            type: 'github-repo',
            owner: 'bob',
            repo: 'mobileapp',
            tag: 'v0.0.4',
            isLatest: false,
            apiUri: 'https://api.github.com/repos/bob/mobileapp/releases/tags/v0.0.4',
            unauthenticatedUri: 'https://github.com/bob/mobileapp/releases/download/v0.0.4'
        };
        const output = getSourceInfoString(srcInfo);
        assert.include(output, 'github-bob-mobileapp-v0.0.4');
    });
});

describe('validate function getBackwardCompatibleFeatureId', () => {
    it('should map the migrated (old shorthand syntax) features to ghcr.io/devcontainers/features/*', () => {
        let id = 'node';
        let expectedId = 'ghcr.io/devcontainers/features/node:1';
        let mappedId = getBackwardCompatibleFeatureId(output, id);

        assert.strictEqual(mappedId, expectedId);

        id = 'python';
        expectedId = 'ghcr.io/devcontainers/features/python:1';
        mappedId = getBackwardCompatibleFeatureId(output, id);

        assert.strictEqual(mappedId, expectedId);
    });

    it('should map the renamed (old shorthand syntax) features to ghcr.io/devcontainers/features/*', () => {
        let id = 'golang';
        let expectedId = 'ghcr.io/devcontainers/features/go:1';
        let mappedId = getBackwardCompatibleFeatureId(output, id);

        assert.strictEqual(mappedId, expectedId);

        id = 'common';
        expectedId = 'ghcr.io/devcontainers/features/common-utils:1';
        mappedId = getBackwardCompatibleFeatureId(output, id);

        assert.strictEqual(mappedId, expectedId);
    });

    it('should keep the deprecated (old shorthand syntax) features id intact', () => {
        let id = 'fish';
        let expectedId = 'fish';
        let mappedId = getBackwardCompatibleFeatureId(output, id);

        assert.strictEqual(mappedId, expectedId);

        id = 'maven';
        expectedId = 'maven';
        mappedId = getBackwardCompatibleFeatureId(output, id);

        assert.strictEqual(mappedId, expectedId);
    });

    it('should keep all other features id intact', () => {
        let id = 'ghcr.io/devcontainers/features/node:1';
        let expectedId = id;
        let mappedId = getBackwardCompatibleFeatureId(output, id);

        assert.strictEqual(mappedId, expectedId);

        id = 'ghcr.io/user/repo/go:1';
        expectedId = id;
        mappedId = getBackwardCompatibleFeatureId(output, id);

        assert.strictEqual(mappedId, expectedId);

        id = 'ghcr.io/user/repo/go';
        expectedId = id;
        mappedId = getBackwardCompatibleFeatureId(output, id);

        assert.strictEqual(mappedId, expectedId);
    });
});

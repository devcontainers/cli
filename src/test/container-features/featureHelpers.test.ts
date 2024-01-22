import { assert } from 'chai';
import * as path from 'path';
import { DevContainerConfig, DevContainerFeature } from '../../spec-configuration/configuration';
import { OCIRef } from '../../spec-configuration/containerCollectionsOCI';
import { Feature, FeatureSet, getBackwardCompatibleFeatureId, getFeatureInstallWrapperScript, processFeatureIdentifier, updateDeprecatedFeaturesIntoOptions } from '../../spec-configuration/containerFeaturesConfiguration';
import { getSafeId, findContainerUsers } from '../../spec-node/containerFeatures';
import { ImageMetadataEntry } from '../../spec-node/imageMetadata';
import { SubstitutedConfig } from '../../spec-node/utils';
import { createPlainLog, LogLevel, makeLog, nullLog } from '../../spec-utils/log';

export const output = makeLog(createPlainLog(text => process.stdout.write(text), () => LogLevel.Trace));

const params = { output, env: process.env };

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

// A 'Feature' object's id should always be parsed to
// the individual feature's name (without any other 'sourceInfo' information)
const assertFeatureIdInvariant = (id: string) => {
	const includesInvalidCharacter = id.includes('/') || id.includes(':') || id.includes('\\') || id.includes('.');
	assert.isFalse(includesInvalidCharacter, `Individual feature id '${id}' contains invalid characters`);
};

describe('validate processFeatureIdentifier', async function () {
	// const VALID_TYPES = ['github-repo', 'direct-tarball', 'file-path', 'oci'];

	// In the real implementation, the cwd is passed by the calling function with the value of `--workspace-folder`.
	// See: https://github.com/devcontainers/cli/blob/45541ba21437bf6c16826762f084ab502157789b/src/spec-node/devContainersSpecCLI.ts#L152-L153
	const workspaceRoot = '/workspace/myProject';
	const defaultConfigPath = path.join(workspaceRoot, '.devcontainer', 'devcontainer.json');
	console.log(`workspaceRoot = ${workspaceRoot}, defaultConfigPath = ${defaultConfigPath}`);

	describe('VALID processFeatureIdentifier examples', async function () {

		it('should process v1 local-cache', async function () {
			// Parsed out of a user's devcontainer.json
			let userFeature: DevContainerFeature = {
				userFeatureId: 'docker-in-docker',
				options: {}
			};
			const featureSet = await processFeatureIdentifier(params, defaultConfigPath, workspaceRoot, userFeature);
			if (!featureSet) {
				assert.fail('processFeatureIdentifier returned null');
			}

			assert.strictEqual(featureSet.features.length, 1);

			const featureId = featureSet.features[0].id;
			assertFeatureIdInvariant(featureId);

			assert.strictEqual(featureId, 'docker-in-docker');

			// Automapping feature ids from old shorthand syntax to ghcr.io/devcontainers/features/*
			assert.strictEqual(featureSet?.sourceInformation.type, 'oci');
		});

		it('should process github-repo (without version)', async function () {
			const userFeature: DevContainerFeature = {
				userFeatureId: 'octocat/myfeatures/helloworld',
				options: {},
			};
			const featureSet = await processFeatureIdentifier(params, defaultConfigPath, workspaceRoot, userFeature);
			if (!featureSet) {
				assert.fail('processFeatureIdentifier returned null');
			}

			assert.strictEqual(featureSet.features.length, 1);

			const featureId = featureSet.features[0].id;
			assertFeatureIdInvariant(featureId);

			assert.strictEqual(featureSet?.features[0].id, 'helloworld');
			assert.deepEqual(featureSet?.sourceInformation, {
				type: 'github-repo',
				owner: 'octocat',
				repo: 'myfeatures',
				apiUri: 'https://api.github.com/repos/octocat/myfeatures/releases/latest',
				unauthenticatedUri: 'https://github.com/octocat/myfeatures/releases/latest/download',
				isLatest: true,
				userFeatureId: 'octocat/myfeatures/helloworld',
				userFeatureIdWithoutVersion: 'octocat/myfeatures/helloworld'
			});
		});

		it('should process github-repo (with version)', async function () {
			const userFeature: DevContainerFeature = {
				userFeatureId: 'octocat/myfeatures/helloworld@v0.0.4',
				options: {},
			};
			const featureSet = await processFeatureIdentifier(params, defaultConfigPath, workspaceRoot, userFeature);
			if (!featureSet) {
				assert.fail('processFeatureIdentifier returned null');
			}

			assert.strictEqual(featureSet.features.length, 1);

			const featureId = featureSet.features[0].id;
			assertFeatureIdInvariant(featureId);

			assert.strictEqual(featureSet?.features[0].id, 'helloworld');
			assert.deepEqual(featureSet?.sourceInformation, {
				type: 'github-repo',
				owner: 'octocat',
				repo: 'myfeatures',
				tag: 'v0.0.4',
				apiUri: 'https://api.github.com/repos/octocat/myfeatures/releases/tags/v0.0.4',
				unauthenticatedUri: 'https://github.com/octocat/myfeatures/releases/download/v0.0.4',
				isLatest: false,
				userFeatureId: 'octocat/myfeatures/helloworld@v0.0.4',
				userFeatureIdWithoutVersion: 'octocat/myfeatures/helloworld'
			});
		});

		it('should process direct-tarball (v2 with direct tar download)', async function () {
			const userFeature: DevContainerFeature = {
				userFeatureId: 'https://example.com/some/long/path/devcontainer-feature-ruby.tgz',
				options: {},
			};

			const featureSet = await processFeatureIdentifier(params, defaultConfigPath, workspaceRoot, userFeature);
			if (!featureSet) {
				assert.fail('processFeatureIdentifier returned null');
			}
			const featureId = featureSet.features[0].id;
			assertFeatureIdInvariant(featureId);

			assert.exists(featureSet);
			assert.strictEqual(featureSet?.features[0].id, 'ruby');
			assert.deepEqual(featureSet?.sourceInformation, { type: 'direct-tarball', tarballUri: 'https://example.com/some/long/path/devcontainer-feature-ruby.tgz', userFeatureId: 'https://example.com/some/long/path/devcontainer-feature-ruby.tgz' });
		});

		it('local-path should parse when provided a relative path with Config file in $WORKSPACE_ROOT/.devcontainer', async function () {
			const userFeature: DevContainerFeature = {
				userFeatureId: './featureA',
				options: {},
			};

			const customConfigPath = path.join(workspaceRoot, '.devcontainer', 'devcontainer.json');

			const featureSet = await processFeatureIdentifier(params, customConfigPath, workspaceRoot, userFeature);
			assert.exists(featureSet);
			assert.strictEqual(featureSet?.features[0].id, 'featureA');
			assert.deepEqual(featureSet?.sourceInformation, { type: 'file-path', resolvedFilePath: path.join(workspaceRoot, '.devcontainer', 'featureA'), userFeatureId: './featureA' });
		});


		it('local-path should parse when provided relative path with config file in $WORKSPACE_ROOT', async function () {
			const userFeature: DevContainerFeature = {
				userFeatureId: './.devcontainer/featureB',
				options: {},
			};

			const customConfigPath = path.join(workspaceRoot, 'devcontainer.json');

			const featureSet = await processFeatureIdentifier(params, customConfigPath, workspaceRoot, userFeature);

			assert.exists(featureSet);
			assert.strictEqual(featureSet?.features[0].id, 'featureB');
			assert.deepEqual(featureSet?.sourceInformation, { type: 'file-path', resolvedFilePath: path.join(workspaceRoot, '.devcontainer', 'featureB'), userFeatureId: './.devcontainer/featureB' });
		});

		it('should process oci registry (without tag)', async function () {
			const userFeature: DevContainerFeature = {
				userFeatureId: 'ghcr.io/codspace/features/ruby',
				options: {},
			};

			const featureSet = await processFeatureIdentifier(params, defaultConfigPath, workspaceRoot, userFeature);
			if (!featureSet) {
				assert.fail('processFeatureIdentifier returned null');
			}
			const featureId = featureSet.features[0].id;
			assertFeatureIdInvariant(featureId);
			assert.strictEqual(featureSet?.features[0].id, 'ruby');

			assert.exists(featureSet);

			const expectedFeatureRef: OCIRef = {
				id: 'ruby',
				owner: 'codspace',
				namespace: 'codspace/features',
				registry: 'ghcr.io',
				tag: 'latest',
				digest: undefined,
				version: 'latest',
				resource: 'ghcr.io/codspace/features/ruby',
				path: 'codspace/features/ruby',
			};

			if (featureSet.sourceInformation.type === 'oci') {
				assert.ok(featureSet.sourceInformation.type === 'oci');
				assert.deepEqual(featureSet.sourceInformation.featureRef, expectedFeatureRef);
			} else {
				assert.fail('sourceInformation.type is not oci');
			}
		});

		it('should process oci registry (with a digest)', async function () {
			const userFeature: DevContainerFeature = {
				userFeatureId: 'ghcr.io/devcontainers/features/ruby@sha256:4ef08c9c3b708f3c2faecc5a898b39736423dd639f09f2a9f8bf9b0b9252ef0a',
				options: {},
			};

			const featureSet = await processFeatureIdentifier(params, defaultConfigPath, workspaceRoot, userFeature);
			if (!featureSet) {
				assert.fail('processFeatureIdentifier returned null');
			}
			const featureId = featureSet.features[0].id;
			assertFeatureIdInvariant(featureId);
			assert.strictEqual(featureSet?.features[0].id, 'ruby');

			assert.exists(featureSet);

			const expectedFeatureRef: OCIRef = {
				id: 'ruby',
				owner: 'devcontainers',
				namespace: 'devcontainers/features',
				registry: 'ghcr.io',
				tag: undefined,
				digest: 'sha256:4ef08c9c3b708f3c2faecc5a898b39736423dd639f09f2a9f8bf9b0b9252ef0a',
				version: 'sha256:4ef08c9c3b708f3c2faecc5a898b39736423dd639f09f2a9f8bf9b0b9252ef0a',
				resource: 'ghcr.io/devcontainers/features/ruby',
				path: 'devcontainers/features/ruby',
			};

			if (featureSet.sourceInformation.type === 'oci') {
				assert.ok(featureSet.sourceInformation.type === 'oci');
				assert.deepEqual(featureSet.sourceInformation.featureRef, expectedFeatureRef);
			} else {
				assert.fail('sourceInformation.type is not oci');
			}
		});

		it('should process oci registry (with a tag)', async function () {
			const userFeature: DevContainerFeature = {
				userFeatureId: 'ghcr.io/codspace/features/ruby:1.0.13',
				options: {},
			};

			const featureSet = await processFeatureIdentifier(params, defaultConfigPath, workspaceRoot, userFeature);
			if (!featureSet) {
				assert.fail('processFeatureIdentifier returned null');
			}
			const featureId = featureSet.features[0].id;
			assertFeatureIdInvariant(featureId);
			assert.strictEqual(featureSet?.features[0].id, 'ruby');

			assert.exists(featureSet);

			const expectedFeatureRef: OCIRef = {
				id: 'ruby',
				owner: 'codspace',
				namespace: 'codspace/features',
				registry: 'ghcr.io',
				tag: '1.0.13',
				digest: undefined,
				version: '1.0.13',
				resource: 'ghcr.io/codspace/features/ruby',
				path: 'codspace/features/ruby',
			};

			if (featureSet.sourceInformation.type === 'oci') {
				assert.ok(featureSet.sourceInformation.type === 'oci');
				assert.deepEqual(featureSet.sourceInformation.featureRef, expectedFeatureRef);
			} else {
				assert.fail('sourceInformation.type is not oci');
			}
		});
	});

	describe('INVALID processFeatureIdentifier examples', async function () {
		it('local-path should fail to parse when provided  absolute path and defaultConfigPath with a .devcontainer', async function () {
			const userFeature: DevContainerFeature = {
				userFeatureId: '/some/long/path/to/helloworld',
				options: {},
			};

			const testSpecificConfigPath = path.join(workspaceRoot, '.devcontainer', 'devcontainer.json');

			const featureSet = await processFeatureIdentifier(params, testSpecificConfigPath, workspaceRoot, userFeature);
			assert.notExists(featureSet);
		});

		it('local-path should fail to parse when provided an absolute path and defaultConfigPath without a .devcontainer', async function () {
			const userFeature: DevContainerFeature = {
				userFeatureId: '/some/long/path/to/helloworld',
				options: {},
			};

			const testSpecificConfigPath = path.join(workspaceRoot, '.devcontainer.json');

			const featureSet = await processFeatureIdentifier(params, testSpecificConfigPath, workspaceRoot, userFeature);
			assert.notExists(featureSet);
		});

		it('local-path should fail to parse when provided an a relative path breaking out of the .devcontainer folder', async function () {
			const userFeature: DevContainerFeature = {
				userFeatureId: '../featureC',
				options: {},
			};

			const testSpecificConfigPath = path.join(workspaceRoot, '.devcontainer.json');

			const featureSet = await processFeatureIdentifier(params, testSpecificConfigPath, workspaceRoot, userFeature);
			assert.notExists(featureSet);
		});

		it('should fail parsing a generic tar with no feature and trailing slash', async function () {
			const userFeature: DevContainerFeature = {
				userFeatureId: 'https://example.com/some/long/path/devcontainer-features.tgz/',
				options: {},
			};

			const featureSet = await processFeatureIdentifier(params, defaultConfigPath, workspaceRoot, userFeature);
			assert.notExists(featureSet);
		});

		it('should not parse gitHub without triple slash', async function () {
			const userFeature: DevContainerFeature = {
				userFeatureId: 'octocat/myfeatures#helloworld',
				options: {},
			};

			const featureSet = await processFeatureIdentifier(params, defaultConfigPath, workspaceRoot, userFeature);
			assert.notExists(featureSet);
		});

		it('should fail parsing a generic tar with no feature and no trailing slash', async function () {
			const userFeature: DevContainerFeature = {
				userFeatureId: 'https://example.com/some/long/path/devcontainer-features.tgz',
				options: {},
			};

			const featureSet = await processFeatureIdentifier(params, defaultConfigPath, workspaceRoot, userFeature);
			assert.notExists(featureSet);
		});

		it('should fail parsing a generic tar with a hash but no feature', async function () {
			const userFeature: DevContainerFeature = {
				userFeatureId: 'https://example.com/some/long/path/devcontainer-features.tgz#',
				options: {},
			};

			const featureSet = await processFeatureIdentifier(params, defaultConfigPath, workspaceRoot, userFeature);
			assert.notExists(featureSet);
		});

		it('should fail parsing a marketplace shorthand with only two segments and a hash with no feature', async function () {
			const userFeature: DevContainerFeature = {
				userFeatureId: 'octocat/myfeatures#',
				options: {},
			};

			const featureSet = await processFeatureIdentifier(params, defaultConfigPath, workspaceRoot, userFeature);
			assert.notExists(featureSet);
		});

		it('should fail parsing a marketplace shorthand with only two segments (no feature)', async function () {
			const userFeature: DevContainerFeature = {
				userFeatureId: 'octocat/myfeatures',
				options: {},
			};

			const featureSet = await processFeatureIdentifier(params, defaultConfigPath, workspaceRoot, userFeature);
			assert.notExists(featureSet);
		});

		it('should fail parsing a marketplace shorthand with an invalid feature name (1)', async function () {
			const userFeature: DevContainerFeature = {
				userFeatureId: 'octocat/myfeatures/@mycoolfeature',
				options: {},
			};

			const featureSet = await processFeatureIdentifier(params, defaultConfigPath, workspaceRoot, userFeature);
			assert.notExists(featureSet);
		});

		it('should fail parsing a marketplace shorthand with an invalid feature name (2)', async function () {
			const userFeature: DevContainerFeature = {
				userFeatureId: 'octocat/myfeatures/MY_$UPER_COOL_FEATURE',
				options: {},
			};

			const featureSet = await processFeatureIdentifier(params, defaultConfigPath, workspaceRoot, userFeature);
			assert.notExists(featureSet);
		});

		it('should fail parsing a marketplace shorthand with only two segments, no hash, and with a version', async function () {
			const userFeature: DevContainerFeature = {
				userFeatureId: 'octocat/myfeatures@v0.0.1',
				options: {},
			};

			const featureSet = await processFeatureIdentifier(params, defaultConfigPath, workspaceRoot, userFeature);
			assert.notExists(featureSet);
		});
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

describe('validate function updateDeprecatedFeaturesIntoOptions', () => {
	it('should add feature with option', () => {
		const updated = updateDeprecatedFeaturesIntoOptions([
			{
				userFeatureId: 'jupyterlab',
				options: {}
			}
		], nullLog);
		if (!updated) {
			assert.fail('updated is null');
		}

		assert.strictEqual(updated.length, 1);
		assert.strictEqual(updated[0].userFeatureId, 'ghcr.io/devcontainers/features/python:1');
		assert.ok(updated[0].options);
		assert.strictEqual(typeof updated[0].options, 'object');
		assert.strictEqual((updated[0].options as Record<string, string | boolean | undefined>)['installJupyterlab'], true);
	});
	
	it('should update feature with option', () => {
		const updated = updateDeprecatedFeaturesIntoOptions([
			{
				userFeatureId: 'ghcr.io/devcontainers/features/python:1',
				options: {}
			},
			{
				userFeatureId: 'jupyterlab',
				options: {}
			}
		], nullLog);
		if (!updated) {
			assert.fail('updated is null');
		}

		assert.strictEqual(updated.length, 1);
		assert.strictEqual(updated[0].userFeatureId, 'ghcr.io/devcontainers/features/python:1');
		assert.ok(updated[0].options);
		assert.strictEqual(typeof updated[0].options, 'object');
		assert.strictEqual((updated[0].options as Record<string, string | boolean | undefined>)['installJupyterlab'], true);
	});

	it('should update legacy feature with option', () => {
		const updated = updateDeprecatedFeaturesIntoOptions([
			{
				userFeatureId: 'python',
				options: {}
			},
			{
				userFeatureId: 'jupyterlab',
				options: {}
			}
		], nullLog);
		if (!updated) {
			assert.fail('updated is null');
		}
		assert.strictEqual(updated.length, 1);
		assert.strictEqual(updated[0].userFeatureId, 'python');
		assert.ok(updated[0].options);
		assert.strictEqual(typeof updated[0].options, 'object');
		assert.strictEqual((updated[0].options as Record<string, string | boolean | undefined>)['installJupyterlab'], true);
	});
});

describe('validate function getFeatureInstallWrapperScript', () => {
	it('returns a valid script when optional feature values do not exist', () => {
        const feature: Feature = {
			id: 'test',
			value: {},
			included: true,
			name: undefined,
			description: undefined,
			version: undefined,
			documentationURL: undefined,
		};
		const set: FeatureSet = {
			features: [feature],
			sourceInformation: {
				type: 'file-path',
				resolvedFilePath: '',
				userFeatureId: './test',
				userFeatureIdWithoutVersion: './test'
			}
		};
		const options: string[] = [];

		const expected =
`#!/bin/sh
set -e

on_exit () {
	[ $? -eq 0 ] && exit
	echo 'ERROR: Feature "Unknown" (./test) failed to install!'
}

trap on_exit EXIT

echo ===========================================================================

echo 'Feature       : Unknown'
echo 'Description   : '
echo 'Id            : ./test'
echo 'Version       : '
echo 'Documentation : '
echo 'Options       :'
echo ''
echo ===========================================================================

set -a
. ../devcontainer-features.builtin.env
. ./devcontainer-features.env
set +a

chmod +x ./install.sh
./install.sh
`;

		const actual = getFeatureInstallWrapperScript(feature, set, options);
		assert.equal(actual, expected);
    });

	it('returns a valid script when expected feature values do exist', () => {
        const feature: Feature = {
			id: 'test',
			value: {
				version: 'latest',
				otherOption: true
			},
			included: true,
			name: 'My Test Feature',
			description: 'This is an awesome feature (with ""quotes" for \'escaping\' test)',
			version: '1.2.3',
			documentationURL: 'https://my-test-feature.localhost',
		};
		const set: FeatureSet = {
			features: [feature],
			sourceInformation: {
				type: 'oci',
				userFeatureId: 'ghcr.io/my-org/my-repo/test:1',
				userFeatureIdWithoutVersion: 'ghcr.io/my-org/my-repo/test',
				featureRef: {
					registry: 'ghcr.io',
					owner: 'my-org',
					namespace: 'my-org/my-repo',
					path: 'my-org/my-repo/test',
					resource: 'ghcr.io/my-org/my-repo/test',
					id: 'test',
					tag: '1.2.3',
					version: '1.2.3',
				},
				manifest: {
					schemaVersion: 1,
					mediaType: '',
					config: {
						digest: '',
						mediaType: '',
						size: 0,
					},
					layers: [],
				},
				manifestDigest: '',
			}
		};
		const options = [
			'VERSION=latest',
			'OTHEROPTION=true',
		];

		const expected =
`#!/bin/sh
set -e

on_exit () {
	[ $? -eq 0 ] && exit
	echo 'ERROR: Feature "My Test Feature" (ghcr.io/my-org/my-repo/test) failed to install! Look at the documentation at https://my-test-feature.localhost for help troubleshooting this error.'
}

trap on_exit EXIT

echo ===========================================================================

echo 'Feature       : My Test Feature'
echo 'Description   : This is an awesome feature (with ""quotes" for '\\''escaping'\\'' test)'
echo 'Id            : ghcr.io/my-org/my-repo/test'
echo 'Version       : 1.2.3'
echo 'Documentation : https://my-test-feature.localhost'
echo 'Options       :'
echo '    VERSION=latest
    OTHEROPTION=true'
echo ===========================================================================

set -a
. ../devcontainer-features.builtin.env
. ./devcontainer-features.env
set +a

chmod +x ./install.sh
./install.sh
`;

		const actual = getFeatureInstallWrapperScript(feature, set, options);
		assert.equal(actual, expected);
    });

	it('returns a valid script with warnings for deprecated Features', () => {
        const feature: Feature = {
			id: 'test',
			value: {
				version: 'latest',
				otherOption: true
			},
			included: true,
			name: 'My Test Feature',
			description: 'This is an awesome feature (with ""quotes" for \'escaping\' test)',
			version: '1.2.3',
			documentationURL: 'https://my-test-feature.localhost',
			deprecated: true,
		};
		const set: FeatureSet = {
			features: [feature],
			sourceInformation: {
				type: 'oci',
				userFeatureId: 'ghcr.io/my-org/my-repo/test:1',
				userFeatureIdWithoutVersion: 'ghcr.io/my-org/my-repo/test',
				featureRef: {
					registry: 'ghcr.io',
					owner: 'my-org',
					namespace: 'my-org/my-repo',
					path: 'my-org/my-repo/test',
					resource: 'ghcr.io/my-org/my-repo/test',
					id: 'test',
					tag: '1.2.3',
					version: '1.2.3',
				},
				manifest: {
					schemaVersion: 1,
					mediaType: '',
					config: {
						digest: '',
						mediaType: '',
						size: 0,
					},
					layers: [],
				},
				manifestDigest: '',
			}
		};
		const options = [
			'VERSION=latest',
			'OTHEROPTION=true',
		];

		const expected =
`#!/bin/sh
set -e

on_exit () {
	[ $? -eq 0 ] && exit
	echo 'ERROR: Feature "My Test Feature" (ghcr.io/my-org/my-repo/test) failed to install! Look at the documentation at https://my-test-feature.localhost for help troubleshooting this error.'
}

trap on_exit EXIT

echo ===========================================================================
echo '(!) WARNING: Using the deprecated Feature "test". This Feature will no longer receive any further updates/support.\n'
echo 'Feature       : My Test Feature'
echo 'Description   : This is an awesome feature (with ""quotes" for '\\''escaping'\\'' test)'
echo 'Id            : ghcr.io/my-org/my-repo/test'
echo 'Version       : 1.2.3'
echo 'Documentation : https://my-test-feature.localhost'
echo 'Options       :'
echo '    VERSION=latest
    OTHEROPTION=true'
echo ===========================================================================

set -a
. ../devcontainer-features.builtin.env
. ./devcontainer-features.env
set +a

chmod +x ./install.sh
./install.sh
`;

		const actual = getFeatureInstallWrapperScript(feature, set, options);
		assert.equal(actual, expected);
    });

	it('returns a valid script with warnings for renamed Features', () => {
        const feature: Feature = {
			id: 'test',
			value: {
				version: 'latest',
				otherOption: true
			},
			included: true,
			name: 'My New Test Feature',
			description: 'This is an awesome feature (with ""quotes" for \'escaping\' test)',
			version: '1.2.3',
			documentationURL: 'https://my-new-test-feature.localhost',
			legacyIds: [
				'test'
			],
			currentId: 'ghcr.io/my-org/my-repo/new-test'
		};
		const set: FeatureSet = {
			features: [feature],
			sourceInformation: {
				type: 'oci',
				userFeatureId: 'ghcr.io/my-org/my-repo/test:1',
				userFeatureIdWithoutVersion: 'ghcr.io/my-org/my-repo/test',
				featureRef: {
					registry: 'ghcr.io',
					owner: 'my-org',
					namespace: 'my-org/my-repo',
					path: 'my-org/my-repo/test',
					resource: 'ghcr.io/my-org/my-repo/test',
					id: 'test',
					tag: '1.2.3',
					version: '1.2.3',
				},
				manifest: {
					schemaVersion: 1,
					mediaType: '',
					config: {
						digest: '',
						mediaType: '',
						size: 0,
					},
					layers: [],
				},
				manifestDigest: '',
			}
		};
		const options = [
			'VERSION=latest',
			'OTHEROPTION=true',
		];

		const expected =
`#!/bin/sh
set -e

on_exit () {
	[ $? -eq 0 ] && exit
	echo 'ERROR: Feature "My New Test Feature" (ghcr.io/my-org/my-repo/test) failed to install! Look at the documentation at https://my-new-test-feature.localhost for help troubleshooting this error.'
}

trap on_exit EXIT

echo ===========================================================================
echo '(!) WARNING: This feature has been renamed. Please update the reference in devcontainer.json to "ghcr.io/my-org/my-repo/new-test".'
echo 'Feature       : My New Test Feature'
echo 'Description   : This is an awesome feature (with ""quotes" for '\\''escaping'\\'' test)'
echo 'Id            : ghcr.io/my-org/my-repo/test'
echo 'Version       : 1.2.3'
echo 'Documentation : https://my-new-test-feature.localhost'
echo 'Options       :'
echo '    VERSION=latest
    OTHEROPTION=true'
echo ===========================================================================

set -a
. ../devcontainer-features.builtin.env
. ./devcontainer-features.env
set +a

chmod +x ./install.sh
./install.sh
`;

		const actual = getFeatureInstallWrapperScript(feature, set, options);
		assert.equal(actual, expected);
    });
});

describe('findContainerUsers', () => {
	it('returns last metadata containerUser as containerUser and remoteUser', () => {
		assert.deepEqual(findContainerUsers(configWithRaw([
			{
				containerUser: 'metadataTestUser1',
			},
			{
				containerUser: 'metadataTestUser2',
			},
		]), 'composeTestUser', 'imageTestUser'), {
			containerUser: 'metadataTestUser2',
			remoteUser: 'metadataTestUser2',
		});
	});
	it('returns compose service user as containerUser and remoteUser', () => {
		assert.deepEqual(findContainerUsers(configWithRaw<ImageMetadataEntry[]>([
			{
				remoteEnv: { foo: 'bar' },
			},
			{
				remoteEnv: { bar: 'baz' },
			},
		]), 'composeTestUser', 'imageTestUser'), {
			containerUser: 'composeTestUser',
			remoteUser: 'composeTestUser',
		});
	});
	it('returns image user as containerUser and remoteUser', () => {
		assert.deepEqual(findContainerUsers(configWithRaw<ImageMetadataEntry[]>([
			{
				remoteEnv: { foo: 'bar' },
			},
			{
				remoteEnv: { bar: 'baz' },
			},
		]), undefined, 'imageTestUser'), {
			containerUser: 'imageTestUser',
			remoteUser: 'imageTestUser',
		});
	});
	it('returns last metadata remoteUser', () => {
		assert.deepEqual(findContainerUsers(configWithRaw([
			{
				remoteUser: 'metadataTestUser1',
			},
			{
				remoteUser: 'metadataTestUser2',
			},
		]), 'composeTestUser', 'imageTestUser'), {
			containerUser: 'composeTestUser',
			remoteUser: 'metadataTestUser2',
		});
	});
});

function configWithRaw<T extends DevContainerConfig | ImageMetadataEntry[]>(config: T): SubstitutedConfig<T> {
	return {
		config,
		raw: config,
		substitute: config => config,
	};
}
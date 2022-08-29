import { assert } from 'chai';
import * as path from 'path';
import { DevContainerFeature } from '../../spec-configuration/configuration';
import { getBackwardCompatibleFeatureId, processFeatureIdentifier } from '../../spec-configuration/containerFeaturesConfiguration';
import { OCIFeatureRef } from '../../spec-configuration/containerFeaturesOCI';
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

// A 'Feature' object's id should always be parsed to
// the individual feature's name (without any other 'sourceInfo' information)
const assertFeatureIdInvariant = (id: string) => {
	const includesInvalidCharacter = id.includes('/') || id.includes(':') || id.includes('\\') || id.includes('.');
	assert.isFalse(includesInvalidCharacter, `Individual feature id '${id}' contains invalid characters`);
};

describe('validate processFeatureIdentifier', async function () {
	// const VALID_TYPES = ['local-cache', 'github-repo', 'direct-tarball', 'file-path', 'oci'];

	// In the real implementation, the cwd is passed by the calling function with the value of `--workspace-folder`.
	// See: https://github.com/devcontainers/cli/blob/45541ba21437bf6c16826762f084ab502157789b/src/spec-node/devContainersSpecCLI.ts#L152-L153
	const workspaceRoot = '/workspace/myProject';
	const defaultConfigPath = path.join(workspaceRoot, '.devcontainer', 'devcontainer.json');
	console.log(`workspaceRoot = ${workspaceRoot}, defaultConfigPath = ${defaultConfigPath}`);

	describe('VALID processFeatureIdentifier examples', async function () {

		it('should process v1 local-cache', async function () {
			// Parsed out of a user's devcontainer.json
			let userFeature: DevContainerFeature = {
				id: 'docker-in-docker',
				options: {}
			};
			const featureSet = await processFeatureIdentifier(output, defaultConfigPath, workspaceRoot, process.env, userFeature);
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
				id: 'octocat/myfeatures/helloworld',
				options: {},
			};
			const featureSet = await processFeatureIdentifier(output, defaultConfigPath, workspaceRoot, process.env, userFeature);
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
				id: 'octocat/myfeatures/helloworld@v0.0.4',
				options: {},
			};
			const featureSet = await processFeatureIdentifier(output, defaultConfigPath, workspaceRoot, process.env, userFeature);
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
				id: 'https://example.com/some/long/path/devcontainer-feature-ruby.tgz',
				options: {},
			};

			const featureSet = await processFeatureIdentifier(output, defaultConfigPath, workspaceRoot, process.env, userFeature);
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
				id: './featureA',
				options: {},
			};

			const customConfigPath = path.join(workspaceRoot, '.devcontainer', 'devcontainer.json');

			const featureSet = await processFeatureIdentifier(output, customConfigPath, workspaceRoot, process.env, userFeature);
			assert.exists(featureSet);
			assert.strictEqual(featureSet?.features[0].id, 'featureA');
			assert.deepEqual(featureSet?.sourceInformation, { type: 'file-path', resolvedFilePath: path.join(workspaceRoot, '.devcontainer', 'featureA'), userFeatureId: './featureA' });
		});


		it('local-path should parse when provided relative path with config file in $WORKSPACE_ROOT', async function () {
			const userFeature: DevContainerFeature = {
				id: './.devcontainer/featureB',
				options: {},
			};

			const customConfigPath = path.join(workspaceRoot, 'devcontainer.json');

			const featureSet = await processFeatureIdentifier(output, customConfigPath, workspaceRoot, process.env, userFeature);

			assert.exists(featureSet);
			assert.strictEqual(featureSet?.features[0].id, 'featureB');
			assert.deepEqual(featureSet?.sourceInformation, { type: 'file-path', resolvedFilePath: path.join(workspaceRoot, '.devcontainer', 'featureB'), userFeatureId: './.devcontainer/featureB' });
		});

		it('should process oci registry (without tag)', async function () {
			const userFeature: DevContainerFeature = {
				id: 'ghcr.io/codspace/features/ruby',
				options: {},
			};

			const featureSet = await processFeatureIdentifier(output, defaultConfigPath, workspaceRoot, process.env, userFeature);
			if (!featureSet) {
				assert.fail('processFeatureIdentifier returned null');
			}
			const featureId = featureSet.features[0].id;
			assertFeatureIdInvariant(featureId);
			assert.strictEqual(featureSet?.features[0].id, 'ruby');

			assert.exists(featureSet);

			const expectedFeatureRef: OCIFeatureRef = {
				id: 'ruby',
				owner: 'codspace',
				namespace: 'codspace/features',
				registry: 'ghcr.io',
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

		it('should process oci registry (with a tag)', async function () {
			const userFeature: DevContainerFeature = {
				id: 'ghcr.io/codspace/features/ruby:1.0.13',
				options: {},
			};

			const featureSet = await processFeatureIdentifier(output, defaultConfigPath, workspaceRoot, process.env, userFeature);
			if (!featureSet) {
				assert.fail('processFeatureIdentifier returned null');
			}
			const featureId = featureSet.features[0].id;
			assertFeatureIdInvariant(featureId);
			assert.strictEqual(featureSet?.features[0].id, 'ruby');

			assert.exists(featureSet);

			const expectedFeatureRef: OCIFeatureRef = {
				id: 'ruby',
				owner: 'codspace',
				namespace: 'codspace/features',
				registry: 'ghcr.io',
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
				id: '/some/long/path/to/helloworld',
				options: {},
			};

			const testSpecificConfigPath = path.join(workspaceRoot, '.devcontainer', 'devcontainer.json');

			const featureSet = await processFeatureIdentifier(output, testSpecificConfigPath, workspaceRoot, process.env, userFeature);
			assert.notExists(featureSet);
		});

		it('local-path should fail to parse when provided an absolute path and defaultConfigPath without a .devcontainer', async function () {
			const userFeature: DevContainerFeature = {
				id: '/some/long/path/to/helloworld',
				options: {},
			};

			const testSpecificConfigPath = path.join(workspaceRoot, '.devcontainer.json');

			const featureSet = await processFeatureIdentifier(output, testSpecificConfigPath, workspaceRoot, process.env, userFeature);
			assert.notExists(featureSet);
		});

		it('local-path should fail to parse when provided an a relative path breaking out of the .devcontainer folder', async function () {
			const userFeature: DevContainerFeature = {
				id: '../featureC',
				options: {},
			};

			const testSpecificConfigPath = path.join(workspaceRoot, '.devcontainer.json');

			const featureSet = await processFeatureIdentifier(output, testSpecificConfigPath, workspaceRoot, process.env, userFeature);
			assert.notExists(featureSet);
		});

		it('should fail parsing a generic tar with no feature and trailing slash', async function () {
			const userFeature: DevContainerFeature = {
				id: 'https://example.com/some/long/path/devcontainer-features.tgz/',
				options: {},
			};

			const featureSet = await processFeatureIdentifier(output, defaultConfigPath, workspaceRoot, process.env, userFeature);
			assert.notExists(featureSet);
		});

		it('should not parse gitHub without triple slash', async function () {
			const userFeature: DevContainerFeature = {
				id: 'octocat/myfeatures#helloworld',
				options: {},
			};

			const featureSet = await processFeatureIdentifier(output, defaultConfigPath, workspaceRoot, process.env, userFeature);
			assert.notExists(featureSet);
		});

		it('should fail parsing a generic tar with no feature and no trailing slash', async function () {
			const userFeature: DevContainerFeature = {
				id: 'https://example.com/some/long/path/devcontainer-features.tgz',
				options: {},
			};

			const featureSet = await processFeatureIdentifier(output, defaultConfigPath, workspaceRoot, process.env, userFeature);
			assert.notExists(featureSet);
		});

		it('should fail parsing a generic tar with a hash but no feature', async function () {
			const userFeature: DevContainerFeature = {
				id: 'https://example.com/some/long/path/devcontainer-features.tgz#',
				options: {},
			};

			const featureSet = await processFeatureIdentifier(output, defaultConfigPath, workspaceRoot, process.env, userFeature);
			assert.notExists(featureSet);
		});

		it('should fail parsing a marketplace shorthand with only two segments and a hash with no feature', async function () {
			const userFeature: DevContainerFeature = {
				id: 'octocat/myfeatures#',
				options: {},
			};

			const featureSet = await processFeatureIdentifier(output, defaultConfigPath, workspaceRoot, process.env, userFeature);
			assert.notExists(featureSet);
		});

		it('should fail parsing a marketplace shorthand with only two segments (no feature)', async function () {
			const userFeature: DevContainerFeature = {
				id: 'octocat/myfeatures',
				options: {},
			};

			const featureSet = await processFeatureIdentifier(output, defaultConfigPath, workspaceRoot, process.env, userFeature);
			assert.notExists(featureSet);
		});

		it('should fail parsing a marketplace shorthand with an invalid feature name (1)', async function () {
			const userFeature: DevContainerFeature = {
				id: 'octocat/myfeatures/@mycoolfeature',
				options: {},
			};

			const featureSet = await processFeatureIdentifier(output, defaultConfigPath, workspaceRoot, process.env, userFeature);
			assert.notExists(featureSet);
		});

		it('should fail parsing a marketplace shorthand with an invalid feature name (2)', async function () {
			const userFeature: DevContainerFeature = {
				id: 'octocat/myfeatures/MY_$UPER_COOL_FEATURE',
				options: {},
			};

			const featureSet = await processFeatureIdentifier(output, defaultConfigPath, workspaceRoot, process.env, userFeature);
			assert.notExists(featureSet);
		});

		it('should fail parsing a marketplace shorthand with only two segments, no hash, and with a version', async function () {
			const userFeature: DevContainerFeature = {
				id: 'octocat/myfeatures@v0.0.1',
				options: {},
			};

			const featureSet = await processFeatureIdentifier(output, defaultConfigPath, workspaceRoot, process.env, userFeature);
			assert.notExists(featureSet);
		});
	});
});


describe('validate function getBackwardCompatibleFeatureId', () => {
    it('should map the migrated (old shorthand syntax) features to ghcr.io/devcontainers/features/*', () => {
        let id = 'node';
        let expectedId = 'ghcr.io/devcontainers/features/node:1';
		let mappedId = getBackwardCompatibleFeatureId(id);

        assert.strictEqual(mappedId, expectedId);

        id = 'python';
        expectedId = 'ghcr.io/devcontainers/features/python:1';
		mappedId = getBackwardCompatibleFeatureId(id);

        assert.strictEqual(mappedId, expectedId);
    });

    it('should map the renamed (old shorthand syntax) features to ghcr.io/devcontainers/features/*', () => {
        let id = 'golang';
        let expectedId = 'ghcr.io/devcontainers/features/go:1';
		let mappedId = getBackwardCompatibleFeatureId(id);

        assert.strictEqual(mappedId, expectedId);

        id = 'common';
        expectedId = 'ghcr.io/devcontainers/features/common-utils:1';
		mappedId = getBackwardCompatibleFeatureId(id);

        assert.strictEqual(mappedId, expectedId);
    });

    it('should keep the deprecated (old shorthand syntax) features id intact', () => {
        let id = 'fish';
        let expectedId = 'fish';
		let mappedId = getBackwardCompatibleFeatureId(id);

        assert.strictEqual(mappedId, expectedId);

        id = 'maven';
        expectedId = 'maven';
		mappedId = getBackwardCompatibleFeatureId(id);

        assert.strictEqual(mappedId, expectedId);
    });

    it('should keep all other features id intact', () => {
        let id = 'ghcr.io/devcontainers/features/node:1';
        let expectedId = id;
		let mappedId = getBackwardCompatibleFeatureId(id);

        assert.strictEqual(mappedId, expectedId);

        id = 'ghcr.io/user/repo/go:1';
        expectedId = id;
		mappedId = getBackwardCompatibleFeatureId(id);

        assert.strictEqual(mappedId, expectedId);

        id = 'ghcr.io/user/repo/go';
        expectedId = id;
		mappedId = getBackwardCompatibleFeatureId(id);

        assert.strictEqual(mappedId, expectedId);
    });
});

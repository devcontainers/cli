import { assert } from 'chai';
import * as path from 'path';
import { DevContainerFeature } from '../../spec-configuration/configuration';
import { getSourceInfoString, processFeatureIdentifier, SourceInformation } from '../../spec-configuration/containerFeaturesConfiguration';
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

	describe('VALID processFeatureIdentifier examples', async function () {
		it('should process local-cache', async function () {
			// Parsed out of a user's devcontainer.json
			let userFeature: DevContainerFeature = {
				id: 'docker-in-docker',
				options: {}
			};
			const featureSet = await processFeatureIdentifier(output, process.env, userFeature);
			if (!featureSet) {
				assert.fail('processFeatureIdentifier returned null');
			}

			assert.strictEqual(featureSet.features.length, 1);

			const featureId = featureSet.features[0].id;
			assertFeatureIdInvariant(featureId);

			assert.strictEqual(featureId, 'docker-in-docker');
			assert.strictEqual(featureSet?.sourceInformation.type, 'local-cache');
		});

		it('should process github-repo (without version)', async function () {
			const feature: DevContainerFeature = {
				id: 'octocat/myfeatures/helloworld',
				options: {},
			};
			const featureSet = await processFeatureIdentifier(output, process.env, feature);
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
				isLatest: true
			});
		});

		it('should process github-repo (with version)', async function () {
			const feature: DevContainerFeature = {
				id: 'octocat/myfeatures/helloworld@v0.0.4',
				options: {},
			};
			const featureSet = await processFeatureIdentifier(output, process.env, feature);
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
			});
		});

		// TODO: This hasn't been advertised and should probably just be deprecated.
		// it('should process direct-tarball (v1 with feature after hash)', async function () {
		//     const feature: DevContainerFeature = {
		//         id: 'https://example.com/some/long/path/devcontainer-features.tgz#helloworld',
		//         options: {},
		//     };

		//     const result = await processFeatureIdentifier(output, process.env, feature);
		//     const featureId = featureSet.features[0].id;
		//     assertFeatureIdInvariant(featureId);
		//     assert.exists(result);
		//     assert.strictEqual(result?.features[0].id, 'helloworld');
		//     assert.deepEqual(result?.sourceInformation, { type: 'direct-tarball', tarballUri: 'https://example.com/some/long/path/devcontainer-features.tgz' });
		// });

		//TODO this won't work!
		it('should process direct-tarball (v2 with direct tar download)', async function () {
			const feature: DevContainerFeature = {
				id: 'https://example.com/some/long/path/ruby.tgz',
				options: {},
			};

			const featureSet = await processFeatureIdentifier(output, process.env, feature);
			if (!featureSet) {
				assert.fail('processFeatureIdentifier returned null');
			}
			const featureId = featureSet.features[0].id;
			assertFeatureIdInvariant(featureId);

			assert.exists(featureSet);
			assert.strictEqual(featureSet?.features[0].id, 'ruby');
			assert.deepEqual(featureSet?.sourceInformation, { type: 'direct-tarball', tarballUri: 'https://example.com/some/long/path/ruby.tgz' });
		});

		it('should process file-path (relative path with ./)', async function () {
			const feature: DevContainerFeature = {
				id: './some/long/path/to/helloworld',
				options: {},
			};

			const cwd = process.cwd();
			console.log(`cwd: ${cwd}`);

			const featureSet = await processFeatureIdentifier(output, process.env, feature);
			if (!featureSet) {
				assert.fail('processFeatureIdentifier returned null');
			}
			const featureId = featureSet.features[0].id;
			assertFeatureIdInvariant(featureId);

			assert.strictEqual(featureSet?.features[0].id, 'helloworld');
			assert.deepEqual(featureSet?.sourceInformation, { type: 'file-path', resolvedFilePath: path.join(cwd, '/some/long/path/to/helloworld') });
		});

		it('should process file-path (relative path with ../)', async function () {
			const feature: DevContainerFeature = {
				id: '../some/long/path/to/helloworld',
				options: {},
			};

			const cwd = process.cwd();
			console.log(`cwd: ${cwd}`);

			const featureSet = await processFeatureIdentifier(output, process.env, feature);
			if (!featureSet) {
				assert.fail('processFeatureIdentifier returned null');
			}
			const featureId = featureSet.features[0].id;
			assertFeatureIdInvariant(featureId);

			assert.exists(featureSet);
			assert.strictEqual(featureSet?.features[0].id, 'helloworld');
			assert.deepEqual(featureSet?.sourceInformation, { type: 'file-path', resolvedFilePath: path.join(path.dirname(cwd), '/some/long/path/to/helloworld') });
		});

		it('should process file-path (absolute path)', async function () {
			const feature: DevContainerFeature = {
				id: '/some/long/path/to/helloworld',
				options: {},
			};

			const featureSet = await processFeatureIdentifier(output, process.env, feature);
			if (!featureSet) {
				assert.fail('processFeatureIdentifier returned null');
			}
			const featureId = featureSet.features[0].id;
			assertFeatureIdInvariant(featureId);

			assert.exists(featureSet);
			assert.strictEqual(featureSet?.features[0].id, 'helloworld');
			assert.deepEqual(featureSet?.sourceInformation, { type: 'file-path', resolvedFilePath: '/some/long/path/to/helloworld' });
		});


		it('should process oci registry (without tag)', async function () {
			const feature: DevContainerFeature = {
				id: 'ghcr.io/codspace/features/ruby',
				options: {},
			};

			const featureSet = await processFeatureIdentifier(output, process.env, feature);
			if (!featureSet) {
				assert.fail('processFeatureIdentifier returned null');
			}
			const featureId = featureSet.features[0].id;
			assertFeatureIdInvariant(featureId);
			assert.strictEqual(featureSet?.features[0].id, 'ruby');

			assert.exists(featureSet);

			const expectedFeatureRef: OCIFeatureRef = {
				id: 'ruby',
				owner: 'devcontainers',
				namespace: 'codspace/features',
				registry: 'ghcr.io',
				version: 'latest',
				resource: 'ghcr.io/codspace/features'
			};

			if (featureSet.sourceInformation.type === 'oci') {
				assert.ok(featureSet.sourceInformation.type === 'oci');
				assert.deepEqual(featureSet.sourceInformation.featureRef, expectedFeatureRef);
			} else {
				assert.fail('sourceInformation.type is not oci');
			}
		});

		it('should process oci registry (with a tag)', async function () {
			const feature: DevContainerFeature = {
				id: 'ghcr.io/devcontainers/features/ruby:1.0.10',
				options: {},
			};

			const featureSet = await processFeatureIdentifier(output, process.env, feature);
			if (!featureSet) {
				assert.fail('processFeatureIdentifier returned null');
			}
			const featureId = featureSet.features[0].id;
			assertFeatureIdInvariant(featureId);
			assert.strictEqual(featureSet?.features[0].id, 'ruby');

			assert.exists(featureSet);

			const expectedFeatureRef: OCIFeatureRef = {
				id: 'ruby',
				owner: 'devcontainers',
				namespace: 'devcontainers/features',
				registry: 'ghcr.io',
				version: 'latest',
				resource: 'ghcr.iodevcontainers/features'
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
		it('should fail parsing a generic tar with no feature and trailing slash', async function () {
			const feature: DevContainerFeature = {
				id: 'https://example.com/some/long/path/devcontainer-features.tgz/',
				options: {},
			};

			const result = await processFeatureIdentifier(output, process.env, feature);
			assert.notExists(result);
		});

		it('should not parse gitHub without triple slash', async function () {
			const feature: DevContainerFeature = {
				id: 'octocat/myfeatures#helloworld',
				options: {},
			};

			const result = await processFeatureIdentifier(output, process.env, feature);
			assert.notExists(result);
		});

		it('should fail parsing a generic tar with no feature and no trailing slash', async function () {
			const feature: DevContainerFeature = {
				id: 'https://example.com/some/long/path/devcontainer-features.tgz',
				options: {},
			};

			const result = await processFeatureIdentifier(output, process.env, feature);
			assert.notExists(result);
		});

		it('should fail parsing a generic tar with a hash but no feature', async function () {
			const feature: DevContainerFeature = {
				id: 'https://example.com/some/long/path/devcontainer-features.tgz#',
				options: {},
			};

			const result = await processFeatureIdentifier(output, process.env, feature);
			assert.notExists(result);
		});

		it('should fail parsing a marketplace shorthand with only two segments and a hash with no feature', async function () {
			const feature: DevContainerFeature = {
				id: 'octocat/myfeatures#',
				options: {},
			};

			const result = await processFeatureIdentifier(output, process.env, feature);
			assert.notExists(result);
		});

		it('should fail parsing a marketplace shorthand with only two segments (no feature)', async function () {
			const feature: DevContainerFeature = {
				id: 'octocat/myfeatures',
				options: {},
			};

			const result = await processFeatureIdentifier(output, process.env, feature);
			assert.notExists(result);
		});

		it('should fail parsing a marketplace shorthand with an invalid feature name (1)', async function () {
			const feature: DevContainerFeature = {
				id: 'octocat/myfeatures/@mycoolfeature',
				options: {},
			};

			const result = await processFeatureIdentifier(output, process.env, feature);
			assert.notExists(result);
		});

		it('should fail parsing a marketplace shorthand with an invalid feature name (2)', async function () {
			const feature: DevContainerFeature = {
				id: 'octocat/myfeatures/MY_$UPER_COOL_FEATURE',
				options: {},
			};

			const result = await processFeatureIdentifier(output, process.env, feature);
			assert.notExists(result);
		});

		it('should fail parsing a marketplace shorthand with only two segments, no hash, and with a version', async function () {
			const feature: DevContainerFeature = {
				id: 'octocat/myfeatures@v0.0.1',
				options: {},
			};

			const result = await processFeatureIdentifier(output, process.env, feature);
			assert.notExists(result);
		});
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
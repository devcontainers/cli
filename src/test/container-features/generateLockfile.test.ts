/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { assert } from 'chai';
import { URI } from 'vscode-uri';
import { DevContainerConfig } from '../../spec-configuration/configuration';
import {
	DirectTarballSourceInformation,
	FeatureSet,
	FeaturesConfig,
	OCISourceInformation,
} from '../../spec-configuration/containerFeaturesConfiguration';
import { generateLockfile } from '../../spec-configuration/lockfile';

function makeOciFeatureSet(userFeatureId: string, version: string, digest: string): FeatureSet {
	const sourceInformation: OCISourceInformation = {
		type: 'oci',
		userFeatureId,
		userFeatureIdWithoutVersion: userFeatureId.split(':')[0],
		manifestDigest: digest,
		manifest: {} as any,
		featureRef: {
			registry: 'ghcr.io',
			owner: 'devcontainers',
			namespace: 'devcontainers/features',
			path: `devcontainers/features/${userFeatureId.split('/').pop()!.split(':')[0]}`,
			resource: `ghcr.io/${userFeatureId.split(':')[0]}`,
			id: userFeatureId.split('/').pop()!.split(':')[0],
			version,
			tag: version,
		},
	};
	return {
		sourceInformation,
		computedDigest: digest,
		features: [
			{
				id: sourceInformation.featureRef.id,
				version,
				value: true,
				included: true,
			},
		],
	};
}

function makeTarballFeatureSet(userFeatureId: string, tarballUri: string, digest: string): FeatureSet {
	const sourceInformation: DirectTarballSourceInformation = {
		type: 'direct-tarball',
		userFeatureId,
		tarballUri,
	};
	return {
		sourceInformation,
		computedDigest: digest,
		features: [
			{
				id: 'mytarball',
				version: '1.0.0',
				value: true,
				included: true,
			},
		],
	};
}

const mockConfigFilePath = URI.file('/workspace/myProject/.devcontainer/devcontainer.json');

describe('generateLockfile', () => {

	it('includes all features when no additionalFeatures are provided', async () => {
		const featureSets: FeatureSet[] = [
			makeOciFeatureSet('ghcr.io/devcontainers/features/node:1', '1.0.0', 'sha256:aaa'),
			makeOciFeatureSet('ghcr.io/devcontainers/features/git:1', '1.0.0', 'sha256:bbb'),
		];
		const featuresConfig: FeaturesConfig = { featureSets };

		const lockfile = await generateLockfile(featuresConfig);

		assert.deepEqual(Object.keys(lockfile.features).sort(), [
			'ghcr.io/devcontainers/features/git:1',
			'ghcr.io/devcontainers/features/node:1',
		]);
	});

	it('excludes features supplied only via additionalFeatures', async () => {
		const featureSets: FeatureSet[] = [
			makeOciFeatureSet('ghcr.io/devcontainers/features/node:1', '1.0.0', 'sha256:aaa'),
			makeOciFeatureSet('ghcr.io/devcontainers/features/git:1', '1.0.0', 'sha256:bbb'),
		];
		const featuresConfig: FeaturesConfig = { featureSets };

		const config: DevContainerConfig = {
			configFilePath: mockConfigFilePath,
			features: {
				'ghcr.io/devcontainers/features/node:1': {},
			},
		};
		const additionalFeatures = {
			'ghcr.io/devcontainers/features/git:1': true,
		};

		const lockfile = await generateLockfile(featuresConfig, config, additionalFeatures);

		assert.deepEqual(Object.keys(lockfile.features), ['ghcr.io/devcontainers/features/node:1']);
	});

	it('keeps features that appear in both config.features and additionalFeatures', async () => {
		const featureSets: FeatureSet[] = [
			makeOciFeatureSet('ghcr.io/devcontainers/features/node:1', '1.0.0', 'sha256:aaa'),
		];
		const featuresConfig: FeaturesConfig = { featureSets };

		const config: DevContainerConfig = {
			configFilePath: mockConfigFilePath,
			features: {
				'ghcr.io/devcontainers/features/node:1': {},
			},
		};
		const additionalFeatures = {
			'ghcr.io/devcontainers/features/node:1': true,
		};

		const lockfile = await generateLockfile(featuresConfig, config, additionalFeatures);

		assert.deepEqual(Object.keys(lockfile.features), ['ghcr.io/devcontainers/features/node:1']);
	});

	it('excludes additional-only direct-tarball features', async () => {
		const featureSets: FeatureSet[] = [
			makeOciFeatureSet('ghcr.io/devcontainers/features/node:1', '1.0.0', 'sha256:aaa'),
			makeTarballFeatureSet('https://example.com/devcontainer-feature-mytarball.tgz', 'https://example.com/devcontainer-feature-mytarball.tgz', 'sha256:ccc'),
		];
		const featuresConfig: FeaturesConfig = { featureSets };

		const config: DevContainerConfig = {
			configFilePath: mockConfigFilePath,
			features: {
				'ghcr.io/devcontainers/features/node:1': {},
			},
		};
		const additionalFeatures = {
			'https://example.com/devcontainer-feature-mytarball.tgz': true,
		};

		const lockfile = await generateLockfile(featuresConfig, config, additionalFeatures);

		assert.deepEqual(Object.keys(lockfile.features), ['ghcr.io/devcontainers/features/node:1']);
	});

	it('excludes all features when config.features is empty and additionalFeatures provides them all', async () => {
		const featureSets: FeatureSet[] = [
			makeOciFeatureSet('ghcr.io/devcontainers/features/node:1', '1.0.0', 'sha256:aaa'),
			makeOciFeatureSet('ghcr.io/devcontainers/features/git:1', '1.0.0', 'sha256:bbb'),
		];
		const featuresConfig: FeaturesConfig = { featureSets };

		const config: DevContainerConfig = {
			configFilePath: mockConfigFilePath,
		};
		const additionalFeatures = {
			'ghcr.io/devcontainers/features/node:1': true,
			'ghcr.io/devcontainers/features/git:1': true,
		};

		const lockfile = await generateLockfile(featuresConfig, config, additionalFeatures);

		assert.deepEqual(lockfile.features, {});
	});
});

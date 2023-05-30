/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import * as assert from 'assert';

import { fetchFeatureAdvisories } from '../../spec-configuration/featureAdvisories';
import { Feature, FeaturesConfig } from '../../spec-configuration/containerFeaturesConfiguration';
import { getRef } from '../../spec-configuration/containerCollectionsOCI';
import { output } from '../testUtils';
import { FeatureAdvisory } from '../../spec-configuration/controlManifest';


describe('Feature Advisories', function () {
	
	const cacheFolder = path.join(os.tmpdir(), `devcontainercli-test-${crypto.randomUUID()}`);
	const featureId = 'ghcr.io/devcontainers/features/feature-with-advisory';
	const otherFeatureId = 'ghcr.io/devcontainers/features/other-feature';

	it('match feature in version range', async () => {
		const advisories = await fetchFeatureAdvisories({ cacheFolder, output }, getFeaturesConfig(featureId, '1', '1.0.9'));
		assertTestAdvisory(advisories, featureId, '1.0.9');
		
		const advisories2 = await fetchFeatureAdvisories({ cacheFolder, output }, getFeaturesConfig(featureId, '1.1', '1.1.5'));
		assertTestAdvisory(advisories2, featureId, '1.1.5');
	});

	it('match feature at version range', async () => {
		const advisories = await fetchFeatureAdvisories({ cacheFolder, output }, getFeaturesConfig(featureId, '1', '1.0.7'));
		assertTestAdvisory(advisories, featureId, '1.0.7');

		const advisories2 = await fetchFeatureAdvisories({ cacheFolder, output }, getFeaturesConfig(featureId, '1.1', '1.1.9'));
		assertTestAdvisory(advisories2, featureId, '1.1.9');
	});

	it('miss feature outside version range', async () => {
		const advisories = await fetchFeatureAdvisories({ cacheFolder, output }, getFeaturesConfig(featureId, '1', '1.0.2'));
		assert.strictEqual(advisories.length, 0);
		
		const advisories2 = await fetchFeatureAdvisories({ cacheFolder, output }, getFeaturesConfig(featureId, '1.1', '1.2.1'));
		assert.strictEqual(advisories2.length, 0);
	});

	it('miss feature at version range', async () => {
		const advisories = await fetchFeatureAdvisories({ cacheFolder, output }, getFeaturesConfig(featureId, '1', '1.0.6'));
		assert.strictEqual(advisories.length, 0);
		
		const advisories2 = await fetchFeatureAdvisories({ cacheFolder, output }, getFeaturesConfig(featureId, '1.1', '1.1.10'));
		assert.strictEqual(advisories2.length, 0);
	});

	it('miss other feature', async () => {
		const advisories = await fetchFeatureAdvisories({ cacheFolder, output }, getFeaturesConfig(otherFeatureId, '1', '1.0.9'));
		assert.strictEqual(advisories.length, 0);
	});
});

function assertTestAdvisory(advisories: { feature: { id: string; version: string }; advisories: FeatureAdvisory[] }[], featureId: string, actualVersion: string) {
	assert.strictEqual(advisories.length, 1);
	assert.strictEqual(advisories[0].feature.id, featureId);
	assert.strictEqual(advisories[0].feature.version, actualVersion);
	assert.strictEqual(advisories[0].advisories.length, 1);
	assert.strictEqual(advisories[0].advisories[0].featureId, featureId);
	assert.strictEqual(advisories[0].advisories[0].introducedInVersion, '1.0.7');
	assert.strictEqual(advisories[0].advisories[0].fixedInVersion, '1.1.10');
}

function getFeaturesConfig(featureId: string, featureConfigVersion: string, featureResolvedVersion: string): FeaturesConfig {
	const feature: Feature = {
		id: `${featureId}:${featureConfigVersion}`,
		version: featureResolvedVersion,
		value: 'someValue',
		included: true,
		consecutiveId: 'someFeature_1',
	};
	return {
		featureSets: [
			{
				features: [feature],
				sourceInformation: {
					type: 'oci',
					userFeatureId: `${featureId}:${featureConfigVersion}`,
					userFeatureIdWithoutVersion: featureId,
					featureRef: getRef(output, `${featureId}:${featureConfigVersion}`)!,
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
			}
		]
	};
}

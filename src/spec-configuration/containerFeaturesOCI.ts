import { Log, LogLevel } from '../spec-utils/log';
import { Feature, FeatureSet } from './containerFeaturesConfiguration';
import { fetchOCIManifestIfExists, getBlob, getRef, OCIManifest } from './containerCollectionsOCI';

export function tryGetOCIFeatureSet(output: Log, identifier: string, options: boolean | string | Record<string, boolean | string | undefined>, manifest: OCIManifest, originalUserFeatureId: string): FeatureSet | undefined {
	const featureRef = getRef(output, identifier);
	if (!featureRef) {
		output.write(`Unable to parse '${identifier}'`, LogLevel.Error);
		return undefined;
	}

	const feat: Feature = {
		id: featureRef.id,
		included: true,
		value: options
	};

	const userFeatureIdWithoutVersion = originalUserFeatureId.split(':')[0];
	let featureSet: FeatureSet = {
		sourceInformation: {
			type: 'oci',
			manifest: manifest,
			featureRef: featureRef,
			userFeatureId: originalUserFeatureId,
			userFeatureIdWithoutVersion

		},
		features: [feat],
	};

	return featureSet;
}

export async function fetchOCIFeatureManifestIfExistsFromUserIdentifier(output: Log, env: NodeJS.ProcessEnv, identifier: string, manifestDigest?: string, authToken?: string): Promise<OCIManifest | undefined> {
	const featureRef = getRef(output, identifier);
	if (!featureRef) {
		return undefined;
	}
	return await fetchOCIManifestIfExists(output, env, featureRef, manifestDigest, authToken);
}

// Download a feature from which a manifest was previously downloaded.
// Specification: https://github.com/opencontainers/distribution-spec/blob/v1.0.1/spec.md#pulling-blobs
export async function fetchOCIFeature(output: Log, env: NodeJS.ProcessEnv, featureSet: FeatureSet, ociCacheDir: string, featCachePath: string): Promise<boolean> {

	if (featureSet.sourceInformation.type !== 'oci') {
		output.write(`FeatureSet is not an OCI featureSet.`, LogLevel.Error);
		throw new Error('FeatureSet is not an OCI featureSet.');
	}

	const { featureRef } = featureSet.sourceInformation;

	const blobUrl = `https://${featureSet.sourceInformation.featureRef.registry}/v2/${featureSet.sourceInformation.featureRef.path}/blobs/${featureSet.sourceInformation.manifest?.layers[0].digest}`;
	output.write(`blob url: ${blobUrl}`, LogLevel.Trace);

	const blobResult = await getBlob(output, env, blobUrl, ociCacheDir, featCachePath, featureRef);

	if (!blobResult) {
		throw new Error(`Failed to download package for ${featureSet.sourceInformation.featureRef.resource}`);
	}

	return true;
}

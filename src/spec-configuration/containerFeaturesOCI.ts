import * as path from 'path';
import * as tar from 'tar';
import { request } from '../spec-utils/httpRequest';
import { Log, LogLevel } from '../spec-utils/log';
import { mkdirpLocal, writeLocalFile } from '../spec-utils/pfs';
import { Feature, FeatureSet } from './containerFeaturesConfiguration';
import { fetchOCIManifestIfExists, fetchRegistryAuthToken, getRef, HEADERS, OCIManifest, OCIRef } from './containerCollectionsOCI';

export function getOCIFeatureSet(output: Log, identifier: string, options: boolean | string | Record<string, boolean | string | undefined>, manifest: OCIManifest, originalUserFeatureId: string): FeatureSet {

	const featureRef = getRef(output, identifier);

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

	const success = await getFeatureBlob(output, env, blobUrl, ociCacheDir, featCachePath, featureRef);

	if (!success) {
		throw new Error(`Failed to download package for ${featureSet.sourceInformation.featureRef.resource}`);
	}

	return true;
}

// Downloads a blob from a registry.
export async function getFeatureBlob(output: Log, env: NodeJS.ProcessEnv, url: string, ociCacheDir: string, featCachePath: string, featureRef: OCIRef, authToken?: string): Promise<boolean> {
	// TODO: Parallelize if multiple layers (not likely).
	// TODO: Seeking might be needed if the size is too large.
	try {
		const tempTarballPath = path.join(ociCacheDir, 'blob.tar');

		const headers: HEADERS = {
			'user-agent': 'devcontainer',
			'accept': 'application/vnd.oci.image.manifest.v1+json',
		};

		const auth = authToken ?? await fetchRegistryAuthToken(output, featureRef.registry, featureRef.path, env, 'pull');
		if (auth) {
			headers['authorization'] = `Bearer ${auth}`;
		}

		const options = {
			type: 'GET',
			url: url,
			headers: headers
		};

		const blob = await request(options, output);

		await mkdirpLocal(featCachePath);
		await writeLocalFile(tempTarballPath, blob);
		await tar.x(
			{
				file: tempTarballPath,
				cwd: featCachePath,
			}
		);

		return true;
	} catch (e) {
		output.write(`error: ${e}`, LogLevel.Error);
		return false;
	}
}

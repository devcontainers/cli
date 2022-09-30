import * as path from 'path';
import * as tar from 'tar';
import * as semver from 'semver';
import { request } from '../spec-utils/httpRequest';
import { Log, LogLevel } from '../spec-utils/log';
import { mkdirpLocal, writeLocalFile } from '../spec-utils/pfs';
import { Feature, FeatureSet } from './containerFeaturesConfiguration';

export type HEADERS = { 'authorization'?: string; 'user-agent': string; 'content-type'?: string; 'accept'?: string };

export const DEVCONTAINER_MANIFEST_MEDIATYPE = 'application/vnd.devcontainers';
export const DEVCONTAINER_TAR_LAYER_MEDIATYPE = 'application/vnd.devcontainers.layer.v1+tar';
export const DEVCONTAINER_COLLECTION_LAYER_MEDIATYPE = 'application/vnd.devcontainers.collection.layer.v1+json';

// ghcr.io/devcontainers/features/go:1.0.0
export interface OCIFeatureRef {
	registry: string; 		// 'ghcr.io'
	owner: string;			// 'devcontainers'
	namespace: string;		// 'devcontainers/features'
	path: string;			// 'devcontainers/features/go'
	resource: string;		// 'ghcr.io/devcontainers/features/go'
	id: string;				// 'go'
	version?: string;		// '1.0.0'
}

// ghcr.io/devcontainers/features:latest
export interface OCIFeatureCollectionRef {
	registry: string;		// 'ghcr.io'
	path: string;			// 'devcontainers/features'
	version: 'latest';		// 'latest'
}

export interface OCILayer {
	mediaType: string;
	digest: string;
	size: number;
	annotations: {
		'org.opencontainers.image.title': string;
	};
}
export interface OCIManifest {
	digest?: string;
	schemaVersion: number;
	mediaType: string;
	config: {
		digest: string;
		mediaType: string;
		size: number;
	};
	layers: OCILayer[];
	annotations?: {};
}

interface OCITagList {
	name: string;
	tags: string[];
}

export function getOCIFeatureSet(output: Log, identifier: string, options: boolean | string | Record<string, boolean | string | undefined>, manifest: OCIManifest, originalUserFeatureId: string): FeatureSet {

	const featureRef = getFeatureRef(output, identifier);

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

export function getFeatureRef(output: Log, resourceAndVersion: string): OCIFeatureRef {

	// ex: ghcr.io/codspace/features/ruby:1
	const splitOnColon = resourceAndVersion.split(':');
	const resource = splitOnColon[0];
	const version = splitOnColon[1] ? splitOnColon[1] : 'latest';

	const splitOnSlash = resource.split('/');

	const id = splitOnSlash[splitOnSlash.length - 1]; // Aka 'featureName' - Eg: 'ruby'
	const owner = splitOnSlash[1];
	const registry = splitOnSlash[0];
	const namespace = splitOnSlash.slice(1, -1).join('/');

	const path = `${namespace}/${id}`;

	output.write(`resource: ${resource}`, LogLevel.Trace);
	output.write(`id: ${id}`, LogLevel.Trace);
	output.write(`version: ${version}`, LogLevel.Trace);
	output.write(`owner: ${owner}`, LogLevel.Trace);
	output.write(`namespace: ${namespace}`, LogLevel.Trace);
	output.write(`registry: ${registry}`, LogLevel.Trace);
	output.write(`path: ${path}`, LogLevel.Trace);

	return {
		id,
		version,
		owner,
		namespace,
		registry,
		resource,
		path,
	};
}


export async function fetchOCIFeatureManifestIfExistsFromUserIdentifier(output: Log, env: NodeJS.ProcessEnv, identifier: string, manifestDigest?: string, authToken?: string): Promise<OCIManifest | undefined> {
	const featureRef = getFeatureRef(output, identifier);
	return await fetchOCIFeatureManifestIfExists(output, env, featureRef, manifestDigest, authToken);
}

// Validate if a manifest exists and is reachable about the declared feature.
// Specification: https://github.com/opencontainers/distribution-spec/blob/v1.0.1/spec.md#pulling-manifests
export async function fetchOCIFeatureManifestIfExists(output: Log, env: NodeJS.ProcessEnv, featureRef: OCIFeatureRef | OCIFeatureCollectionRef, manifestDigest?: string, authToken?: string): Promise<OCIManifest | undefined> {
	// Simple mechanism to avoid making a DNS request for 
	// something that is not a domain name.
	if (featureRef.registry.indexOf('.') < 0) {
		return undefined;
	}

	// TODO: Always use the manifest digest (the canonical digest) 
	//       instead of the `featureRef.version` by referencing some lock file (if available).
	let reference = featureRef.version;
	if (manifestDigest) {
		reference = manifestDigest;
	}
	const manifestUrl = `https://${featureRef.registry}/v2/${featureRef.path}/manifests/${reference}`;
	output.write(`manifest url: ${manifestUrl}`, LogLevel.Trace);
	const manifest = await getFeatureManifest(output, env, manifestUrl, featureRef, authToken);

	if (!manifest) {
		return;
	}

	if (manifest?.config.mediaType !== DEVCONTAINER_MANIFEST_MEDIATYPE) {
		output.write(`(!) Unexpected manifest media type: ${manifest?.config.mediaType}`, LogLevel.Error);
		return undefined;
	}

	return manifest;
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

export async function getFeatureManifest(output: Log, env: NodeJS.ProcessEnv, url: string, featureRef: OCIFeatureRef | OCIFeatureCollectionRef, authToken?: string): Promise<OCIManifest | undefined> {
	try {
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

		const response = await request(options);
		const manifest: OCIManifest = JSON.parse(response.toString());

		return manifest;
	} catch (e) {
		return undefined;
	}
}

// Downloads a blob from a registry.
export async function getFeatureBlob(output: Log, env: NodeJS.ProcessEnv, url: string, ociCacheDir: string, featCachePath: string, featureRef: OCIFeatureRef, authToken?: string): Promise<boolean> {
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

// https://github.com/oras-project/oras-go/blob/97a9c43c52f9d89ecf5475bc59bd1f96c8cc61f6/registry/remote/auth/scope.go#L60-L74
export async function fetchRegistryAuthToken(output: Log, registry: string, ociRepoPath: string, env: NodeJS.ProcessEnv, operationScopes: string): Promise<string | undefined> {
	const headers: HEADERS = {
		'user-agent': 'devcontainer'
	};

	// TODO: Read OS keychain/docker config for auth in various registries!

	let userToken = '';
	if (!!env['GITHUB_TOKEN'] && registry === 'ghcr.io') {
		userToken = env['GITHUB_TOKEN'];
	} else if (!!env['DEVCONTAINERS_OCI_AUTH']) {
		// eg: DEVCONTAINERS_OCI_AUTH=domain1:token1,domain2:token2
		const authContexts = env['DEVCONTAINERS_OCI_AUTH'].split(',');
		const authContext = authContexts.find(a => a.split(':')[0] === registry);
		if (authContext && authContext.length === 2) {
			userToken = authContext.split(':')[1];
		}
	} else {
		output.write('No oauth authentication credentials found.', LogLevel.Trace);
	}

	if (userToken) {
		const base64Encoded = Buffer.from(`USERNAME:${userToken}`).toString('base64');
		headers['authorization'] = `Basic ${base64Encoded}`;
	}

	const url = `https://${registry}/token?scope=repo:${ociRepoPath}:${operationScopes}&service=${registry}`;
	output.write(`url: ${url}`, LogLevel.Trace);

	const options = {
		type: 'GET',
		url: url,
		headers: headers
	};

	let authReq: Buffer;
	try {
		authReq = await request(options, output);
	} catch (e: any) {
		output.write(`Failed to get registry auth token with error: ${e}`, LogLevel.Error);
		return undefined;
	}

	if (!authReq) {
		output.write('Failed to get registry auth token', LogLevel.Error);
		return undefined;
	}

	const token: string | undefined = JSON.parse(authReq.toString())?.token;
	if (!token) {
		output.write('Failed to parse registry auth token response', LogLevel.Error);
		return undefined;
	}
	return token;
}

// Lists published versions/tags of a feature 
// Specification: https://github.com/opencontainers/distribution-spec/blob/v1.0.1/spec.md#content-discovery
export async function getPublishedVersions(featureRef: OCIFeatureRef, output: Log, sorted: boolean = false): Promise<string[] | undefined> {
	try {
		const url = `https://${featureRef.registry}/v2/${featureRef.namespace}/${featureRef.id}/tags/list`;

		let authToken = await fetchRegistryAuthToken(output, featureRef.registry, featureRef.path, process.env, 'pull');

		if (!authToken) {
			output.write(`(!) ERR: Failed to publish feature: ${featureRef.resource}`, LogLevel.Error);
			return undefined;
		}

		const headers: HEADERS = {
			'user-agent': 'devcontainer',
			'accept': 'application/json',
			'authorization': `Bearer ${authToken}`
		};

		const options = {
			type: 'GET',
			url: url,
			headers: headers
		};

		const response = await request(options);
		const publishedVersionsResponse: OCITagList = JSON.parse(response.toString());

		if (!sorted) {
			return publishedVersionsResponse.tags;
		}

		// Sort tags in descending order, removing latest.
		const hasLatest = publishedVersionsResponse.tags.includes('latest');
		const sortedVersions = publishedVersionsResponse.tags
			.filter(f => f !== 'latest')
			.sort((a, b) => semver.compareIdentifiers(a, b));


		return hasLatest ? ['latest', ...sortedVersions] : sortedVersions;
	} catch (e) {
		// Publishing for the first time
		if (e?.message.includes('HTTP 404: Not Found')) {
			return [];
		}

		output.write(`(!) ERR: Could not fetch published tags for '${featureRef.namespace}/${featureRef.id}' : ${e?.message ?? ''} `, LogLevel.Trace);
		return undefined;
	}
}

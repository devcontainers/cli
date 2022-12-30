import path from 'path';
import * as semver from 'semver';
import * as tar from 'tar';
import * as jsonc from 'jsonc-parser';

import { Log, LogLevel } from '../spec-utils/log';
import { isLocalFile, mkdirpLocal, readLocalFile, writeLocalFile } from '../spec-utils/pfs';
import { requestEnsureAuthenticated } from './httpOCIRegistry';

export const DEVCONTAINER_MANIFEST_MEDIATYPE = 'application/vnd.devcontainers';
export const DEVCONTAINER_TAR_LAYER_MEDIATYPE = 'application/vnd.devcontainers.layer.v1+tar';
export const DEVCONTAINER_COLLECTION_LAYER_MEDIATYPE = 'application/vnd.devcontainers.collection.layer.v1+json';


export interface CommonParams {
	env: NodeJS.ProcessEnv;
	output: Log;
	cachedAuthHeader?: string;
}

// Represents the unique OCI identifier for a Feature or Template.
// eg:  ghcr.io/devcontainers/features/go:1.0.0
// Constructed by 'getRef()'
export interface OCIRef {
	registry: string; 		// 'ghcr.io'
	owner: string;			// 'devcontainers'
	namespace: string;		// 'devcontainers/features'
	path: string;			// 'devcontainers/features/go'
	resource: string;		// 'ghcr.io/devcontainers/features/go'
	id: string;				// 'go'
	version?: string;		// '1.0.0'
}

// Represents the unique OCI identifier for a Collection's Metadata artifact.
// eg:  ghcr.io/devcontainers/features:latest
// Constructed by 'getCollectionRef()'
export interface OCICollectionRef {
	registry: string;		// 'ghcr.io'
	path: string;			// 'devcontainers/features'
	resource: string;		// 'ghcr.io/devcontainers/features'
	version: 'latest';		// 'latest' (always)
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

// Following Spec:   https://github.com/opencontainers/distribution-spec/blob/main/spec.md#pulling-manifests
// Alternative Spec: https://docs.docker.com/registry/spec/api/#overview
//
// Entire path ('namespace' in spec terminology) for the given repository 
// (eg: devcontainers/features/go)
const regexForPath = /^[a-z0-9]+([._-][a-z0-9]+)*(\/[a-z0-9]+([._-][a-z0-9]+)*)*$/;
// MUST be either (a) the digest of the manifest or (b) a tag
// MUST be at most 128 characters in length and MUST match the following regular expression:
const regexForReference = /^[a-zA-Z0-9_][a-zA-Z0-9._-]{0,127}$/;

// https://github.com/opencontainers/distribution-spec/blob/main/spec.md#pulling-manifests
// Attempts to parse the given string into an OCIRef
export function getRef(output: Log, input: string): OCIRef | undefined {
	// Normalize input by downcasing entire string
	input = input.toLowerCase();

	const indexOfLastColon = input.lastIndexOf(':');

	let resource = '';
	let version = ''; // TODO: Support parsing out manifest digest (...@sha256:...)

	// 'If' condition is true in the following cases:
	//  1. The final colon is before the first slash (a port) :  eg:   ghcr.io:8081/codspace/features/ruby
	//  2. There is no version :      				   			 eg:   ghcr.io/codspace/features/ruby
	// In both cases, assume 'latest' tag.
	if (indexOfLastColon === -1 || indexOfLastColon < input.indexOf('/')) {
		resource = input;
		version = 'latest';
	} else {
		resource = input.substring(0, indexOfLastColon);
		version = input.substring(indexOfLastColon + 1);
	}

	const splitOnSlash = resource.split('/');

	const id = splitOnSlash[splitOnSlash.length - 1]; // Aka 'featureName' - Eg: 'ruby'
	const owner = splitOnSlash[1];
	const registry = splitOnSlash[0];
	const namespace = splitOnSlash.slice(1, -1).join('/');

	const path = `${namespace}/${id}`;

	output.write(`> input: ${input}`, LogLevel.Trace);
	output.write(`>`, LogLevel.Trace);
	output.write(`> resource: ${resource}`, LogLevel.Trace);
	output.write(`> id: ${id}`, LogLevel.Trace);
	output.write(`> version: ${version}`, LogLevel.Trace);
	output.write(`> owner: ${owner}`, LogLevel.Trace);
	output.write(`> namespace: ${namespace}`, LogLevel.Trace); // TODO: We assume 'namespace' includes at least one slash (eg: 'devcontainers/features')
	output.write(`> registry: ${registry}`, LogLevel.Trace);
	output.write(`> path: ${path}`, LogLevel.Trace);

	// Validate results of parse.

	if (!regexForPath.exec(path)) {
		output.write(`Parsed path '${path}' for input '${input}' failed validation.`, LogLevel.Error);
		return undefined;
	}

	if (!regexForReference.test(version)) {
		output.write(`Parsed version '${version}' for input '${input}' failed validation.`, LogLevel.Error);
		return undefined;
	}

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

export function getCollectionRef(output: Log, registry: string, namespace: string): OCICollectionRef | undefined {
	// Normalize input by downcasing entire string
	registry = registry.toLowerCase();
	namespace = namespace.toLowerCase();

	const path = namespace;
	const resource = `${registry}/${path}`;

	output.write(`> Inputs: registry='${registry}' namespace='${namespace}'`, LogLevel.Trace);
	output.write(`>`, LogLevel.Trace);
	output.write(`> resource: ${resource}`, LogLevel.Trace);

	if (!regexForPath.exec(path)) {
		output.write(`Parsed path '${path}' from input failed validation.`, LogLevel.Error);
		return undefined;
	}

	return {
		registry,
		path,
		resource,
		version: 'latest'
	};
}

// Validate if a manifest exists and is reachable about the declared feature/template.
// Specification: https://github.com/opencontainers/distribution-spec/blob/v1.0.1/spec.md#pulling-manifests
export async function fetchOCIManifestIfExists(params: CommonParams, ref: OCIRef | OCICollectionRef, manifestDigest?: string): Promise<OCIManifest | undefined> {
	const { output } = params;

	// Simple mechanism to avoid making a DNS request for 
	// something that is not a domain name.
	if (ref.registry.indexOf('.') < 0 && !ref.registry.startsWith('localhost')) {
		output.write(`ERR: Registry '${ref.registry}' is not a valid domain name or IP address.`, LogLevel.Error);
		return undefined;
	}

	// TODO: Always use the manifest digest (the canonical digest) 
	//       instead of the `ref.version` by referencing some lock file (if available).
	let reference = ref.version;
	if (manifestDigest) {
		reference = manifestDigest;
	}
	const manifestUrl = `https://${ref.registry}/v2/${ref.path}/manifests/${reference}`;
	output.write(`manifest url: ${manifestUrl}`, LogLevel.Trace);
	const manifest = await getManifest(params, manifestUrl, ref);

	if (!manifest) {
		return;
	}

	if (manifest?.config.mediaType !== DEVCONTAINER_MANIFEST_MEDIATYPE) {
		output.write(`(!) Unexpected manifest media type: ${manifest?.config.mediaType}`, LogLevel.Error);
		return undefined;
	}

	return manifest;
}

export async function getManifest(params: CommonParams, url: string, ref: OCIRef | OCICollectionRef, mimeType?: string): Promise<OCIManifest | undefined> {
	const { output } = params;
	let body: string = '';
	try {
		const headers = {
			'user-agent': 'devcontainer',
			'accept': mimeType || 'application/vnd.oci.image.manifest.v1+json',
		};

		const httpOptions = {
			type: 'GET',	
			url: url,
			headers: headers
		};

		const res = await requestEnsureAuthenticated(params, httpOptions, ref);
		if (!res) {
			output.write('Request failed', LogLevel.Error);
			return;
		}

		const { resBody, statusCode } = res;
		body = resBody.toString();

		// NOTE: A 404 is expected here if the manifest does not exist on the remote.
		if (statusCode > 299) {
			output.write(`Did not fetch manifest: ${body}`, LogLevel.Trace);
			return;
		}

		return JSON.parse(body);
	} catch (e) {
		output.write(`Failed to parse manifest: ${body}`, LogLevel.Error);
		return;
	}
}

// Lists published versions/tags of a feature/template 
// Specification: https://github.com/opencontainers/distribution-spec/blob/v1.0.1/spec.md#content-discovery
export async function getPublishedVersions(params: CommonParams, ref: OCIRef, sorted: boolean = false): Promise<string[] | undefined> {
	const { output } = params;
	try {
		const url = `https://${ref.registry}/v2/${ref.namespace}/${ref.id}/tags/list`;

		const headers = {
			'accept': 'application/json',
		};

		const httpOptions = {
			type: 'GET',
			url: url,
			headers: headers
		};

		const res = await requestEnsureAuthenticated(params, httpOptions, ref);
		if (!res) {
			output.write('Request failed', LogLevel.Error);
			return;
		}

		const { statusCode, resBody } = res;
		const body = resBody.toString();

		// Expected when publishing for the first time
		if (statusCode === 404) {
			return [];
			// Unexpected Error
		} else if (statusCode > 299) {
			output.write(`(!) ERR: Could not fetch published tags for '${ref.namespace}/${ref.id}' : ${resBody ?? ''} `, LogLevel.Error);
			return;
		}

		const publishedVersionsResponse: OCITagList = JSON.parse(body);

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
		output.write(`Failed to parse published versions: ${e}`, LogLevel.Error);
		return;
	}
}

export async function getBlob(params: CommonParams, url: string, ociCacheDir: string, destCachePath: string, ociRef: OCIRef, ignoredFilesDuringExtraction: string[] = [], metadataFile?: string): Promise<{ files: string[]; metadata: {} | undefined } | undefined> {
	// TODO: Parallelize if multiple layers (not likely).
	// TODO: Seeking might be needed if the size is too large.

	const { output } = params;
	try {
		await mkdirpLocal(ociCacheDir);
		const tempTarballPath = path.join(ociCacheDir, 'blob.tar');

		const headers = {
			'accept': 'application/vnd.oci.image.manifest.v1+json',
		};

		const httpOptions = {
			type: 'GET',
			url: url,
			headers: headers
		};

		const res = await requestEnsureAuthenticated(params, httpOptions, ociRef);
		if (!res) {
			output.write('Request failed', LogLevel.Error);
			return;
		}

		const { statusCode, resBody } = res;
		if (statusCode > 299) {
			output.write(`Failed to fetch blob (${url}): ${resBody}`, LogLevel.Error);
			return;
		}

		await mkdirpLocal(destCachePath);
		await writeLocalFile(tempTarballPath, resBody);

		const files: string[] = [];
		await tar.x(
			{
				file: tempTarballPath,
				cwd: destCachePath,
				filter: (path: string, stat: tar.FileStat) => {
					// Skip files that are in the ignore list
					if (ignoredFilesDuringExtraction.some(f => path.indexOf(f) !== -1)) {
						// Skip.
						output.write(`Skipping file '${path}' during blob extraction`, LogLevel.Trace);
						return false;
					}
					// Keep track of all files extracted, in case the caller is interested.
					output.write(`${path} : ${stat.type}`, LogLevel.Trace);
					if ((stat.type.toString() === 'File')) {
						files.push(path);
					}
					return true;
				}
			}
		);
		output.write('Files extracted from blob: ' + files.join(', '), LogLevel.Trace);

		// No 'metadataFile' to look for.
		if (!metadataFile) {
			return { files, metadata: undefined };
		}

		// Attempt to extract 'metadataFile'
		await tar.x(
			{
				file: tempTarballPath,
				cwd: ociCacheDir,
				filter: (path: string, _: tar.FileStat) => {
					return path === `./${metadataFile}`;
				}
			});
		const pathToMetadataFile = path.join(ociCacheDir, metadataFile);
		let metadata = undefined;
		if (await isLocalFile(pathToMetadataFile)) {
			output.write(`Found metadata file '${metadataFile}' in blob`, LogLevel.Trace);
			metadata = jsonc.parse((await readLocalFile(pathToMetadataFile)).toString());
		}

		return {
			files, metadata
		};
	} catch (e) {
		output.write(`Error getting blob: ${e}`, LogLevel.Error);
		return;
	}
}
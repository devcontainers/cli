import path from 'path';
import * as semver from 'semver';
import * as tar from 'tar';
import * as jsonc from 'jsonc-parser';

import { request } from '../spec-utils/httpRequest';
import { Log, LogLevel } from '../spec-utils/log';
import { isLocalFile, mkdirpLocal, readLocalFile, writeLocalFile } from '../spec-utils/pfs';

export const DEVCONTAINER_MANIFEST_MEDIATYPE = 'application/vnd.devcontainers';
export const DEVCONTAINER_TAR_LAYER_MEDIATYPE = 'application/vnd.devcontainers.layer.v1+tar';
export const DEVCONTAINER_COLLECTION_LAYER_MEDIATYPE = 'application/vnd.devcontainers.collection.layer.v1+json';

export type HEADERS = { 'authorization'?: string; 'user-agent': string; 'content-type'?: string; 'accept'?: string; 'content-length'?: string };

export interface CommonParams {
	env: NodeJS.ProcessEnv;
	output: Log;
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
export async function fetchOCIManifestIfExists(params: CommonParams, ref: OCIRef | OCICollectionRef, manifestDigest?: string, authToken?: string): Promise<OCIManifest | undefined> {
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
	const manifest = await getManifest(params, manifestUrl, ref, authToken);

	if (!manifest) {
		return;
	}

	if (manifest?.config.mediaType !== DEVCONTAINER_MANIFEST_MEDIATYPE) {
		output.write(`(!) Unexpected manifest media type: ${manifest?.config.mediaType}`, LogLevel.Error);
		return undefined;
	}

	return manifest;
}

export async function getManifest(params: CommonParams, url: string, ref: OCIRef | OCICollectionRef, authToken?: string | false, mimeType?: string): Promise<OCIManifest | undefined> {
	const { output } = params;
	try {
		const headers: HEADERS = {
			'user-agent': 'devcontainer',
			'accept': mimeType || 'application/vnd.oci.image.manifest.v1+json',
		};

		const authorization = authToken ?? await fetchAuthorizationHeader(params, ref.registry, ref.path, 'pull');
		if (authorization) {
			headers['authorization'] = authorization;
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
		// A 404 is expected here if the manifest does not exist on the remote.
		output.write(`Did not fetch manifest: ${e}`, LogLevel.Trace);
		return undefined;
	}
}

// Exported Function
// Will attempt to generate/fetch the correct authorization header for subsequent requests (Bearer or Basic)
export async function fetchAuthorizationHeader(params: CommonParams, registry: string, ociRepoPath: string, operationScopes: string): Promise<string | undefined> {
	const { output } = params;

	const basicAuthTokenBase64 = await getBasicAuthCredential(params, registry);
	const scopeToken = await fetchRegistryBearerToken(params, registry, ociRepoPath, operationScopes, basicAuthTokenBase64);

	// Prefer returned a Bearer token retrieved from the /token endpoint.
	if (scopeToken) {
		output.write(`Using scope token for registry '${registry}'`, LogLevel.Trace);
		return `Bearer ${scopeToken}`;
	}

	// If all we have are Basic auth credentials, return those for the caller to use.
	if (basicAuthTokenBase64) {
		output.write(`Using basic auth token for registry '${registry}'`, LogLevel.Trace);
		return `Basic ${basicAuthTokenBase64}`;
	}

	// If we have no credentials, and we weren't able to get a scope token anonymously, return undefined.
	return undefined;
}


// * Internal helper for 'fetchAuthorizationHeader(...)'
// Attempts to get the Basic auth credentials for the provided registry.
// These may be programatically crafted via environment variables (GITHUB_TOKEN),
// parsed out of a special DEVCONTAINERS_OCI_AUTH environment variable,
// TODO: or directly read out of the local docker config file/credential helper.
async function getBasicAuthCredential(params: CommonParams, registry: string): Promise<string | undefined> {
	const { output, env } = params;

	let userToken: string | undefined = undefined;
	if (!!env['GITHUB_TOKEN'] && registry === 'ghcr.io') {
		output.write('Using environment GITHUB_TOKEN for auth', LogLevel.Trace);
		userToken = `USERNAME:${env['GITHUB_TOKEN']}`;
	} else if (!!env['DEVCONTAINERS_OCI_AUTH']) {
		// eg: DEVCONTAINERS_OCI_AUTH=realm1|user1|token1,realm2|user2|token2
		const authContexts = env['DEVCONTAINERS_OCI_AUTH'].split(',');
		const authContext = authContexts.find(a => a.split('|')[0] === registry);

		if (authContext) {
			output.write(`Using match from DEVCONTAINERS_OCI_AUTH for registry '${registry}'`, LogLevel.Trace);
			const split = authContext.split('|');
			userToken = `${split[1]}:${split[2]}`;
		}
	}

	if (userToken) {
		return Buffer.from(userToken).toString('base64');
	}

	// Represents anonymous access.
	output.write(`No authentication credentials found for registry '${registry}'.`, LogLevel.Warning);
	return undefined;
}

// * Internal helper for 'fetchAuthorizationHeader(...)'
// https://github.com/oras-project/oras-go/blob/97a9c43c52f9d89ecf5475bc59bd1f96c8cc61f6/registry/remote/auth/scope.go#L60-L74
// Using the provided Basic auth credentials, (or if none, anonymously), to ask the registry's '/token' endpoint for a token.
// Some registries (eg: ghcr.io) expect a scoped token to target resources and will not operate with just Basic Auth.
// Other registries (eg: the OCI Reference Implementation) will not return a valid token from '/token'
async function fetchRegistryBearerToken(params: CommonParams, registry: string, ociRepoPath: string, operationScopes: string, basicAuthTokenBase64: string | undefined = undefined): Promise<string | undefined> {
	const { output } = params;

	if (registry === 'mcr.microsoft.com') {
		return undefined;
	}

	const headers: HEADERS = {
		'user-agent': 'devcontainer'
	};

	if (!basicAuthTokenBase64) {
		basicAuthTokenBase64 = await getBasicAuthCredential(params, registry);
	}

	if (basicAuthTokenBase64) {
		headers['authorization'] = `Basic ${basicAuthTokenBase64}`;
	}

	const authServer = registry === 'docker.io' ? 'auth.docker.io' : registry;
	const registryServer = registry === 'docker.io' ? 'registry.docker.io' : registry;
	const url = `https://${authServer}/token?scope=repository:${ociRepoPath}:${operationScopes}&service=${registryServer}`;
	output.write(`Fetching scope token from: ${url}`, LogLevel.Trace);

	const options = {
		type: 'GET',
		url: url,
		headers: headers
	};

	let authReq: Buffer;
	try {
		authReq = await request(options, output);
	} catch (e: any) {
		// This is ok if the registry is trying to speak Basic Auth with us.
		output.write(`Not used a scoped token for ${registry}: ${e}`, LogLevel.Trace);
		return;
	}

	if (!authReq) {
		output.write('Failed to get registry auth token', LogLevel.Error);
		return undefined;
	}

	let scopeToken: string | undefined;
	try {
		scopeToken = JSON.parse(authReq.toString())?.token;
	} catch {
		// not JSON
	}
	if (!scopeToken) {
		output.write('Failed to parse registry auth token response', LogLevel.Error);
		return undefined;
	}
	return scopeToken;
}

// Lists published versions/tags of a feature/template 
// Specification: https://github.com/opencontainers/distribution-spec/blob/v1.0.1/spec.md#content-discovery
export async function getPublishedVersions(params: CommonParams, ref: OCIRef, sorted: boolean = false, collectionType: string = 'feature'): Promise<string[] | undefined> {
	const { output } = params;
	try {
		const url = `https://${ref.registry}/v2/${ref.namespace}/${ref.id}/tags/list`;

		let authorization = await fetchAuthorizationHeader(params, ref.registry, ref.path, 'pull');

		if (!authorization) {
			output.write(`(!) ERR: Failed to get published versions for ${collectionType}: ${ref.resource}`, LogLevel.Error);
			return undefined;
		}

		const headers: HEADERS = {
			'user-agent': 'devcontainer',
			'accept': 'application/json',
			'authorization': authorization
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

		output.write(`(!) ERR: Could not fetch published tags for '${ref.namespace}/${ref.id}' : ${e?.message ?? ''} `, LogLevel.Error);
		return undefined;
	}
}

export async function getBlob(params: CommonParams, url: string, ociCacheDir: string, destCachePath: string, ociRef: OCIRef, authToken?: string, ignoredFilesDuringExtraction: string[] = [], metadataFile?: string): Promise<{ files: string[]; metadata: {} | undefined } | undefined> {
	// TODO: Parallelize if multiple layers (not likely).
	// TODO: Seeking might be needed if the size is too large.

	const { output } = params;
	try {
		await mkdirpLocal(ociCacheDir);
		const tempTarballPath = path.join(ociCacheDir, 'blob.tar');

		const headers: HEADERS = {
			'user-agent': 'devcontainer',
			'accept': 'application/vnd.oci.image.manifest.v1+json',
		};

		const authorization = authToken ?? await fetchAuthorizationHeader(params, ociRef.registry, ociRef.path, 'pull');
		if (authorization) {
			headers['authorization'] = authorization;
		}

		const options = {
			type: 'GET',
			url: url,
			headers: headers
		};

		const blob = await request(options, output);

		await mkdirpLocal(destCachePath);
		await writeLocalFile(tempTarballPath, blob);

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
		output.write(`error: ${e}`, LogLevel.Error);
		return undefined;
	}
}
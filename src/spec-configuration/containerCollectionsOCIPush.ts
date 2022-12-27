import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import { delay } from '../spec-common/async';
import { headRequest, requestResolveHeaders } from '../spec-utils/httpRequest';
import { Log, LogLevel } from '../spec-utils/log';
import { isLocalFile } from '../spec-utils/pfs';
import { DEVCONTAINER_COLLECTION_LAYER_MEDIATYPE, DEVCONTAINER_TAR_LAYER_MEDIATYPE, fetchOCIManifestIfExists, fetchAuthorizationHeader, HEADERS, OCICollectionRef, OCILayer, OCIManifest, OCIRef, CommonParams } from './containerCollectionsOCI';

interface ManifestContainer {
	manifestObj: OCIManifest;
	manifestStr: string;
	contentDigest: string;
}

// (!) Entrypoint function to push a single feature/template to a registry.
//     Devcontainer Spec (features) : https://containers.dev/implementors/features-distribution/#oci-registry
//     Devcontainer Spec (templates): https://github.com/devcontainers/spec/blob/main/proposals/devcontainer-templates-distribution.md#oci-registry
//     OCI Spec                     : https://github.com/opencontainers/distribution-spec/blob/main/spec.md#push
export async function pushOCIFeatureOrTemplate(params: CommonParams, ociRef: OCIRef, pathToTgz: string, tags: string[], collectionType: string): Promise<string | undefined> {
	const { output } = params;

	output.write(`-- Starting push of ${collectionType} '${ociRef.id}' to '${ociRef.resource}' with tags '${tags.join(', ')}'`);
	output.write(`${JSON.stringify(ociRef, null, 2)}`, LogLevel.Trace);

	if (!(await isLocalFile(pathToTgz))) {
		output.write(`Blob ${pathToTgz} does not exist.`, LogLevel.Error);
		return;
	}

	const dataBytes = fs.readFileSync(pathToTgz);

	// Generate registry auth token with `pull,push` scopes.
	const authorization = await fetchAuthorizationHeader(params, ociRef.registry, ociRef.path, 'pull,push');
	if (!authorization) {
		output.write(`Failed to get registry auth token`, LogLevel.Error);
		return;
	}

	// Generate Manifest for given feature/template artifact.
	const manifest = await generateCompleteManifestForIndividualFeatureOrTemplate(output, dataBytes, pathToTgz, ociRef, collectionType);
	if (!manifest) {
		output.write(`Failed to generate manifest for ${ociRef.id}`, LogLevel.Error);
		return;
	}

	output.write(`Generated manifest: \n${JSON.stringify(manifest?.manifestObj, undefined, 4)}`, LogLevel.Trace);

	// If the exact manifest digest already exists in the registry, we don't need to push individual blobs (it's already there!) 
	const existingManifest = await fetchOCIManifestIfExists(params, ociRef, manifest.contentDigest, authorization);
	if (manifest.contentDigest && existingManifest) {
		output.write(`Not reuploading blobs, digest already exists.`, LogLevel.Trace);
		return await putManifestWithTags(output, manifest, ociRef, tags, authorization);
	}


	const blobsToPush = [
		{
			name: 'configLayer',
			digest: manifest.manifestObj.config.digest,
			contents: Buffer.alloc(0),
			size: manifest.manifestObj.config.size,
		},
		{
			name: 'tgzLayer',
			digest: manifest.manifestObj.layers[0].digest,
			size: manifest.manifestObj.layers[0].size,
			contents: dataBytes,
		}
	];


	for await (const blob of blobsToPush) {
		const { name, digest } = blob;
		const blobExistsConfigLayer = await checkIfBlobExists(output, ociRef, digest, authorization);
		output.write(`blob: '${name}'  ${blobExistsConfigLayer ? 'DOES exists' : 'DOES NOT exist'} in registry.`, LogLevel.Trace);

		// PUT blobs
		if (!blobExistsConfigLayer) {

			// Obtain session ID with `/v2/<namespace>/blobs/uploads/` 
			const blobPutLocationUriPath = await postUploadSessionId(output, ociRef, authorization);
			if (!blobPutLocationUriPath) {
				output.write(`Failed to get upload session ID`, LogLevel.Error);
				return;
			}

			if (!(await putBlob(output, blobPutLocationUriPath, ociRef, blob, authorization))) {
				output.write(`Failed to PUT blob '${name}' with digest '${digest}'`, LogLevel.Error);
				return;
			}
		}
	}

	// Send a final PUT to combine blobs and tag manifest properly.
	return await putManifestWithTags(output, manifest, ociRef, tags, authorization);
}

// (!) Entrypoint function to push a collection metadata/overview file for a set of features/templates to a registry.
//     Devcontainer Spec (features) : https://containers.dev/implementors/features-distribution/#oci-registry (see 'devcontainer-collection.json')
// 	   Devcontainer Spec (templates): https://github.com/devcontainers/spec/blob/main/proposals/devcontainer-templates-distribution.md#oci-registry  (see 'devcontainer-collection.json')
//     OCI Spec                     : https://github.com/opencontainers/distribution-spec/blob/main/spec.md#push
export async function pushCollectionMetadata(params: CommonParams, collectionRef: OCICollectionRef, pathToCollectionJson: string, collectionType: string): Promise<string | undefined> {
	const { output } = params;

	output.write(`Starting push of latest ${collectionType} collection for namespace '${collectionRef.path}' to '${collectionRef.registry}'`);
	output.write(`${JSON.stringify(collectionRef, null, 2)}`, LogLevel.Trace);

	const authorization = await fetchAuthorizationHeader(params, collectionRef.registry, collectionRef.path, 'pull,push');
	if (!authorization) {
		output.write(`Failed to get registry auth token`, LogLevel.Error);
		return;
	}

	if (!(await isLocalFile(pathToCollectionJson))) {
		output.write(`Collection Metadata was not found at expected location: ${pathToCollectionJson}`, LogLevel.Error);
		return;
	}

	const dataBytes = fs.readFileSync(pathToCollectionJson);

	// Generate Manifest for collection artifact.
	const manifest = await generateCompleteManifestForCollectionFile(output, dataBytes, collectionRef);
	if (!manifest) {
		output.write(`Failed to generate manifest for ${collectionRef.path}`, LogLevel.Error);
		return;
	}
	output.write(`Generated manifest: \n${JSON.stringify(manifest?.manifestObj, undefined, 4)}`, LogLevel.Trace);

	// If the exact manifest digest already exists in the registry, we don't need to push individual blobs (it's already there!) 
	const existingManifest = await fetchOCIManifestIfExists(params, collectionRef, manifest.contentDigest, authorization);
	if (manifest.contentDigest && existingManifest) {
		output.write(`Not reuploading blobs, digest already exists.`, LogLevel.Trace);
		return await putManifestWithTags(output, manifest, collectionRef, ['latest'], authorization);
	}

	const blobsToPush = [
		{
			name: 'configLayer',
			digest: manifest.manifestObj.config.digest,
			size: manifest.manifestObj.config.size,
			contents: Buffer.alloc(0),
		},
		{
			name: 'collectionLayer',
			digest: manifest.manifestObj.layers[0].digest,
			size: manifest.manifestObj.layers[0].size,
			contents: dataBytes,
		}
	];

	for await (const blob of blobsToPush) {
		const { name, digest } = blob;
		const blobExistsConfigLayer = await checkIfBlobExists(output, collectionRef, digest, authorization);
		output.write(`blob: '${name}' with digest '${digest}'  ${blobExistsConfigLayer ? 'already exists' : 'does not exist'} in registry.`, LogLevel.Trace);

		// PUT blobs
		if (!blobExistsConfigLayer) {

			// Obtain session ID with `/v2/<namespace>/blobs/uploads/` 
			const blobPutLocationUriPath = await postUploadSessionId(output, collectionRef, authorization);
			if (!blobPutLocationUriPath) {
				output.write(`Failed to get upload session ID`, LogLevel.Error);
				return;
			}

			if (!(await putBlob(output, blobPutLocationUriPath, collectionRef, blob, authorization))) {
				output.write(`Failed to PUT blob '${name}' with digest '${digest}'`, LogLevel.Error);
				return;
			}
		}
	}

	// Send a final PUT to combine blobs and tag manifest properly.
	// Collections are always tagged 'latest'
	return await putManifestWithTags(output, manifest, collectionRef, ['latest'], authorization);
}

// --- Helper Functions

// Spec: https://github.com/opencontainers/distribution-spec/blob/main/spec.md#pushing-manifests (PUT /manifests/<ref>)
async function putManifestWithTags(output: Log, manifest: ManifestContainer, ociRef: OCIRef | OCICollectionRef, tags: string[], authorization: string): Promise<string | undefined> {
	output.write(`Tagging manifest with tags: ${tags.join(', ')}`, LogLevel.Trace);

	const { manifestStr, contentDigest } = manifest;

	for await (const tag of tags) {
		const url = `https://${ociRef.registry}/v2/${ociRef.path}/manifests/${tag}`;
		output.write(`PUT -> '${url}'`, LogLevel.Trace);

		const options = {
			type: 'PUT',
			url,
			headers: {
				'Authorization': authorization, // Eg: 'Bearer <token>' or 'Basic <token>'
				'Content-Type': 'application/vnd.oci.image.manifest.v1+json',
			},
			data: Buffer.from(manifestStr),
		};

		let { statusCode, resHeaders, resBody } = await requestResolveHeaders(options, output);

		// Retry logic: when request fails with HTTP 429: too many requests
		if (statusCode === 429) {
			output.write(`Failed to PUT manifest for tag ${tag} due to too many requests. Retrying...`, LogLevel.Warning);
			await delay(2000);

			let response = await requestResolveHeaders(options, output);
			statusCode = response.statusCode;
			resHeaders = response.resHeaders;
		}

		if (statusCode !== 201) {
			const parsed = JSON.parse(resBody?.toString() || '{}');
			output.write(`Failed to PUT manifest for tag ${tag}\n${JSON.stringify(parsed, undefined, 4)}`, LogLevel.Error);
			return;
		}

		const dockerContentDigestResponseHeader = resHeaders['docker-content-digest'] || resHeaders['Docker-Content-Digest'];
		const locationResponseHeader = resHeaders['location'] || resHeaders['Location'];
		output.write(`Tagged: ${tag} -> ${locationResponseHeader}`, LogLevel.Info);
		output.write(`Returned Content-Digest: ${dockerContentDigestResponseHeader}`, LogLevel.Trace);
	}
	return contentDigest;
}

// Spec: https://github.com/opencontainers/distribution-spec/blob/main/spec.md#post-then-put (PUT <location>?digest=<digest>)
async function putBlob(output: Log, blobPutLocationUriPath: string, ociRef: OCIRef | OCICollectionRef, blob: { name: string; digest: string; size: number; contents: Buffer }, authorization: string): Promise<boolean> {

	const { name, digest, size, contents } = blob;

	output.write(`Starting PUT of ${name} blob '${digest}' (size=${size})`, LogLevel.Info);

	const headers: HEADERS = {
		'user-agent': 'devcontainer',
		'authorization': authorization,
		'content-type': 'application/octet-stream',
		'content-length': `${size}`
	};

	// OCI distribution spec is ambiguous on whether we get back an absolute or relative path.
	let url = '';
	if (blobPutLocationUriPath.startsWith('https://') || blobPutLocationUriPath.startsWith('http://')) {
		url = blobPutLocationUriPath;
	} else {
		url = `https://${ociRef.registry}${blobPutLocationUriPath}`;
	}

	// The <location> MAY contain critical query parameters.
	//  Additionally, it SHOULD match exactly the <location> obtained from the POST request.
	// It SHOULD NOT be assembled manually by clients except where absolute/relative conversion is necessary.
	const queryParamsStart = url.indexOf('?');
	if (queryParamsStart === -1) {
		// Just append digest to the end.
		url += `?digest=${digest}`;
	} else {
		url = url.substring(0, queryParamsStart) + `?digest=${digest}` + '&' + url.substring(queryParamsStart + 1);
	}

	output.write(`PUT blob to ->  ${url}`, LogLevel.Trace);

	const { statusCode, resBody } = await requestResolveHeaders({ type: 'PUT', url, headers, data: contents }, output);
	if (statusCode !== 201) {
		const parsed = JSON.parse(resBody?.toString() || '{}');
		output.write(`${statusCode}: Failed to upload blob '${digest}' to '${url}' \n${JSON.stringify(parsed, undefined, 4)}`, LogLevel.Error);
		return false;
	}

	return true;
}

// Generate a layer that follows the `application/vnd.devcontainers.layer.v1+tar` mediaType as defined in
//     Devcontainer Spec (features) : https://containers.dev/implementors/features-distribution/#oci-registry
//     Devcontainer Spec (templates): https://github.com/devcontainers/spec/blob/main/proposals/devcontainer-templates-distribution.md#oci-registry
async function generateCompleteManifestForIndividualFeatureOrTemplate(output: Log, dataBytes: Buffer, pathToTgz: string, ociRef: OCIRef, collectionType: string): Promise<ManifestContainer | undefined> {
	const tgzLayer = await calculateDataLayer(output, dataBytes, path.basename(pathToTgz), DEVCONTAINER_TAR_LAYER_MEDIATYPE);
	if (!tgzLayer) {
		output.write(`Failed to calculate tgz layer.`, LogLevel.Error);
		return undefined;
	}

	let annotations: { [key: string]: string } | undefined = undefined;
	// Specific registries look for certain optional metadata 
	// in the manifest, in this case for UI presentation.
	if (ociRef.registry === 'ghcr.io') {
		annotations = {
			'com.github.package.type': `devcontainer_${collectionType}`,
		};
	}
	return await calculateManifestAndContentDigest(output, tgzLayer, annotations);
}

// Generate a layer that follows the `application/vnd.devcontainers.collection.layer.v1+json` mediaType as defined in
//     Devcontainer Spec (features) : https://containers.dev/implementors/features-distribution/#oci-registry
//     Devcontainer Spec (templates): https://github.com/devcontainers/spec/blob/main/proposals/devcontainer-templates-distribution.md#oci-registry
async function generateCompleteManifestForCollectionFile(output: Log, dataBytes: Buffer, collectionRef: OCICollectionRef): Promise<ManifestContainer | undefined> {
	const collectionMetadataLayer = await calculateDataLayer(output, dataBytes, 'devcontainer-collection.json', DEVCONTAINER_COLLECTION_LAYER_MEDIATYPE);
	if (!collectionMetadataLayer) {
		output.write(`Failed to calculate collection file layer.`, LogLevel.Error);
		return undefined;
	}

	let annotations: { [key: string]: string } | undefined = undefined;
	// Specific registries look for certain optional metadata 
	// in the manifest, in this case for UI presentation.
	if (collectionRef.registry === 'ghcr.io') {
		annotations = {
			'com.github.package.type': 'devcontainer_collection',
		};
	}
	return await calculateManifestAndContentDigest(output, collectionMetadataLayer, annotations);
}

// Generic construction of a layer in the manifest and digest for the generated layer.
export async function calculateDataLayer(output: Log, data: Buffer, basename: string, mediaType: string): Promise<OCILayer | undefined> {
	output.write(`Creating manifest from data`, LogLevel.Trace);

	const tarSha256 = crypto.createHash('sha256').update(data).digest('hex');
	output.write(`sha256:${tarSha256} (size: ${data.byteLength})`, LogLevel.Info);

	return {
		mediaType,
		digest: `sha256:${tarSha256}`,
		size: data.byteLength,
		annotations: {
			'org.opencontainers.image.title': basename,
		}
	};
}

// Spec: https://github.com/opencontainers/distribution-spec/blob/main/spec.md#checking-if-content-exists-in-the-registry
//       Requires registry auth token.
export async function checkIfBlobExists(output: Log, ociRef: OCIRef | OCICollectionRef, digest: string, authorization: string): Promise<boolean> {
	const headers: HEADERS = {
		'user-agent': 'devcontainer',
		'authorization': authorization,
	};

	const url = `https://${ociRef.registry}/v2/${ociRef.path}/blobs/${digest}`;
	const statusCode = await headRequest({ url, headers }, output);

	output.write(`${url}: ${statusCode}`, LogLevel.Trace);
	return statusCode === 200;
}

// Spec: https://github.com/opencontainers/distribution-spec/blob/main/spec.md#post-then-put
//       Requires registry auth token.
async function postUploadSessionId(output: Log, ociRef: OCIRef | OCICollectionRef, authorization: string): Promise<string | undefined> {
	const headers: HEADERS = {
		'user-agent': 'devcontainer',
		'authorization': authorization
	};

	const url = `https://${ociRef.registry}/v2/${ociRef.path}/blobs/uploads/`;
	output.write(`Generating Upload URL -> ${url}`, LogLevel.Trace);
	const { statusCode, resHeaders, resBody } = await requestResolveHeaders({ type: 'POST', url, headers }, output);
	output.write(`${url}: ${statusCode}`, LogLevel.Trace);
	if (statusCode === 202) {
		const locationHeader = resHeaders['location'] || resHeaders['Location'];
		if (!locationHeader) {
			output.write(`${url}: Got 202 status code, but no location header found.`, LogLevel.Error);
			return undefined;
		}
		output.write(`Generated Upload URL: ${locationHeader}`, LogLevel.Trace);
		return locationHeader;
	} else {
		// Any other statusCode besides 202 is unexpected
		// https://github.com/opencontainers/distribution-spec/blob/main/spec.md#error-codes
		const parsed = JSON.parse(resBody?.toString() || '{}');
		output.write(`${url}: Unexpected status code '${statusCode}' \n${JSON.stringify(parsed, undefined, 4)}`, LogLevel.Error);
		return undefined;
	}
}

export async function calculateManifestAndContentDigest(output: Log, dataLayer: OCILayer, annotations: { [key: string]: string } | undefined): Promise<ManifestContainer> {
	// A canonical manifest digest is the sha256 hash of the JSON representation of the manifest, without the signature content.
	// See: https://docs.docker.com/registry/spec/api/#content-digests
	// Below is an example of a serialized manifest that should resolve to '9726054859c13377c4c3c3c73d15065de59d0c25d61d5652576c0125f2ea8ed3'
	// {"schemaVersion":2,"mediaType":"application/vnd.oci.image.manifest.v1+json","config":{"mediaType":"application/vnd.devcontainers","digest":"sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855","size":0},"layers":[{"mediaType":"application/vnd.devcontainers.layer.v1+tar","digest":"sha256:b2006e7647191f7b47222ae48df049c6e21a4c5a04acfad0c4ef614d819de4c5","size":15872,"annotations":{"org.opencontainers.image.title":"go.tgz"}}]}

	let manifest: OCIManifest = {
		schemaVersion: 2,
		mediaType: 'application/vnd.oci.image.manifest.v1+json',
		config: {
			mediaType: 'application/vnd.devcontainers',
			digest: 'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', // A zero byte digest for the devcontainer mediaType.
			size: 0
		},
		layers: [
			dataLayer
		],
	};

	if (annotations) {
		manifest.annotations = annotations;
	}

	const manifestStringified = JSON.stringify(manifest);
	const manifestHash = crypto.createHash('sha256').update(manifestStringified).digest('hex');
	output.write(`Computed Content-Digest ->  sha256:${manifestHash} (size: ${manifestHash.length})`, LogLevel.Info);

	return {
		manifestStr: manifestStringified,
		manifestObj: manifest,
		contentDigest: manifestHash,
	};
}

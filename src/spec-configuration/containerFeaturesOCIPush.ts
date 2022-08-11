import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import { headRequest, requestResolveHeaders } from '../spec-utils/httpRequest';
import { Log, LogLevel } from '../spec-utils/log';
import { isLocalFile, readLocalFile } from '../spec-utils/pfs';
import { DEVCONTAINER_COLLECTION_LAYER_MEDIATYPE, DEVCONTAINER_TAR_LAYER_MEDIATYPE, fetchOCIFeatureManifestIfExists, fetchRegistryAuthToken, HEADERS, OCIFeatureCollectionRef, OCIFeatureRef, OCILayer, OCIManifest } from './containerFeaturesOCI';

// (!) Entrypoint function to push a single feature to a registry.
//     Devcontainer Spec : https://containers.dev/implementors/features-distribution/#oci-registry
//     OCI Spec          :  https://github.com/opencontainers/distribution-spec/blob/main/spec.md#push
export async function pushOCIFeature(output: Log, featureRef: OCIFeatureRef, pathToTgz: string, tags: string[]): Promise<boolean> {
	output.write(`Starting push of feature '${featureRef.id}' to '${featureRef.resource}' with tags '${tags.join(', ')}'`);
	output.write(`${JSON.stringify(featureRef, null, 2)}`, LogLevel.Trace);
	const env = process.env;

	// Generate registry auth token with `pull,push` scopes.
	const registryAuthToken = await fetchRegistryAuthToken(output, featureRef.registry, featureRef.path, env, 'pull,push');
	if (!registryAuthToken) {
		output.write(`Failed to get registry auth token`, LogLevel.Error);
		return false;
	}

	// Generate Manifest for given feature artifact.
	const manifest = await generateCompleteManifestForIndividualFeature(output, pathToTgz, featureRef);
	if (!manifest) {
		output.write(`Failed to generate manifest for ${featureRef.id}`, LogLevel.Error);
		return false;
	}
	output.write(`Generated manifest: \n${JSON.stringify(manifest?.manifestObj, undefined, 4)}`, LogLevel.Trace);

	// If the exact manifest digest already exists in the registry, we don't need to push individual blobs (it's already there!) 
	const existingFeatureManifest = await fetchOCIFeatureManifestIfExists(output, env, featureRef, manifest.digest, registryAuthToken);
	if (manifest.digest && existingFeatureManifest) {
		output.write(`Not reuploading blobs, digest already exists.`, LogLevel.Trace);
		await putManifestWithTags(output, manifest.manifestStr, featureRef, tags, registryAuthToken);
		return true;
	}

	const blobsToPush = [
		{
			name: 'configLayer',
			digest: manifest.manifestObj.config.digest,
		},
		{
			name: 'tgzLayer',
			digest: manifest.manifestObj.layers[0].digest,
		}
	];

	// Obtain session ID with `/v2/<namespace>/blobs/uploads/` 
	const blobPutLocationUriPath = await postUploadSessionId(output, featureRef, registryAuthToken);
	if (!blobPutLocationUriPath) {
		output.write(`Failed to get upload session ID`, LogLevel.Error);
		return false;
	}

	for await (const blob of blobsToPush) {
		const { name, digest } = blob;
		const blobExistsConfigLayer = await checkIfBlobExists(output, featureRef, digest, registryAuthToken);
		output.write(`blob: '${name}' with digest '${digest}'  ${blobExistsConfigLayer ? 'already exists' : 'does not exist'} in registry.`, LogLevel.Trace);

		// PUT blobs
		if (!blobExistsConfigLayer) {
			if (!(await putBlob(output, pathToTgz, blobPutLocationUriPath, featureRef, digest, registryAuthToken))) {
				output.write(`Failed to PUT blob '${name}' with digest '${digest}'`, LogLevel.Error);
				return false;
			}
		}
	}

	// Send a final PUT to combine blobs and tag manifest properly.
	await putManifestWithTags(output, manifest.manifestStr, featureRef, tags, registryAuthToken);


	// Success!
	return true;
}

// (!) Entrypoint function to push a collection metadata/overview file for a set of features to a registry.
//     Devcontainer Spec :  https://containers.dev/implementors/features-distribution/#oci-registry (see 'devcontainer-collection.json')
//     OCI Spec          :  https://github.com/opencontainers/distribution-spec/blob/main/spec.md#push
export async function pushFeatureCollectionMetadata(output: Log, featureCollectionRef: OCIFeatureCollectionRef, pathToCollectionJson: string): Promise<boolean> {
	output.write(`Starting push of latest feature collection for namespace '${featureCollectionRef.path}' to '${featureCollectionRef.registry}'`);
	output.write(`${JSON.stringify(featureCollectionRef, null, 2)}`, LogLevel.Trace);
	const env = process.env;

	const registryAuthToken = await fetchRegistryAuthToken(output, featureCollectionRef.registry, featureCollectionRef.path, env, 'pull,push');
	if (!registryAuthToken) {
		output.write(`Failed to get registry auth token`, LogLevel.Error);
		return false;
	}

	// Generate Manifest for collection artifact.
	const manifest = await generateCompleteManifestForCollectionFile(output, pathToCollectionJson, featureCollectionRef);
	if (!manifest) {
		output.write(`Failed to generate manifest for ${featureCollectionRef.path}`, LogLevel.Error);
		return false;
	}
	output.write(`Generated manifest: \n${JSON.stringify(manifest?.manifestObj, undefined, 4)}`, LogLevel.Trace);

	// If the exact manifest digest already exists in the registry, we don't need to push individual blobs (it's already there!) 
	const existingFeatureManifest = await fetchOCIFeatureManifestIfExists(output, env, featureCollectionRef, manifest.digest, registryAuthToken);
	if (manifest.digest && existingFeatureManifest) {
		output.write(`Not reuploading blobs, digest already exists.`, LogLevel.Trace);
		await putManifestWithTags(output, manifest.manifestStr, featureCollectionRef, ['latest'], registryAuthToken);
		return true;
	}

	// Obtain session ID with `/v2/<namespace>/blobs/uploads/` 
	const blobPutLocationUriPath = await postUploadSessionId(output, featureCollectionRef, registryAuthToken);
	if (!blobPutLocationUriPath) {
		output.write(`Failed to get upload session ID`, LogLevel.Error);
		return false;
	}

	const blobsToPush = [
		{
			name: 'configLayer',
			digest: manifest.manifestObj.config.digest,
		},
		{
			name: 'collectionLayer',
			digest: manifest.manifestObj.layers[0].digest,
		}
	];

	for await (const blob of blobsToPush) {
		const { name, digest } = blob;
		const blobExistsConfigLayer = await checkIfBlobExists(output, featureCollectionRef, digest, registryAuthToken);
		output.write(`blob: '${name}' with digest '${digest}'  ${blobExistsConfigLayer ? 'already exists' : 'does not exist'} in registry.`, LogLevel.Trace);

		// PUT blobs
		if (!blobExistsConfigLayer) {
			if (!(await putBlob(output, pathToCollectionJson, blobPutLocationUriPath, featureCollectionRef, digest, registryAuthToken))) {
				output.write(`Failed to PUT blob '${name}' with digest '${digest}'`, LogLevel.Error);
				return false;
			}
		}
	}

	// Send a final PUT to combine blobs and tag manifest properly.
	// Collections are always tagged 'latest'
	await putManifestWithTags(output, manifest.manifestStr, featureCollectionRef, ['latest'], registryAuthToken);

	return true;
}



// --- Helper Functions

// Spec: https://github.com/opencontainers/distribution-spec/blob/main/spec.md#pushing-manifests (PUT /manifests/<ref>)
export async function putManifestWithTags(output: Log, manifestStr: string, featureRef: OCIFeatureRef | OCIFeatureCollectionRef, tags: string[], registryAuthToken: string): Promise<boolean> {
	output.write(`Tagging manifest with tags: ${tags.join(', ')}`, LogLevel.Trace);

	for await (const tag of tags) {
		const url = `https://${featureRef.registry}/v2/${featureRef.path}/manifests/${tag}`;
		output.write(`PUT -> '${url}'`, LogLevel.Trace);
		const { statusCode, resHeaders } = await requestResolveHeaders({
			type: 'PUT',
			url,
			headers: {
				'Authorization': `Bearer ${registryAuthToken}`,
				'Content-Type': 'application/vnd.oci.image.manifest.v1+json',
			},
			data: Buffer.from(manifestStr),
		});
		if (statusCode !== 201) {
			output.write(`Failed to PUT manifest for tag ${tag}`, LogLevel.Error);
			return false;
		}

		const dockerContentDigestResponseHeader = resHeaders['docker-content-digest'] || resHeaders['Docker-Content-Digest'];
		const locationResponseHeader = resHeaders['location'] || resHeaders['Location'];
		output.write(`Tagged: ${tag} -> ${locationResponseHeader}`, LogLevel.Info);
		output.write(`Returned Content-Digest: ${dockerContentDigestResponseHeader}`, LogLevel.Trace);
	}
	return true;
}

// Spec: https://github.com/opencontainers/distribution-spec/blob/main/spec.md#post-then-put (PUT <location>?digest=<digest>)
export async function putBlob(output: Log, pathToBlob: string, blobPutLocationUriPath: string, featureRef: OCIFeatureRef | OCIFeatureCollectionRef, digest: string, registryAuthToken: string): Promise<boolean> {
	output.write(`PUT new blob -> '${digest}'`, LogLevel.Info);

	if (!(await isLocalFile(pathToBlob))) {
		output.write(`Blob ${pathToBlob} does not exist`, LogLevel.Error);
		return false;
	}

	const headers: HEADERS = {
		'user-agent': 'devcontainer',
		'authorization': `Bearer ${registryAuthToken}`,
		'content-type': 'application/octet-stream',
	};

	// OCI distribution spec is ambiguous on whether we get back an absolute or relative path.
	let url = '';
	if (blobPutLocationUriPath.startsWith('https://')) {
		url = blobPutLocationUriPath;
	} else {
		url = `https://${featureRef.registry}${blobPutLocationUriPath}`;
	}
	url += `?digest=${digest}`;

	output.write(`Crafted blob url:  ${url}`, LogLevel.Trace);

	const { statusCode } = await requestResolveHeaders({ type: 'PUT', url, headers, data: await readLocalFile(pathToBlob) });
	if (statusCode !== 201) {
		output.write(`${statusCode}: Failed to upload blob '${pathToBlob}' to '${url}'`, LogLevel.Error);
		return false;
	}

	return true;
}

// Generate a layer that follows the `application/vnd.devcontainers.layer.v1+tar` mediaType
// as defined in: https://containers.dev/implementors/features-distribution/#oci-registry
export async function generateCompleteManifestForIndividualFeature(output: Log, pathToTgz: string, ociFeatureRef: OCIFeatureRef): Promise<{ manifestObj: OCIManifest; manifestStr: string; digest: string } | undefined> {
	const tgzLayer = await calculateDataLayer(output, pathToTgz, DEVCONTAINER_TAR_LAYER_MEDIATYPE);
	if (!tgzLayer) {
		output.write(`Failed to calculate tgz layer.`, LogLevel.Error);
		return undefined;
	}

	let annotations: { [key: string]: string } | undefined = undefined;
	// Specific registries look for certain optional metadata 
	// in the manifest, in this case for UI presentation.
	if (ociFeatureRef.registry === 'ghcr.io') {
		annotations = {
			'com.github.package.type': 'devcontainer-feature',
		};
	}
	return await calculateManifestAndContentDigest(output, tgzLayer, annotations);
}

// Generate a layer that follows the `application/vnd.devcontainers.collection.layer.v1+json` mediaType
// as defined in: https://containers.dev/implementors/features-distribution/#oci-registry
export async function generateCompleteManifestForCollectionFile(output: Log, pathToCollectionFile: string, collectionRef: OCIFeatureCollectionRef): Promise<{ manifestObj: OCIManifest; manifestStr: string; digest: string } | undefined> {
	const collectionMetadataLayer = await calculateDataLayer(output, pathToCollectionFile, DEVCONTAINER_COLLECTION_LAYER_MEDIATYPE);
	if (!collectionMetadataLayer) {
		output.write(`Failed to calculate collection file layer.`, LogLevel.Error);
		return undefined;
	}

	let annotations: { [key: string]: string } | undefined = undefined;
	// Specific registries look for certain optional metadata 
	// in the manifest, in this case for UI presentation.
	if (collectionRef.registry === 'ghcr.io') {
		annotations = {
			'com.github.package.type': 'devcontainer-collection',
		};
	}
	return await calculateManifestAndContentDigest(output, collectionMetadataLayer, annotations);
}

// Generic construction of a layer in the manifest and digest for the generated layer.
export async function calculateDataLayer(output: Log, pathToData: string, mediaType: string): Promise<OCILayer | undefined> {
	output.write(`Creating manifest from ${pathToData}`, LogLevel.Trace);
	if (!(await isLocalFile(pathToData))) {
		output.write(`${pathToData} does not exist.`, LogLevel.Error);
		return undefined;
	}

	const dataBytes = fs.readFileSync(pathToData);

	const tarSha256 = crypto.createHash('sha256').update(dataBytes).digest('hex');
	output.write(`${pathToData}:  sha256:${tarSha256} (size: ${dataBytes.byteLength})`, LogLevel.Info);

	return {
		mediaType,
		digest: `sha256:${tarSha256}`,
		size: dataBytes.byteLength,
		annotations: {
			'org.opencontainers.image.title': path.basename(pathToData),
		}
	};
}

// Spec: https://github.com/opencontainers/distribution-spec/blob/main/spec.md#checking-if-content-exists-in-the-registry
//       Requires registry auth token.
export async function checkIfBlobExists(output: Log, featureRef: OCIFeatureRef | OCIFeatureCollectionRef, digest: string, authToken: string): Promise<boolean> {
	const headers: HEADERS = {
		'user-agent': 'devcontainer',
		'authorization': `Bearer ${authToken}`,
	};

	const url = `https://${featureRef.registry}/v2/${featureRef.path}/blobs/${digest}`;
	const statusCode = await headRequest({ url, headers }, output);

	output.write(`${url}: ${statusCode}`, LogLevel.Trace);
	return statusCode === 200;
}

// Spec: https://github.com/opencontainers/distribution-spec/blob/main/spec.md#post-then-put
//       Requires registry auth token.
export async function postUploadSessionId(output: Log, featureRef: OCIFeatureRef | OCIFeatureCollectionRef, authToken: string): Promise<string | undefined> {
	const headers: HEADERS = {
		'user-agent': 'devcontainer',
		'authorization': `Bearer ${authToken}`,
	};

	const url = `https://${featureRef.registry}/v2/${featureRef.path}/blobs/uploads/`;
	output.write(`Generating Upload URL -> ${url}`, LogLevel.Trace);
	const { statusCode, resHeaders } = await requestResolveHeaders({ type: 'POST', url, headers }, output);
	output.write(`${url}: ${statusCode}`, LogLevel.Trace);
	if (statusCode === 202) {
		const locationHeader = resHeaders['location'] || resHeaders['Location'];
		if (!locationHeader) {
			output.write(`${url}: Got 202 status code, but no location header found.`, LogLevel.Error);
			return undefined;
		}
		return locationHeader;
	}
	return undefined;
}

export async function calculateManifestAndContentDigest(output: Log, dataLayer: OCILayer, annotations: { [key: string]: string } | undefined) {
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
		digest: manifestHash,
	};
}
import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import { headRequest, requestResolveHeaders } from '../spec-utils/httpRequest';
import { Log, LogLevel } from '../spec-utils/log';
import { isLocalFile, readLocalFile } from '../spec-utils/pfs';
import { fetchOCIFeatureManifestIfExists, fetchRegistryAuthToken, HEADERS, OCIFeatureRef, OCILayer, OCIManifest } from './containerFeaturesOCI';

// (!) Entrypoint function to push a feature to a registry.
//     Spec: https://github.com/opencontainers/distribution-spec/blob/main/spec.md#push
export async function pushOCIFeature(output: Log, env: NodeJS.ProcessEnv, featureRef: OCIFeatureRef, pathToTgz: string, tags: string[]): Promise<boolean> {
	output.write(`Starting push of feature '${featureRef.id}' to '${featureRef.resource}' with tags '${tags.join(', ')}'`);

	// Generate registry auth token with `pull,push` scopes.
	const registryAuthToken = await fetchRegistryAuthToken(output, featureRef.registry, featureRef.id, env, 'pull,push');
	if (!registryAuthToken) {
		output.write(`Failed to get registry auth token`, LogLevel.Error);
		return false;
	}

	// Generate Manifest for given feature artifact.
	const manifest = await generateCompleteManifest(output, pathToTgz);
	if (!manifest) {
		output.write(`Failed to generate manifest for ${featureRef.id}`, LogLevel.Error);
		return false;
	}

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

// Spec: https://github.com/opencontainers/distribution-spec/blob/main/spec.md#pushing-manifests (PUT /manifests/<ref>)
export async function putManifestWithTags(output: Log, manifestStr: string, featureRef: OCIFeatureRef, tags: string[], registryAuthToken: string): Promise<boolean> {
	output.write(`Tagging manifest with tags: ${tags.join(', ')}`, LogLevel.Trace);

	for await (const tag of tags) {
		const url = `https://${featureRef.registry}/v2/${featureRef.resource}/manifests/${tag}`;
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
		output.write(`Docker-Content-Digest: ${dockerContentDigestResponseHeader}`, LogLevel.Trace);
	}
	return true;
}

// Spec: https://github.com/opencontainers/distribution-spec/blob/main/spec.md#post-then-put (PUT <location>?digest=<digest>)
export async function putBlob(output: Log, pathToBlob: string, blobPutLocationUriPath: string, featureRef: OCIFeatureRef, digest: string, registryAuthToken: string): Promise<boolean> {
	output.write(`Uploading blob with digest ${digest}`, LogLevel.Trace);

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

export async function generateCompleteManifest(output: Log, pathToTgz: string): Promise<{ manifestObj: OCIManifest; manifestStr: string; digest: string } | undefined> {

	const tgzLayer = await calculateTgzLayer(output, pathToTgz);
	if (!tgzLayer) {
		output.write(`Failed to calculate tgz layer.`, LogLevel.Error);
		return undefined;
	}

	return await calculateContentDigest(output, tgzLayer);
}

export async function calculateTgzLayer(output: Log, pathToTgz: string): Promise<OCILayer | undefined> {
	output.write(`Creating manifest from ${pathToTgz}`, LogLevel.Trace);
	if (!(await isLocalFile(pathToTgz))) {
		output.write(`${pathToTgz} does not exist.`, LogLevel.Error);
		return undefined;
	}

	const tarBytes = fs.readFileSync(pathToTgz);

	const tarSha256 = crypto.createHash('sha256').update(tarBytes).digest('hex');
	output.write(`${pathToTgz}:  sha256:${tarSha256} (size: ${tarBytes.byteLength})`, LogLevel.Info);

	return {
		mediaType: 'application/vnd.devcontainers.layer.v1+tar',
		digest: `sha256:${tarSha256}`,
		size: tarBytes.byteLength,
		annotations: {
			'org.opencontainers.image.title': path.basename(pathToTgz),
		}
	};
}

// Spec: https://github.com/opencontainers/distribution-spec/blob/main/spec.md#checking-if-content-exists-in-the-registry
//       Requires registry auth token.
export async function checkIfBlobExists(output: Log, featureRef: OCIFeatureRef, digest: string, authToken: string): Promise<boolean> {
	const headers: HEADERS = {
		'user-agent': 'devcontainer',
		'authorization': `Bearer ${authToken}`,
	};

	const url = `https://${featureRef.registry}/v2/${featureRef.namespace}/${featureRef.id}/blobs/${digest}`;
	const statusCode = await headRequest({ url, headers }, output);

	output.write(`${url}: ${statusCode}`, LogLevel.Trace);
	return statusCode === 200;
}

// Spec: https://github.com/opencontainers/distribution-spec/blob/main/spec.md#post-then-put
//       Requires registry auth token.
export async function postUploadSessionId(output: Log, featureRef: OCIFeatureRef, authToken: string): Promise<string | undefined> {
	const headers: HEADERS = {
		'user-agent': 'devcontainer',
		'authorization': `Bearer ${authToken}`,
	};

	const url = `https://${featureRef.registry}/v2/${featureRef.namespace}/${featureRef.id}/blobs/uploads/`;
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

export async function calculateContentDigest(output: Log, tgzLayer: OCILayer) {
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
			tgzLayer
		]
	};

	const manifestStringified = JSON.stringify(manifest);
	const manifestHash = crypto.createHash('sha256').update(manifestStringified).digest('hex');
	output.write(`content digest:  sha256:${manifestHash} (size: ${manifestHash.length})`, LogLevel.Info);

	return {
		manifestStr: manifestStringified,
		manifestObj: manifest,
		digest: manifestHash,
	};
}
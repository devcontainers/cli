import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import { headRequest, requestFetchHeaders } from '../spec-utils/httpRequest';
import { Log, LogLevel } from '../spec-utils/log';
import { isLocalFile } from '../spec-utils/pfs';
import { FeatureSet } from './containerFeaturesConfiguration';
import { fetchOCIFeatureManifestIfExists, fetchRegistryAuthToken, HEADERS, OCIFeatureRef, OCILayer, OCIManifest } from './containerFeaturesOCI';

// (!) Entrypoint function to push a feature to a registry.
//     Spec: https://github.com/opencontainers/distribution-spec/blob/main/spec.md#push
export async function pushOCIFeature(output: Log, env: NodeJS.ProcessEnv, featureSet: FeatureSet, pathToTgz: string, tags: string[]): Promise<boolean> {
    if (featureSet.sourceInformation.type !== 'oci') {
        output.write(`Provided feature is not of type 'OCI'.  Cannot publish to an OCI registry.`, LogLevel.Error);
        return false;
    }

    const featureRef = featureSet.sourceInformation.featureRef;

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
    const existingFeatureManifest = await fetchOCIFeatureManifestIfExists(output, env, featureRef.id, manifest.digest, registryAuthToken);
    if (manifest.digest && existingFeatureManifest) {
        output.write(`Not reuploading blobs, digest already exists.`, LogLevel.Trace);
        await putManifestWithTags(output, manifest.manifestStr, tags);
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
        output.write(`blob: ${name} with digest ${digest}  ${blobExistsConfigLayer ? 'already exists' : 'does not exist'} in registry.`, LogLevel.Trace);

        // PUT blobs
        if (!blobExistsConfigLayer) {
            putBlob(output, blobPutLocationUriPath, featureRef, digest, registryAuthToken);
        }

        // Send a final PUT to combine blobs and tag manifest properly.
        await putManifestWithTags(output, manifest.manifestStr, tags);

    }

    // Success!
    return true;
}

// Spec: https://github.com/opencontainers/distribution-spec/blob/main/spec.md#pushing-manifests (PUT /manifests/<ref>)
export async function putManifestWithTags(output: Log, manifest: string, tags: string[]) {
    output.write(`Tagging manifest with tags: ${tags.join(', ')}`, LogLevel.Trace);
    output.write(manifest);
    throw new Error('Not implemented');
}

// Spec: https://github.com/opencontainers/distribution-spec/blob/main/spec.md#post-then-put (PUT <location>?digest=<digest>)
export async function putBlob(output: Log, blobPutLocationUriPath: string, featureRef: OCIFeatureRef, digest: string, _registryAuthToken: string) {
    output.write(`Uploading blob with digest ${digest}`, LogLevel.Trace);

    // const headers: HEADERS = {
    //     'user-agent': 'devcontainer',
    //     'authorization': `Bearer ${registryAuthToken}`
    // }

    let url = '';
    if (blobPutLocationUriPath.startsWith('https://')) {
        url = blobPutLocationUriPath;
    } else {
        url = `https://${featureRef.registry}${blobPutLocationUriPath}`;
    }
    url += `?digest=sha256:${digest}`;

    output.write(`Crafted blob url:  ${url}`, LogLevel.Trace);

    // await request({ type: 'PUT', url,  })
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
    output.write(`${pathToTgz}:  sha256:${tarSha256} (size: ${tarBytes.byteLength})`, LogLevel.Trace);

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
    const { statusCode, resHeaders } = await requestFetchHeaders({ type: 'POST', url, headers }, output);

    output.write(`${url}: ${statusCode}`, LogLevel.Trace);
    if (statusCode === 202) {
        return resHeaders['Location'];
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
            digest: 'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
            size: 0
        },
        layers: [
            tgzLayer
        ]
    };

    const manifestStringified = JSON.stringify(manifest);
    const manifestHash = crypto.createHash('sha256').update(manifestStringified).digest('hex');
    output.write(`manifest:  sha256:${manifestHash} (size: ${manifestHash.length})`, LogLevel.Trace);

    return {
        manifestStr: manifestStringified,
        manifestObj: manifest,
        digest: manifestHash,
    };
}
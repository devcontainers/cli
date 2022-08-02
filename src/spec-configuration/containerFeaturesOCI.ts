import * as path from 'path';
import * as tar from 'tar';
import * as fs from 'fs';
import * as crypto from 'crypto';
import { headRequest, request } from '../spec-utils/httpRequest';
import { Log, LogLevel } from '../spec-utils/log';
import { isLocalFile, mkdirpLocal, writeLocalFile } from '../spec-utils/pfs';
import { FeatureSet } from './containerFeaturesConfiguration';

type HEADERS = { 'authorization'?: string; 'user-agent': string; 'content-type'?: string; 'accept'?: string };
export interface OCIFeatureRef {
    id: string;
    version: string;
    featureName: string;
    owner: string;
    namespace: string;
    registry: string;
}

export interface OCILayer {
    mediaType: string;
    digest: string;
    size: number;
    annotations: {
        // 'org.opencontainers.image.ref.name': string;
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
}

export function getOCIFeatureSet(output: Log, identifier: string, options: boolean | string | Record<string, boolean | string | undefined>, manifest: OCIManifest): FeatureSet {

    const featureRef = getFeatureRef(output, identifier);

    const feat = {
        id: featureRef.id,
        name: featureRef.id,
        included: true,
        value: options
    };

    let featureSet: FeatureSet = {
        sourceInformation: {
            type: 'oci',
            manifest: manifest,
            featureRef: featureRef,

        },
        features: [feat],
    };

    return featureSet;
}

export function getFeatureRef(output: Log, identifier: string): OCIFeatureRef {

    // ex: ghcr.io/codspace/features/ruby:1
    const splitOnColon = identifier.split(':');
    const id = splitOnColon[0];
    const version = splitOnColon[1] ? splitOnColon[1] : 'latest';

    const splitOnSlash = id.split('/');
    const featureName = splitOnSlash[splitOnSlash.length - 1];
    const owner = splitOnSlash[1];
    const registry = splitOnSlash[0];
    const namespace = splitOnSlash.slice(1, -1).join('/');

    output.write(`identifier: ${identifier}`, LogLevel.Trace);
    output.write(`id: ${id}`, LogLevel.Trace);
    output.write(`version: ${version}`, LogLevel.Trace);
    output.write(`featureName: ${featureName}`, LogLevel.Trace);
    output.write(`owner: ${owner}`, LogLevel.Trace);
    output.write(`namespace: ${namespace}`, LogLevel.Trace);
    output.write(`registry: ${registry}`, LogLevel.Trace);

    return {
        id,
        version,
        featureName,
        owner,
        namespace,
        registry
    };
}

// Validate if a manifest exists and is reachable about the declared feature.
// Specification: https://github.com/opencontainers/distribution-spec/blob/v1.0.1/spec.md#pulling-manifests
export async function fetchOCIFeatureManifestIfExists(output: Log, env: NodeJS.ProcessEnv, identifier: string, manifestDigest?: string): Promise<OCIManifest | undefined> {
    const featureRef = getFeatureRef(output, identifier);

    let reference = featureRef.version;
    if (manifestDigest) {
        reference = manifestDigest;
    }

    // TODO: Always use the manifest digest (the canonical digest) instead of the `featureRef.version`
    //       matching some lock file. 
    const manifestUrl = `https://${featureRef.registry}/v2/${featureRef.namespace}/${featureRef.featureName}/manifests/${reference}`;
    output.write(`manifest url: ${manifestUrl}`, LogLevel.Trace);
    const manifest = await getFeatureManifest(output, env, manifestUrl, featureRef);

    if (manifest?.config.mediaType !== 'application/vnd.devcontainers') {
        output.write(`(!) Unexpected manifest media type: ${manifest?.config.mediaType}`, LogLevel.Error);
        return undefined;
    }

    return manifest;
}

// Download a feature from which a manifest was previously downloaded.
export async function fetchOCIFeature(output: Log, env: NodeJS.ProcessEnv, featureSet: FeatureSet, ociCacheDir: string, featCachePath: string): Promise<boolean> {

    if (featureSet.sourceInformation.type !== 'oci') {
        output.write(`FeatureSet is not an OCI featureSet.`, LogLevel.Error);
        throw new Error('FeatureSet is not an OCI featureSet.');
    }

    const { featureRef }  = featureSet.sourceInformation; 

    const blobUrl = `https://${featureSet.sourceInformation.featureRef.registry}/v2/${featureSet.sourceInformation.featureRef.namespace}/${featureSet.sourceInformation.featureRef.featureName}/blobs/${featureSet.sourceInformation.manifest?.layers[0].digest}`;
    output.write(`blob url: ${blobUrl}`, LogLevel.Trace);

    const success = await getFeatureBlob(output, env, blobUrl, ociCacheDir, featCachePath, featureRef);

    if (!success) {
        output.write(`Failed to download package for ${featureSet.sourceInformation.featureRef.featureName}`, LogLevel.Error);
        throw new Error(`Failed to download package for ${featureSet.sourceInformation.featureRef.featureName}`);
    }

    return true;
}

export async function getFeatureManifest(output: Log, env: NodeJS.ProcessEnv, url: string, featureRef: OCIFeatureRef): Promise<OCIManifest | undefined> {
    try {
        const headers: HEADERS = {
            'user-agent': 'devcontainer',
            'accept': 'application/vnd.oci.image.manifest.v1+json',
        };

        const auth = await fetchRegistrySessionToken(output, featureRef.registry, featureRef.id, env, 'pull');
        if (auth) {
            headers['authorization'] = `Bearer ${auth}`;
        }

        const options = {
            type: 'GET',
            url: url,
            headers: headers
        };

        const response = await request(options, output);
        const manifest: OCIManifest = JSON.parse(response.toString());

        return manifest;
    } catch (e) {
        output.write(`error: ${e}`, LogLevel.Error);
        return undefined;
    }
}

// Downloads a blob from a registry.
export async function getFeatureBlob(output: Log, env: NodeJS.ProcessEnv, url: string, ociCacheDir: string, featCachePath: string, featureRef: OCIFeatureRef): Promise<boolean> {
    // TODO: Parallelize if multiple layers (not likely).
    // TODO: Seeking might be needed if the size is too large.
    try {
        const tempTarballPath = path.join(ociCacheDir, 'blob.tar');

        const headers: HEADERS = {
            'user-agent': 'devcontainer',
            'accept': 'application/vnd.oci.image.manifest.v1+json',
        };

        const auth = await fetchRegistrySessionToken(output, featureRef.registry, featureRef.id, env, 'pull');
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

export async function fetchRegistrySessionToken(output: Log, registry: string, id: string, env: NodeJS.ProcessEnv, operationScopes: string): Promise<string | undefined> {
    const headers: HEADERS = {
        'user-agent': 'devcontainer'
    };

    // TODO: Read OS keychain/docker config for auth in various registries!
    if (!!env['GITHUB_TOKEN'] && registry === 'ghcr.io') {
        headers['authorization'] = `Bearer ${env['GITHUB_TOKEN']}`;
    }

    const url = `https://${registry}/token?scope=repo:${id}:${operationScopes}&service=${registry}`;

    const options = {
        type: 'GET',
        url: url,
        headers: headers
    };

    const authReq = await request(options, output);
    if (!authReq) {
        output.write('Failed to get registry session token', LogLevel.Error);
        return undefined;
    }

    const token = JSON.parse(authReq.toString())?.token;
    if (!token) {
        output.write('Failed to parse registry session token response', LogLevel.Error);
        return undefined;
    }
    return token;
}

// -- Push

// (!) Entrypoint function to push a feature to a registry.
//     Spec: https://github.com/opencontainers/distribution-spec/blob/main/spec.md#push
export async function pushOCIFeature(output: Log, env: NodeJS.ProcessEnv, featureSet: FeatureSet, pathToTgz: string, tags: string[]): Promise<boolean> {
    if (featureSet.sourceInformation.type !== 'oci') {
        output.write(`Provided feature is not of type 'OCI'.  Cannot publish to an OCI registry.`, LogLevel.Error);
        return false;
    }

    const featureRef = featureSet.sourceInformation.featureRef;

    // Generate Manifest for given feature artifact.
    const manifest = await generateCompleteManifest(output, pathToTgz);
    if (!manifest) {
        output.write(`Failed to generate manifest for ${featureRef.featureName}`, LogLevel.Error);
        return false;
    }

    // If the exact manifest digest already exists in the registry, we don't need to push individual blobs (it's already there!) 
    const existingFeatureManifest = await fetchOCIFeatureManifestIfExists(output, env, featureRef.id, manifest.digest);
    if (manifest.digest && existingFeatureManifest) {
        output.write(`Not reuploading blobs, digest already exists.`, LogLevel.Trace);
        await putManifestWithTags(output, tags);
        return false; //TODO
    }

    // Obtain session ID with `pull,push`

    // Check and see which blobs are already in the registry.
    // const a = checkIfBlobExists(featureSet, );
    // const b = checkIfBlobExists();

    // https://github.com/opencontainers/distribution-spec/blob/main/spec.md#single-post
    // POST blobs


    // Send a PUT to combine blobs and tag manifest properly.
    await putManifestWithTags(output, tags);

    // Success!
    return true;
}

// Spec: https://github.com/opencontainers/distribution-spec/blob/main/spec.md#pushing-manifests (PUT /manifests/<ref>)
export async function putManifestWithTags(output: Log, tags: string[]) {
    output.write(`Tagging manifest with tags: ${tags.join(', ')}`, LogLevel.Trace);
    throw new Error('Not implemented');
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
//       Requires sessionId token.
export async function checkIfBlobExists(output: Log, featureRef: OCIFeatureRef, digest: string, sessionId: string): Promise<boolean | undefined> {
    const headers: HEADERS = {
        'user-agent': 'devcontainer',
        'authorization': `Bearer ${sessionId}`,
    };

    const url = `https://${featureRef.registry}/v2/${featureRef.namespace}/${featureRef.featureName}/blobs/${digest}`;
    const statusCode = await headRequest({ url, headers }, output);

    output.write(`${url}: ${statusCode}`, LogLevel.Trace);
    return statusCode === 200;
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
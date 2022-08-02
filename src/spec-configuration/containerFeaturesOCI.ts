import * as path from 'path';
import * as tar from 'tar';
import * as fs from 'fs';
import * as crypto from 'crypto';
import { request } from '../spec-utils/httpRequest';
import { Log, LogLevel } from '../spec-utils/log';
import { isLocalFile, mkdirpLocal, writeLocalFile } from '../spec-utils/pfs';
import { FeatureSet } from './containerFeaturesConfiguration';

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
export async function validateOCIFeature(output: Log, env: NodeJS.ProcessEnv, identifier: string, manifestDigest?: string): Promise<OCIManifest | undefined> {
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
export async function fetchOCIFeature(output: Log, env: NodeJS.ProcessEnv, featureSet: FeatureSet, ociCacheDir: string, featCachePath: string, featureRef: OCIFeatureRef): Promise<boolean> {

    if (featureSet.sourceInformation.type !== 'oci') {
        output.write(`FeatureSet is not an OCI featureSet.`, LogLevel.Error);
        throw new Error('FeatureSet is not an OCI featureSet.');
    }

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
        const headers = {
            'user-agent': 'devcontainer',
            'Authorization': await getAuthenticationToken(env, output, featureRef.registry, featureRef.id),
            'Accept': 'application/vnd.oci.image.manifest.v1+json',
        };

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
    // TODO: Paralelize if multiple layers (not likely).
    // TODO: Seeking might be needed if the size is too large.
    try {
        const tempTarballPath = path.join(ociCacheDir, 'blob.tar');

        const headers = {
            'user-agent': 'devcontainer',
            'Authorization': await getAuthenticationToken(env, output, featureRef.registry, featureRef.id),
            'Accept': 'application/vnd.oci.image.manifest.v1+json',
        };

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

async function getAuthenticationToken(env: NodeJS.ProcessEnv, output: Log, registry: string, id: string): Promise<string> {
    // TODO: Use operating system keychain to get credentials.
    // TODO: Fallback to read docker config to get credentials.

    // TODO: Un-hardcode ghcr.io
    const registryAuthToken = await fetchRegistryAuthToken(output, registry, id, env);

    if (!registryAuthToken) {
        return ''; // TODO
    }

    return `Bearer ${registryAuthToken}`;
}

export async function fetchRegistryAuthToken(output: Log, registry: string, id: string, env: NodeJS.ProcessEnv): Promise<string | undefined> {
    const headers: { 'authorization'?: string; 'user-agent': string } = {
        'user-agent': 'devcontainer'
    };

    if (!!env['GITHUB_TOKEN']) {
        headers['authorization'] = `Bearer ${env['GITHUB_TOKEN']}`;
    }

    const url = `https://${registry}/token?scope=repo:${id}:pull&service=ghcr.io`;

    const options = {
        type: 'GET',
        url: url,
        headers: headers
    };

    const authReq = await request(options, output);
    if (!authReq) {
        output.write('Failed to get registry auth token', LogLevel.Error);
        return undefined;
    }

    const token = JSON.parse(authReq.toString())?.token;
    if (!token) {
        output.write('Failed to parse registry auth token response', LogLevel.Error);
        return undefined;
    }
    return token;
}

// -- Push

// export async function pushOCIFeature(output: Log, env: NodeJS.ProcessEnv, featureSet: FeatureSet, ociCacheDir: string, featCachePath: string, featureRef: OCIFeatureRef): Promise<boolean> {
//     const await validateOCIFeature(output, env, featureRef.id);
// }

export async function generateManifest(output: Log, pathToTgz: string): Promise<OCIManifest | undefined> {

    const tgzLayer = await calculateTgzLayer(output, pathToTgz);
    if (!tgzLayer) {
        output.write(`Failed to calculate tgz layer.`, LogLevel.Error);
        return undefined;
    }

    const { manifestObj, hash } = await calculateContentDigest(output, tgzLayer);
    manifestObj.digest = `sha256:${hash}`;

    return manifestObj;
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

export async function calculateContentDigest(output: Log, tgzLayer: OCILayer) {
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
        hash: manifestHash,
    };
}
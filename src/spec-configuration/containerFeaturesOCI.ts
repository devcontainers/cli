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

export interface OCIManifest {
    schemaVersion: number;
    mediaType: string;
    config: {
        mediaType: string;
        digest: string;
        size: number;
    };
    layers: [
        {
            mediaType: string;
            digest: string;
            size: number;
            annotations: {
                'org.opencontainers.image.ref.name': string;
                'org.opencontainers.image.title': string;
            };
        }
    ];
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
export async function validateOCIFeature(output: Log, env: NodeJS.ProcessEnv, identifier: string): Promise<OCIManifest | undefined> {
    const featureRef = getFeatureRef(output, identifier);

    const manifestUrl = `https://${featureRef.registry}/v2/${featureRef.namespace}/${featureRef.featureName}/manifests/${featureRef.version}`;
    output.write(`manifest url: ${manifestUrl}`, LogLevel.Trace);
    const manifest = await getFeatureManifest(output, env, manifestUrl, featureRef);

    if (manifest?.config.mediaType !== 'application/vnd.devcontainers') {
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

    // TEMP for ghcr.io
    const githubToken = env['GITHUB_TOKEN'];
    if (registry !== 'ghcr.io' || !githubToken) {
        const token = await getAuthToken(output, registry, id);
        return 'Bearer ' + token;
    }

    return '';
}

export async function getAuthToken(output: Log, registry: string, id: string) {
    const headers = {
        'user-agent': 'devcontainer',
    };

    const url = `https://${registry}/token?scope=repo:${id}:pull&service=ghcr.io`;

    const options = {
        type: 'GET',
        url: url,
        headers: headers
    };

    const token = JSON.parse((await request(options, output)).toString()).token;

    return token;
}

// -- Push

export async function createManifest(output: Log, pathToTgz: string): Promise<OCIManifest | undefined> {

    /*const tgzLayer = */calculateTgzLayer(output, pathToTgz);
    return undefined;
}

export async function calculateTgzLayer(output: Log, pathToTgz: string): Promise<{ digest: string; size: number; mediaType: string } | undefined> {
    output.write(`Creating manifest from ${pathToTgz}`, LogLevel.Trace);
    if (!(await isLocalFile(pathToTgz))) {
        output.write(`${pathToTgz} does not exist.`, LogLevel.Error);
        return undefined;
    }

    const tarBytes = fs.readFileSync(pathToTgz);


    const tarSha256 = crypto.createHash('sha256').update(tarBytes).digest('hex');
    output.write(`${pathToTgz}:  sha256:${tarSha256} (size: ${tarBytes.byteLength})`, LogLevel.Trace);

    return {
        digest: `sha256:${tarSha256}`,
        size: tarBytes.byteLength,
        mediaType: 'application/octet-stream'
    };
}
import * as path from 'path';
import * as tar from 'tar';
import { request } from '../spec-utils/httpRequest';
import { Log, LogLevel } from '../spec-utils/log';
import { mkdirpLocal, writeLocalFile } from '../spec-utils/pfs';
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
    const version = splitOnColon[1] ? splitOnColon[1] : '1';

    const splitOnSlash = id.split('/');
    const featureName = splitOnSlash[splitOnSlash.length - 1];
    const owner = splitOnSlash[1];
    const registry = splitOnSlash[0];
    const namespace = splitOnSlash.slice(1, -1).join('/');

    output.write(`identifier: ${identifier}`);
    output.write(`id: ${id}`);
    output.write(`version: ${version}`);
    output.write(`featureName: ${featureName}`);
    output.write(`owner: ${owner}`);
    output.write(`namespace: ${namespace}`);
    output.write(`registry: ${registry}`);

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
    const manifest = await getFeatureManifest(output, env, manifestUrl);

    return manifest;
}

// Download a feature from which a manifest was previously downloaded.
export async function fetchOCIFeature(output: Log, env: NodeJS.ProcessEnv, featureSet: FeatureSet, ociCacheDir: string, featCachePath: string): Promise<boolean> {

    if (featureSet.sourceInformation.type !== 'oci') {
        output.write(`FeatureSet is not an OCI featureSet.`);
        throw new Error('FeatureSet is not an OCI featureSet.');
    }

    const blobUrl = `https://${featureSet.sourceInformation.featureRef.registry}/v2/${featureSet.sourceInformation.featureRef.namespace}/${featureSet.sourceInformation.featureRef.featureName}/blobs/${featureSet.sourceInformation.manifest?.layers[0].digest}`;
    output.write(`blob url: ${blobUrl}`, LogLevel.Trace);

    const success = await getFeatureBlob(output, env, blobUrl, ociCacheDir, featCachePath);

    if (!success) {
        output.write(`Failed to download package for ${featureSet.sourceInformation.featureRef.featureName}`, LogLevel.Error);
        throw new Error(`Failed to download package for ${featureSet.sourceInformation.featureRef.featureName}`);
    }

    return true;
}

export async function getFeatureManifest(output: Log, env: NodeJS.ProcessEnv, featureRef: string): Promise<OCIManifest | undefined> {
    try {
        const headers = {
            'user-agent': 'devcontainer',
            'Authorization': await getAuthenticationToken(env),
            'Accept': 'application/vnd.oci.image.manifest.v1+json',
        };

        const options = {
            type: 'GET',
            url: featureRef,
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
export async function getFeatureBlob(output: Log, env: NodeJS.ProcessEnv, url: string, ociCacheDir: string, featCachePath: string): Promise<boolean> {
    // TODO: Paralelize if multiple layers (not likely).
    // TODO: Seeking might be needed if the size is too large.
    try {
        const tempTarballPath = path.join(ociCacheDir, 'blob.tar');

        const headers = {
            'user-agent': 'devcontainer',
            'Authorization': await getAuthenticationToken(env),
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
        output.write(`error: ${e}`, LogLevel.Trace);
        return false;
    }
}

async function getAuthenticationToken(env: NodeJS.ProcessEnv): Promise<string> {
    // TODO: Use operating system keychain to get credentials.
    // TODO: Fallback to read docker config to get credentials.

    const githubToken = env['GITHUB_TOKEN'];

    if (!githubToken) {
        return 'Bearer ' + githubToken;
    }

    return '';
}
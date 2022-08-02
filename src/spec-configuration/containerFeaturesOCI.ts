import * as path from 'path';
import * as tar from 'tar';
import { request } from '../spec-utils/httpRequest';
import { Log, LogLevel } from '../spec-utils/log';
import { mkdirpLocal, writeLocalFile } from '../spec-utils/pfs';
import { FeatureSet } from './containerFeaturesConfiguration';

export type HEADERS = { 'authorization'?: string; 'user-agent': string; 'content-type'?: string; 'accept'?: string };

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
export async function fetchOCIFeatureManifestIfExists(output: Log, env: NodeJS.ProcessEnv, identifier: string, manifestDigest?: string, authToken?: string): Promise<OCIManifest | undefined> {
    const featureRef = getFeatureRef(output, identifier);

    // TODO: Always use the manifest digest (the canonical digest) 
    //       instead of the `featureRef.version` by referencing some lock file (if available).
    let reference = featureRef.version;
    if (manifestDigest) {
        reference = manifestDigest;
    }

    const manifestUrl = `https://${featureRef.registry}/v2/${featureRef.namespace}/${featureRef.featureName}/manifests/${reference}`;
    output.write(`manifest url: ${manifestUrl}`, LogLevel.Trace);
    const manifest = await getFeatureManifest(output, env, manifestUrl, featureRef, authToken);

    if (manifest?.config.mediaType !== 'application/vnd.devcontainers') {
        output.write(`(!) Unexpected manifest media type: ${manifest?.config.mediaType}`, LogLevel.Error);
        return undefined;
    }

    return manifest;
}

// Download a feature from which a manifest was previously downloaded.
// Specification: https://github.com/opencontainers/distribution-spec/blob/v1.0.1/spec.md#pulling-blobs
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

export async function getFeatureManifest(output: Log, env: NodeJS.ProcessEnv, url: string, featureRef: OCIFeatureRef, authToken?: string): Promise<OCIManifest | undefined> {
    try {
        const headers: HEADERS = {
            'user-agent': 'devcontainer',
            'accept': 'application/vnd.oci.image.manifest.v1+json',
        };

        const auth = authToken ?? await fetchRegistryAuthToken(output, featureRef.registry, featureRef.id, env, 'pull');
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
export async function getFeatureBlob(output: Log, env: NodeJS.ProcessEnv, url: string, ociCacheDir: string, featCachePath: string, featureRef: OCIFeatureRef, authToken?: string): Promise<boolean> {
    // TODO: Parallelize if multiple layers (not likely).
    // TODO: Seeking might be needed if the size is too large.
    try {
        const tempTarballPath = path.join(ociCacheDir, 'blob.tar');

        const headers: HEADERS = {
            'user-agent': 'devcontainer',
            'accept': 'application/vnd.oci.image.manifest.v1+json',
        };

        const auth = authToken ?? await fetchRegistryAuthToken(output, featureRef.registry, featureRef.id, env, 'pull');
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

// https://github.com/oras-project/oras-go/blob/97a9c43c52f9d89ecf5475bc59bd1f96c8cc61f6/registry/remote/auth/scope.go#L60-L74
export async function fetchRegistryAuthToken(output: Log, registry: string, id: string, env: NodeJS.ProcessEnv, operationScopes: string): Promise<string | undefined> {
    const headers: HEADERS = {
        'user-agent': 'devcontainer'
    };

    // TODO: Read OS keychain/docker config for auth in various registries!

    let userToken = '';
    if (!!env['GITHUB_TOKEN'] && registry === 'ghcr.io') {
        userToken = env['GITHUB_TOKEN'];
    } else if (!!env['DEVCONTAINERS_OCI_AUTH']) {
        // eg: DEVCONTAINERS_OCI_AUTH=domain1:token1,domain2:token2
        const authContexts = env['DEVCONTAINERS_OCI_AUTH'].split(',');
        const authContext = authContexts.find(a => a.split(':')[0] === registry);
        if (authContext && authContext.length === 2) {
            userToken = authContext.split(':')[1];
        }
    } else {
        output.write('No oauth authentication credentials found.', LogLevel.Trace);
    }

    if (userToken) {
        const base64Encoded = Buffer.from(`USERNAME:${userToken}`).toString('base64');
        headers['authorization'] = `Basic ${base64Encoded}`;
    }

    const url = `https://${registry}/token?scope=repo:${id}:${operationScopes}&service=${registry}`;

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

    const token: string | undefined = JSON.parse(authReq.toString())?.token;
    if (!token) {
        output.write('Failed to parse registry auth token response', LogLevel.Error);
        return undefined;
    }
    return token;
}
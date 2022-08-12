import { fetchRegistryAuthToken, HEADERS } from '../../spec-configuration/containerFeaturesOCI';
import { request } from '../../spec-utils/httpRequest';
import { Log, LogLevel } from '../../spec-utils/log';

const semver = require('semver');

interface versions {
    name: string;
    tags: string[];
}

export async function getPublishedVersions(featureId: string, registry: string, namespace: string, output: Log) {
    try {
        const url = `https://${registry}/v2/${namespace}/${featureId}/tags/list`;
        const resource = `${registry}/${namespace}/${featureId}`;

        let authToken = await fetchRegistryAuthToken(output, registry, resource, process.env, 'pull');

        if (!authToken) {
            output.write(`(!) ERR: Failed to publish feature: ${resource}`, LogLevel.Error);
            process.exit(1);
        }

        const headers: HEADERS = {
            'user-agent': 'devcontainer',
            'accept': 'application/json',
            'authorization': `Bearer ${authToken}`
        };

        const options = {
            type: 'GET',
            url: url,
            headers: headers
        };

        const response = await request(options);
        const publishedVersionsResponse: versions = JSON.parse(response.toString());

        return publishedVersionsResponse.tags;
    } catch (e) {
        // Publishing for the first time
        if (e?.message.includes('HTTP 404: Not Found')) {
            return [];
        }

        output.write(`(!) ERR: Failed to publish feature: ${e?.message ?? ''} `, LogLevel.Error);
        process.exit(1);
    }
}

let semanticVersions: string[] = [];

function updateSemanticVersionsList(publishedVersions: string[], version: string, range: string, publishVersion: string) {
    // Reference: https://github.com/npm/node-semver#ranges-1
    const publishedMaxVersion = semver.maxSatisfying(publishedVersions, range);
    if (publishedMaxVersion === null || semver.compare(version, publishedMaxVersion) === 1) {
        semanticVersions.push(publishVersion);
    }
    return;
}

export function getSermanticVersions(version: string, publishedVersions: string[], output: Log) {
    if (publishedVersions.includes(version)) {
        output.write(`(!) WARNING: Version ${version} already exists, skipping ${version}...`, LogLevel.Warning);
        return undefined;
    }

    if (semver.valid(version) === null) {
        output.write(`(!) ERR: Version ${version} is not a valid semantic version...`, LogLevel.Error);
        process.exit(1);
    }

    // Adds semantic versions depending upon the existings (published) version tags
    // eg. 1.2.3 --> [1, 1.2, 1.2.3, latest]
    const parsedVersion = semver.parse(version);
    semanticVersions = [];
    updateSemanticVersionsList(publishedVersions, version, `${parsedVersion.major}.x.x`, parsedVersion.major);
    updateSemanticVersionsList(publishedVersions, version, `${parsedVersion.major}.${parsedVersion.minor}.x`, `${parsedVersion.major}.${parsedVersion.minor}`);
    semanticVersions.push(version);
    updateSemanticVersionsList(publishedVersions, version, `x.x.x`, 'latest');

    return semanticVersions;
}

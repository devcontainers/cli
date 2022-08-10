import { fetchRegistryAuthToken, HEADERS } from '../../spec-configuration/containerFeaturesOCI';
import { request } from '../../spec-utils/httpRequest';
import { Log, LogLevel } from '../../spec-utils/log';

const semverCompare = require('semver-compare');
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

export function getSermanticVersions(version: string, publishedVersions: string[], output: Log) {
    if (publishedVersions.includes(version)) {
        output.write(`(!) WARNING: Version ${version} already exists, skipping ${version}...`, LogLevel.Warning);
        return undefined;
    }

    let semanticVersions: string[] = [];
    if (semver.valid(version) === null) {
        output.write(`(!) ERR: Version ${version} is not a valid semantic version...`, LogLevel.Error);
        process.exit(1);
    }

    // Add semantic versions eg. 1.2.3 --> [1, 1.2, 1.2.3]
    const parsedVersion = semver.parse(version);

    if (parsedVersion.major !== 0) {
        semanticVersions.push(parsedVersion.major);
        semanticVersions.push(`${parsedVersion.major}.${parsedVersion.minor}`);
    }

    semanticVersions.push(version);

    let publishLatest = true;
    if (publishedVersions.length > 0) {
        const sortedVersions = publishedVersions.sort(semverCompare);

        // Compare version with the last published version
        publishLatest = semverCompare(version, sortedVersions[sortedVersions.length - 1]) === 1 ? true : false;
    }

    if (publishLatest) {
        semanticVersions.push('latest');
    }

    return semanticVersions;
}

// TODO: Depends on https://github.com/devcontainers/cli/pull/99
export function doFeaturesPublishCommand() {
    return 0;
}

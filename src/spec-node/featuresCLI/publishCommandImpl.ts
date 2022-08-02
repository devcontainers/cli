import { request } from '../../spec-utils/httpRequest';
import { Log, LogLevel } from '../../spec-utils/log';

const semverCompare = require('semver-compare');
const semver = require('semver');

interface versions {
    name: string;
    tags: string[];
}

export async function getPublishedVersions(featureId: string, registry: string, namespace: string, output: Log) {
    const url = `https://${registry}/v2/${namespace}/${featureId}/tags/list`;
    const id = `${registry}/${namespace}/${featureId}`;
    let token = '';

    try {
        token = await getAuthenticationToken(registry, id);
    } catch (e) {
        // Publishing for the first time
        if (e?.message.includes('403')) {
            return [];
        }

        output.write(`(!) ERR: Failed to publish feature: ${e?.message ?? ''} `, LogLevel.Error);
        process.exit(1);
    }

    try {
        const headers = {
            'user-agent': 'devcontainer',
            'Authorization': token,
            'Accept': 'application/json',
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
        output.write(`(!) ERR: Failed to publish feature: ${e?.message ?? ''} `, LogLevel.Error);
        process.exit(1);
    }
}

export function getSermanticVersions(version: string, publishedVersions: string[], output: Log) {
    if (publishedVersions.includes(version)) {
        output.write(`(!) Version ${version} already exists, skipping ${version}...`, LogLevel.Warning);
        return undefined;
    }

    let semanticVersions: string[] = [];
    if (semver.valid(version) === null) {
        output.write(`(!) ERR: Version ${version} is not a valid semantic version...`, LogLevel.Error);
        process.exit(1);
    }

    // Add semantic versions ex. 1.2.3 --> [1, 1.2, 1.2.3]
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

// temp
async function getAuthenticationToken(registry: string, id: string): Promise<string> {
    if (registry === 'ghcr.io') {
        const token = await getGHCRtoken(id);
        return 'Bearer ' + token;
    }

    return '';
}

// temp
export async function getGHCRtoken(id: string) {
    const headers = {
        'user-agent': 'devcontainer',
    };

    const url = `https://ghcr.io/token?scope=repo:${id}:pull&service=ghcr.io`;

    const options = {
        type: 'GET',
        url: url,
        headers: headers
    };

    const token = JSON.parse((await request(options)).toString()).token;

    return token;
}

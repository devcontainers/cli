import path from 'path';
import * as semver from 'semver';
import { getPublishedVersions, OCIFeatureCollectionRef, OCIFeatureRef } from '../../spec-configuration/containerFeaturesOCI';
import { pushFeatureCollectionMetadata, pushOCIFeature } from '../../spec-configuration/containerFeaturesOCIPush';
import { Log, LogLevel } from '../../spec-utils/log';
import { getFeatureArchiveName, OCIFeatureCollectionFileName } from './packageCommandImpl';

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

    const parsedVersion = semver.parse(version);
    if (!parsedVersion) {
        output.write(`(!) ERR: Version ${version} is not a valid semantic version...`, LogLevel.Error);
        process.exit(1);
    }

    semanticVersions = [];

    // Adds semantic versions depending upon the existings (published) versions
    // eg. 1.2.3 --> [1, 1.2, 1.2.3, latest]
    updateSemanticVersionsList(publishedVersions, version, `${parsedVersion.major}.x.x`, `${parsedVersion.major}`);
    updateSemanticVersionsList(publishedVersions, version, `${parsedVersion.major}.${parsedVersion.minor}.x`, `${parsedVersion.major}.${parsedVersion.minor}`);
    semanticVersions.push(version);
    updateSemanticVersionsList(publishedVersions, version, `x.x.x`, 'latest');

    return semanticVersions;
}

export async function doFeaturesPublishCommand(version: string, featureRef: OCIFeatureRef, outputDir: string, output: Log): Promise<number> {
    output.write(`Fetching published versions...`, LogLevel.Info);
    const publishedVersions: string[] = await getPublishedVersions(featureRef, output);
    const semanticVersions: string[] | undefined = getSermanticVersions(version, publishedVersions, output);

    if (!!semanticVersions) {
        output.write(`Publishing versions: ${semanticVersions.toString()}...`, LogLevel.Info);
        const pathToTgz = path.join(outputDir, getFeatureArchiveName(featureRef.id));
        if (! await pushOCIFeature(output, featureRef, pathToTgz, semanticVersions)) {
            output.write(`(!) ERR: Failed to publish feature: ${featureRef.resource}`, LogLevel.Error);
            return 1;
        }
        output.write(`Published feature: ${featureRef.id}...`, LogLevel.Info);
    }

    // Publishing Feature Collection Metadata
    output.write('Publishing collection metadata...', LogLevel.Info);
    const featureCollectionRef: OCIFeatureCollectionRef = {
        registry: featureRef.registry,
        path: featureRef.namespace,
        version: 'latest'
    };
    const pathToFeatureCollectionFile = path.join(outputDir, OCIFeatureCollectionFileName);
    if (! await pushFeatureCollectionMetadata(output, featureCollectionRef, pathToFeatureCollectionFile)) {
        output.write(`(!) ERR: Failed to publish collection metadata: ${OCIFeatureCollectionFileName}`, LogLevel.Error);
        return 1;
    }
    output.write('Published collection metadata...', LogLevel.Info);

    return 0;
}

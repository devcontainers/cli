import path from 'path';
import * as semver from 'semver';
import { Log, LogLevel } from '../../spec-utils/log';
import { CommonParams, getPublishedVersions, OCICollectionRef, OCIRef } from '../../spec-configuration/containerCollectionsOCI';
import { OCICollectionFileName } from './packageCommandImpl';
import { pushCollectionMetadata, pushOCIFeatureOrTemplate } from '../../spec-configuration/containerCollectionsOCIPush';

let semanticVersions: string[] = [];
function updateSemanticVersionsList(publishedVersions: string[], version: string, range: string, publishVersion: string) {
	// Reference: https://github.com/npm/node-semver#ranges-1
	const publishedMaxVersion = semver.maxSatisfying(publishedVersions, range);
	if (publishedMaxVersion === null || semver.compare(version, publishedMaxVersion) === 1) {
		semanticVersions.push(publishVersion);
	}
	return;
}

export function getSemanticVersions(version: string, publishedVersions: string[], output: Log) {
	if (publishedVersions.includes(version)) {
		output.write(`(!) WARNING: Version ${version} already exists, skipping ${version}...`, LogLevel.Warning);
		return undefined;
	}

	const parsedVersion = semver.parse(version);
	if (!parsedVersion) {
		output.write(`(!) ERR: Version ${version} is not a valid semantic version, skipping ${version}...`, LogLevel.Error);
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

export async function doPublishCommand(params: CommonParams, version: string, ociRef: OCIRef, outputDir: string, collectionType: string, archiveName: string, featureAnnotations = {}) {
	const { output } = params;

	output.write(`Fetching published versions...`, LogLevel.Info);
	const publishedVersions = await getPublishedVersions(params, ociRef);

	if (!publishedVersions) {
		return;
	}

	const semanticVersions: string[] | undefined = getSemanticVersions(version, publishedVersions, output);

	if (!!semanticVersions) {
		output.write(`Publishing versions: ${semanticVersions.toString()}...`, LogLevel.Info);
		const pathToTgz = path.join(outputDir, archiveName);
		const digest = await pushOCIFeatureOrTemplate(params, ociRef, pathToTgz, semanticVersions, collectionType, featureAnnotations);
		if (!digest) {
			output.write(`(!) ERR: Failed to publish ${collectionType}: '${ociRef.resource}'`, LogLevel.Error);
			return;
		}
		output.write(`Published ${collectionType}: '${ociRef.id}'`, LogLevel.Info);
		return { publishedVersions: semanticVersions, digest };
	}

	return {}; // Not an error if no versions were published, likely they just already existed and were skipped.
}

export async function doPublishMetadata(params: CommonParams, collectionRef: OCICollectionRef, outputDir: string, collectionType: string): Promise<string | undefined> {
	const { output } = params;

	// Publishing Feature/Template Collection Metadata
	output.write('Publishing collection metadata...', LogLevel.Info);

	const pathToCollectionFile = path.join(outputDir, OCICollectionFileName);
	const publishedDigest = await pushCollectionMetadata(params, collectionRef, pathToCollectionFile, collectionType);
	if (!publishedDigest) {
		output.write(`(!) ERR: Failed to publish collection metadata: ${OCICollectionFileName}`, LogLevel.Error);
		return;
	}
	output.write('Published collection metadata.', LogLevel.Info);
	return publishedDigest;
}

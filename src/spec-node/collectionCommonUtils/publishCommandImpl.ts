import path from 'path';
import * as semver from 'semver';
import { Log, LogLevel } from '../../spec-utils/log';
import { getPublishedVersions, OCICollectionRef, OCIRef } from '../../spec-configuration/containerCollectionsOCI';
import { getArchiveName, OCICollectionFileName } from './packageCommandImpl';
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

export function getSermanticVersions(version: string, publishedVersions: string[], output: Log) {
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

export async function doPublishCommand(version: string, ociRef: OCIRef, outputDir: string, output: Log, collectionType: string) {
	output.write(`Fetching published versions...`, LogLevel.Info);
	const publishedVersions = await getPublishedVersions(ociRef, output);

	if (!publishedVersions) {
		return false;
	}

	const semanticVersions: string[] | undefined = getSermanticVersions(version, publishedVersions, output);

	if (!!semanticVersions) {
		output.write(`Publishing versions: ${semanticVersions.toString()}...`, LogLevel.Info);
		const pathToTgz = path.join(outputDir, getArchiveName(ociRef.id, collectionType));
		if (! await pushOCIFeatureOrTemplate(output, ociRef, pathToTgz, semanticVersions, collectionType)) {
			output.write(`(!) ERR: Failed to publish ${collectionType}: '${ociRef.resource}'`, LogLevel.Error);
			return false;
		}
	}
	output.write(`Published ${collectionType}: ${ociRef.id}...`, LogLevel.Info);
	return true;
}

export async function doPublishMetadata(collectionRef: OCICollectionRef, outputDir: string, output: Log, collectionType: string) {
	// Publishing Feature/Template Collection Metadata
	output.write('Publishing collection metadata...', LogLevel.Info);

	const pathToCollectionFile = path.join(outputDir, OCICollectionFileName);
	if (! await pushCollectionMetadata(output, collectionRef, pathToCollectionFile, collectionType)) {
		output.write(`(!) ERR: Failed to publish collection metadata: ${OCICollectionFileName}`, LogLevel.Error);
		return false;
	}
	output.write('Published collection metadata...', LogLevel.Info);
	return true;
}

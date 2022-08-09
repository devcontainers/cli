import path from 'path';
import tar from 'tar';
import { Feature } from '../../spec-configuration/containerFeaturesConfiguration';
import { LogLevel } from '../../spec-utils/log';
import { isLocalFile, readLocalDir, readLocalFile, writeLocalFile } from '../../spec-utils/pfs';
import { FeaturesPackageCommandInput } from './package';

import { pushOCIFeature } from '../../spec-configuration/containerFeaturesOCIPush';
import { OCIFeatureRef } from '../../spec-configuration/containerFeaturesOCI';

export interface SourceInformation {
	source: string;
	owner?: string;
	repo?: string;
	tag?: string;
	ref?: string;
	sha?: string;
}
export interface DevContainerCollectionMetadata {
	sourceInformation: SourceInformation;
	features: Feature[];
}

export async function doFeaturesPackageCommand(args: FeaturesPackageCommandInput): Promise<number> {
	const { output, isSingleFeature } = args;

	// For each feature, package each feature and write to 'outputDir/{f}.tgz'
	// Returns an array of feature metadata from each processed feature

	let metadataOutput: Feature[] | undefined = [];
	if (isSingleFeature) {
		// Package individual features
		metadataOutput = await packageSingleFeature(args);
	} else {
		metadataOutput = await packageCollection(args);
	}

	if (!metadataOutput) {
		output.write('Failed to package features', LogLevel.Error);
		return 1;
	}

	const collection: DevContainerCollectionMetadata = {
		sourceInformation: {
			source: 'devcontainer-cli',
		},
		features: metadataOutput,
	};

	// Write the metadata to a file
	const metadataOutputPath = path.join(args.outputDir, 'devcontainer-collection.json');
	await writeLocalFile(metadataOutputPath, JSON.stringify(collection, null, 4));


	// TODO: temporary
	const featureRef: OCIFeatureRef = {
		id: 'color',
		owner: 'joshspicer',
		namespace: 'joshspicer/mypackages',
		registry: 'ghcr.io',
		resource: 'ghcr.io/joshspicer/mypackages/color'
	};
	const result = await pushOCIFeature(output, process.env, featureRef, path.join(args.outputDir, `devcontainer-feature-color.tgz`), ['1', '1.0']);
	if (!result) {
		output.write('Failed to push feature', LogLevel.Error);
	} else {
		output.write('Successfully pushed feature', LogLevel.Info);
	}
	// END TEMPORARY

	return 0;
}

async function tarDirectory(featureFolder: string, archiveName: string, outputDir: string) {
	return new Promise<void>((resolve) => resolve(tar.create({ file: path.join(outputDir, archiveName), cwd: featureFolder }, ['.'])));
}

const getArchiveName = (f: string) => `devcontainer-feature-${f}.tgz`;

export async function packageSingleFeature(args: FeaturesPackageCommandInput): Promise<Feature[] | undefined> {
	const { output, targetFolder, outputDir } = args;
	let metadatas: Feature[] = [];

	const featureJsonPath = path.join(targetFolder, 'devcontainer-feature.json');
	const featureMetadata: Feature = JSON.parse(await readLocalFile(featureJsonPath, 'utf-8'));
	if (!featureMetadata.id || !featureMetadata.version) {
		output.write(`Feature is missing an id or version in its devcontainer-feature.json`, LogLevel.Error);
		return;
	}
	const archiveName = getArchiveName(featureMetadata.id);

	await tarDirectory(targetFolder, archiveName, outputDir);
	output.write(`Packaged feature '${featureMetadata.id}'`, LogLevel.Info);

	metadatas.push(featureMetadata);
	return metadatas;
}


export async function packageCollection(args: FeaturesPackageCommandInput): Promise<Feature[] | undefined> {
	const { output, targetFolder: srcFolder, outputDir } = args;

	const featuresDirs = await readLocalDir(srcFolder);
	let metadatas: Feature[] = [];

	for await (const f of featuresDirs) {
		output.write(`Processing feature: ${f}...`, LogLevel.Info);
		if (!f.startsWith('.')) {
			const featureFolder = path.join(srcFolder, f);
			const archiveName = getArchiveName(f);

			// Validate minimal feature folder structure
			const featureJsonPath = path.join(featureFolder, 'devcontainer-feature.json');
			const installShPath = path.join(featureFolder, 'install.sh');
			if (!isLocalFile(featureJsonPath)) {
				output.write(`Feature '${f}' is missing a devcontainer-feature.json`, LogLevel.Error);
				return;
			}
			if (!isLocalFile(installShPath)) {
				output.write(`Feature '${f}' is missing an install.sh`, LogLevel.Error);
				return;
			}

			await tarDirectory(featureFolder, archiveName, outputDir);

			const featureMetadata: Feature = JSON.parse(await readLocalFile(featureJsonPath, 'utf-8'));
			if (!featureMetadata.id || !featureMetadata.version) {
				output.write(`Feature '${f}' is missing an id or verion in its devcontainer-feature.json`, LogLevel.Error);
				return;
			}
			metadatas.push(featureMetadata);
		}
	}

	if (metadatas.length === 0) {
		return;
	}

	output.write(`Packaged ${metadatas.length} features!`, LogLevel.Info);
	return metadatas;
}
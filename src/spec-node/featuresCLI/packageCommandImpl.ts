import path from 'path';
import tar from 'tar';
import { Feature } from '../../spec-configuration/containerFeaturesConfiguration';
import { LogLevel } from '../../spec-utils/log';
import { isLocalFile, readLocalDir, readLocalFile, writeLocalFile } from '../../spec-utils/pfs';
import { FeaturesPackageCommandInput } from './package';

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
	const { output, isCollection } = args;

	// For each feature, package each feature and write to 'outputDir/{f}.tgz'
	// Returns an array of feature metadata from each processed feature

	let metadataOutput: Feature[] | undefined = [];
	if (isCollection) {
		metadataOutput = await packageCollection(args);
	} else {
		// Package individual features
		throw new Error('TODO!');
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

	return 0;
}

async function tarDirectory(featureFolder: string, archiveName: string, outputDir: string) {
	return new Promise<void>((resolve) => resolve(tar.create({ file: path.join(outputDir, archiveName), cwd: featureFolder }, ['.'])));
}

export async function packageCollection(args: FeaturesPackageCommandInput): Promise<Feature[] | undefined> {
	const { output, targetFolder, outputDir } = args;

	const srcFolder = path.join(targetFolder, 'src');
	const featuresDirs = await readLocalDir(srcFolder);
	let metadatas: Feature[] = [];

	for await (const f of featuresDirs) {
		output.write(`Processing feature: ${f}...`, LogLevel.Info);
		if (!f.startsWith('.')) {
			const featureFolder = path.join(srcFolder, f);
			const archiveName = `devcontainer-feature-${f}.tgz`;

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
			metadatas.push(featureMetadata);
		}
	}

	if (metadatas.length === 0) {
		return;
	}

	output.write(`Packaged ${metadatas.length} features!`, LogLevel.Info);
	return metadatas;
}
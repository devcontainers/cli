import path from 'path';
import tar from 'tar';
import { Feature } from '../../spec-configuration/containerFeaturesConfiguration';
import { LogLevel } from '../../spec-utils/log';
import { isLocalFile, isLocalFolder, mkdirpLocal, readLocalDir, readLocalFile, rmLocal, writeLocalFile } from '../../spec-utils/pfs';
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

export const OCIFeatureCollectionFileName = 'devcontainer-collection.json';

async function prepPackageCommand(args: FeaturesPackageCommandInput): Promise<FeaturesPackageCommandInput> {
	const { cliHost, targetFolder, outputDir, forceCleanOutputDir, output, disposables } = args;

	const targetFolderResolved = cliHost.path.resolve(targetFolder);
	if (!(await isLocalFolder(targetFolderResolved))) {
		throw new Error(`Target folder '${targetFolderResolved}' does not exist`);
	}

	const outputDirResolved = cliHost.path.resolve(outputDir);
	if (await isLocalFolder(outputDirResolved)) {
		// Output dir exists. Delete it automatically if '-f' is true
		if (forceCleanOutputDir) {
			await rmLocal(outputDirResolved, { recursive: true, force: true });
		}
		else {
			output.write(`(!) ERR: Output directory '${outputDirResolved}' already exists. Manually delete, or pass '-f' to continue.`, LogLevel.Error);
			process.exit(1);
		}
	}

	// Detect if we're packaging a collection or a single feature
	const isValidFolder = await isLocalFolder(cliHost.path.join(targetFolderResolved));
	const isSingleFeature = await isLocalFile(cliHost.path.join(targetFolderResolved, 'devcontainer-feature.json'));

	if (!isValidFolder) {
		throw new Error(`Target folder '${targetFolderResolved}' does not exist`);
	}

	if (isSingleFeature) {
		output.write('Packaging single feature...', LogLevel.Info);
	} else {
		output.write('Packaging feature collection...', LogLevel.Info);
	}

	// Generate output folder.
	await mkdirpLocal(outputDirResolved);

	return {
		cliHost,
		targetFolder: targetFolderResolved,
		outputDir: outputDirResolved,
		forceCleanOutputDir,
		output,
		disposables,
		isSingleFeature: isSingleFeature
	};
}

export async function doFeaturesPackageCommand(args: FeaturesPackageCommandInput): Promise<DevContainerCollectionMetadata | undefined> {
	args = await prepPackageCommand(args);
	const { output, isSingleFeature, outputDir } = args;

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
		return undefined;
	}

	const collection: DevContainerCollectionMetadata = {
		sourceInformation: {
			source: 'devcontainer-cli',
		},
		features: metadataOutput,
	};

	// Write the metadata to a file
	const metadataOutputPath = path.join(outputDir, OCIFeatureCollectionFileName);
	await writeLocalFile(metadataOutputPath, JSON.stringify(collection, null, 4));
	return collection;
}

async function tarDirectory(featureFolder: string, archiveName: string, outputDir: string) {
	return new Promise<void>((resolve) => resolve(tar.create({ file: path.join(outputDir, archiveName), cwd: featureFolder }, ['.'])));
}

export const getFeatureArchiveName = (f: string) => `devcontainer-feature-${f}.tgz`;

export async function packageSingleFeature(args: FeaturesPackageCommandInput): Promise<Feature[] | undefined> {
	const { output, targetFolder, outputDir } = args;
	let metadatas: Feature[] = [];

	const featureJsonPath = path.join(targetFolder, 'devcontainer-feature.json');
	const featureMetadata: Feature = JSON.parse(await readLocalFile(featureJsonPath, 'utf-8'));
	if (!featureMetadata.id || !featureMetadata.version) {
		output.write(`Feature is missing an id or version in its devcontainer-feature.json`, LogLevel.Error);
		return;
	}
	const archiveName = getFeatureArchiveName(featureMetadata.id);

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
			const archiveName = getFeatureArchiveName(f);

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
				output.write(`Feature '${f}' is missing an id or version in its devcontainer-feature.json`, LogLevel.Error);
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

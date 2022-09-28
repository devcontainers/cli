import tar from 'tar';
import { PackageCommandInput } from './package';
import { isLocalFile, isLocalFolder, mkdirpLocal, readLocalDir, readLocalFile, rmLocal } from '../../spec-utils/pfs';
import { LogLevel } from '../../spec-utils/log';
import path from 'path';

export interface SourceInformation {
	source: string;
	owner?: string;
	repo?: string;
	tag?: string;
	ref?: string;
	sha?: string;
}

export const OCICollectionFileName = 'devcontainer-collection.json';

export async function prepPackageCommand(args: PackageCommandInput, collectionType: string): Promise<PackageCommandInput> {
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

	// Detect if we're packaging a collection or a single feature/template
	const isValidFolder = await isLocalFolder(cliHost.path.join(targetFolderResolved));
	const isSingle = await isLocalFile(cliHost.path.join(targetFolderResolved, `devcontainer-${collectionType}.json`));

	if (!isValidFolder) {
		throw new Error(`Target folder '${targetFolderResolved}' does not exist`);
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
		isSingle
	};
}

async function tarDirectory(folder: string, archiveName: string, outputDir: string) {
	return new Promise<void>((resolve) => resolve(tar.create({ file: path.join(outputDir, archiveName), cwd: folder }, ['.'])));
}

const getArchiveName = (f: string, collectionType: string) => `devcontainer-${collectionType}-${f}.tgz`;

export async function packageSingleFeatureOrTemplate(args: PackageCommandInput, collectionType: string) {
	const { output, targetFolder, outputDir } = args;
	let metadatas = [];

	const jsonPath = path.join(targetFolder, `devcontainer-${collectionType}.json`);
	const metadata = JSON.parse(await readLocalFile(jsonPath, 'utf-8'));
	if (!metadata.id || !metadata.version) {
		output.write(`${collectionType} is missing an id or version in its devcontainer-${collectionType}.json`, LogLevel.Error);
		return;
	}

	const archiveName = getArchiveName(metadata.id, collectionType);

	await tarDirectory(targetFolder, archiveName, outputDir);
	output.write(`Packaged ${collectionType} '${metadata.id}'`, LogLevel.Info);

	metadatas.push(metadata);
	return metadatas;
}

// Packages collection of Features or Templates
export async function packageCollection(args: PackageCommandInput, collectionType: string) {
	const { output, targetFolder: srcFolder, outputDir } = args;

	const collectionDirs = await readLocalDir(srcFolder);
	let metadatas = [];

	for await (const c of collectionDirs) {
		output.write(`Processing ${collectionType}: ${c}...`, LogLevel.Info);
		if (!c.startsWith('.')) {
			const folder = path.join(srcFolder, c);
			const archiveName = getArchiveName(c, collectionType);

			// Validate minimal folder structure
			const devcontainerJsonName = `devcontainer-${collectionType}.json`;
			const jsonPath = path.join(folder, devcontainerJsonName);
			if (!(await isLocalFile(jsonPath))) {
				output.write(`${collectionType} '${c}' is missing a ${devcontainerJsonName}`, LogLevel.Error);
				return;
			}

			if (collectionType === 'feature') {
				const installShPath = path.join(folder, 'install.sh');
				if (!(await isLocalFile(installShPath))) {
					output.write(`Feature '${c}' is missing an install.sh`, LogLevel.Error);
					return;
				}
			} else if (collectionType === 'template') {
				const devcontainerFile = path.join(folder, '.devcontainer.json');
				const devcontainerFileWithinDevcontainerFolder = path.join(folder, '.devcontainer/devcontainer.json');

				if (!(await isLocalFile(devcontainerFile)) && !(await isLocalFile(devcontainerFileWithinDevcontainerFolder))) {
					output.write(`Template '${c}' is missing a devcontainer.json`, LogLevel.Error);
					return;
				}
			}

			await tarDirectory(folder, archiveName, outputDir);

			const metadata = JSON.parse(await readLocalFile(jsonPath, 'utf-8'));
			if (!metadata.id || !metadata.version) {
				output.write(`${collectionType} '${c}' is missing an id or version in its ${devcontainerJsonName}`, LogLevel.Error);
				return;
			}
			metadatas.push(metadata);
		}
	}

	if (metadatas.length === 0) {
		return;
	}

	output.write(`Packaged ${metadatas.length} ${collectionType}s!`, LogLevel.Info);
	return metadatas;
}

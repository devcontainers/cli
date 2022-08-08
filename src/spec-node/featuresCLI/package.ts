import path from 'path';
import { Argv } from 'yargs';
import { CLIHost, getCLIHost } from '../../spec-common/cliHost';
import { loadNativeModule } from '../../spec-common/commonUtils';
import { Log, LogLevel, mapLogLevel } from '../../spec-utils/log';
import { isLocalFile, isLocalFolder, mkdirpLocal, rmLocal } from '../../spec-utils/pfs';
import { createLog } from '../devContainers';
import { UnpackArgv } from '../devContainersSpecCLI';
import { getPackageConfig } from '../utils';
import { doFeaturesPackageCommand } from './packageCommandImpl';

const targetPositionalDescription = `
Package features at provided [target] (default is cwd), where [target] is either:
   1. A path to the src folder of the collection with [1..n] features.
   2. A path to a single feature that contains a devcontainer-feature.json.
   
   Additionally, a 'devcontainer-collection.json' will be generated in the output directory.
`;

export function featuresPackageOptions(y: Argv) {
	return y
		.options({
			'output-folder': { type: 'string', alias: 'o', default: './output', description: 'Path to output directory. Will create directories as needed.' },
			'force-clean-output-folder': { type: 'boolean', alias: 'f', default: false, description: 'Automatically delete previous output directory before packaging' },
			'log-level': { choices: ['info' as 'info', 'debug' as 'debug', 'trace' as 'trace'], default: 'info' as 'info', description: 'Log level.' },
		})
		.positional('target', { type: 'string', default: '.', description: targetPositionalDescription })
		.check(_argv => {
			return true;
		});
}

export type FeaturesPackageArgs = UnpackArgv<ReturnType<typeof featuresPackageOptions>>;
export interface FeaturesPackageCommandInput {
	cliHost: CLIHost;
	targetFolder: string;
	outputDir: string;
	output: Log;
	disposables: (() => Promise<unknown> | undefined)[];
	isSingleFeature: boolean; // Packaging a collection of many features. Should autodetect.
}

export function featuresPackageHandler(args: FeaturesPackageArgs) {
	(async () => await featuresPackage(args))().catch(console.error);
}

async function featuresPackage({
	'target': targetFolder,
	'log-level': inputLogLevel,
	'output-folder': outputDir,
	'force-clean-output-folder': forceCleanOutputDir,
}: FeaturesPackageArgs) {
	const disposables: (() => Promise<unknown> | undefined)[] = [];
	const dispose = async () => {
		await Promise.all(disposables.map(d => d()));
	};

	const extensionPath = path.join(__dirname, '..', '..', '..');
	const pkg = await getPackageConfig(extensionPath);

	const cwd = process.cwd();
	const cliHost = await getCLIHost(cwd, loadNativeModule);
	const output = createLog({
		logLevel: mapLogLevel(inputLogLevel),
		logFormat: 'text',
		log: (str) => process.stdout.write(str),
		terminalDimensions: undefined,
	}, pkg, new Date(), disposables);

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
			output.write(`Output directory '${outputDirResolved}' already exists. Manually delete, or pass '-f' to continue.`, LogLevel.Warning);
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

	const args: FeaturesPackageCommandInput = {
		cliHost,
		targetFolder: targetFolderResolved,
		outputDir: outputDirResolved,
		output,
		disposables,
		isSingleFeature,
	};

	const exitCode = await doFeaturesPackageCommand(args);

	await dispose();
	process.exit(exitCode);
}
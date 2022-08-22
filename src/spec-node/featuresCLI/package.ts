import path from 'path';
import { Argv } from 'yargs';
import { CLIHost, getCLIHost } from '../../spec-common/cliHost';
import { loadNativeModule } from '../../spec-common/commonUtils';
import { Log, mapLogLevel } from '../../spec-utils/log';
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
	isSingleFeature?: boolean; // Packaging a collection of many features. Should autodetect.
	forceCleanOutputDir?: boolean;
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


	const args: FeaturesPackageCommandInput = {
		cliHost,
		targetFolder,
		outputDir,
		output,
		disposables,
		forceCleanOutputDir: forceCleanOutputDir
	};

	const exitCode = !!(await doFeaturesPackageCommand(args)) ? 0 : 1;

	await dispose();
	process.exit(exitCode);
}

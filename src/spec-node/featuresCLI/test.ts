import * as path from 'path';
import { Argv } from 'yargs';
import { CLIHost, getCLIHost } from '../../spec-common/cliHost';
import { loadNativeModule } from '../../spec-common/commonUtils';
import { LogLevel, mapLogLevel } from '../../spec-utils/log';
import { getPackageConfig, PackageConfiguration } from '../../spec-utils/product';
import { UnpackArgv } from '../devContainersSpecCLI';
import { doFeaturesTestCommand } from './testCommandImpl';

export function featuresTestOptions(y: Argv) {
	return y
		.options({
			// Primary Options
			'features': { type: 'array', alias: 'f', describe: 'Feature(s) to test as space-separated parameters. Omit to auto-detect all features in the collection test directory.', },
			'global-only': { type: 'boolean', alias: 'g', default: false, describe: 'Only test global features (not nested under a folder). Cannot be combined with --features.' },
			// Auto generate configuration
			'base-image': { type: 'string', alias: 'i', default: 'ubuntu:focal', description: 'Set a custom base image.  By default, does not apply scenarios' },
			'remote-user': { type: 'string', alias: 'u', default: 'root', describe: 'Set the remote user. By default, does not apply to scenarios.', },
			// Flags
			'disable-test-scenarios': { type: 'boolean', alias: 's', default: false, description: 'Flag to toggle running \'scenarios.json\' style tests.' },
			'override-scenarios-with-cmdline-configuration': { type: 'boolean', default: false, description: 'If set, command line configuration (like \'--base-image\' will override a preset value in a given scenario.' },
			// Metadata
			'log-level': { choices: ['info' as 'info', 'debug' as 'debug', 'trace' as 'trace'], default: 'info' as 'info', description: 'Log level.' },
			'quiet': { type: 'boolean', alias: 'q', default: false, description: 'Quiets output' },
		})
		.positional('target', { type: 'string', default: '.', description: 'Path to collection folder containing \'src\' and \'test\' folders.' })
		.check(argv => {
			if (argv['global-only'] && argv['features']) {
				throw new Error('Cannot combine --global-only and --features');
			}
			return true;
		});
}

export type FeaturesTestArgs = UnpackArgv<ReturnType<typeof featuresTestOptions>>;
export interface FeaturesTestCommandInput {
	collectionFolder: string;
	features?: string[];
	globalOnly: boolean;
	baseImage: string;
	remoteUser: string;
	disableTestScenarios: boolean;
	overrideScenariosWithCmdlineConfiguration: boolean;
	logLevel: LogLevel;
	quiet: boolean;
	cliHost: CLIHost;
	pkg: PackageConfiguration;
	disposables: (() => Promise<unknown> | undefined)[];
}

export function featuresTestHandler(args: FeaturesTestArgs) {
	(async () => await featuresTest(args))().catch(console.error);
}

async function featuresTest({
	'base-image': baseImage,
	'target': collectionFolder,
	features,
	'global-only': globalOnly,
	'remote-user': remoteUser,
	quiet,
	'log-level': inputLogLevel,
	'disable-test-scenarios': disableTestScenarios,
	'override-scenarios-with-cmdline-configuration': overrideScenariosWithCmdlineConfiguration,
}: FeaturesTestArgs) {
	const disposables: (() => Promise<unknown> | undefined)[] = [];
	const dispose = async () => {
		await Promise.all(disposables.map(d => d()));
	};

	const cwd = process.cwd();
	const cliHost = await getCLIHost(cwd, loadNativeModule);
	const extensionPath = path.join(__dirname, '..', '..', '..');
	const pkg = await getPackageConfig(extensionPath);

	const logLevel = mapLogLevel(inputLogLevel);

	const args: FeaturesTestCommandInput = {
		baseImage,
		cliHost,
		logLevel,
		globalOnly,
		quiet,
		pkg,
		disableTestScenarios,
		overrideScenariosWithCmdlineConfiguration,
		collectionFolder: cliHost.path.resolve(collectionFolder),
		features: features ? (Array.isArray(features) ? features as string[] : [features]) : undefined,
		remoteUser,
		disposables
	};

	const exitCode = await doFeaturesTestCommand(args);

	await dispose();
	process.exit(exitCode);
}
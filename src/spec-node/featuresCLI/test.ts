import * as path from 'path';
import { Argv } from 'yargs';
import { CLIHost, getCLIHost } from '../../spec-common/cliHost';
import { loadNativeModule } from '../../spec-common/commonUtils';
import { LogLevel, mapLogLevel } from '../../spec-utils/log';
import { getPackageConfig, PackageConfiguration } from '../../spec-utils/product';
import { UnpackArgv } from '../devContainersSpecCLI';
import { doFeaturesTestCommand } from './testCommandImpl';

// -- 'features test' command
export function featuresTestOptions(y: Argv) {
	return y
		.options({
			'features': { type: 'array', alias: 'f', describe: 'Feature(s) to test as space-separated parameters. Omit to run all tests.  Cannot be combined with \'--global-scenarios-only\'.', },
			'global-scenarios-only': { type: 'string', description: 'Run only scenario tests under \'tests/_global\' .  Cannot be combined with \'-f\'.' },
			'skip-scenarios': { type: 'array', default: false, description: 'Skip all \'scenario\' style tests under  Cannot be combined with \'-global--scenarios-only\'.' },
			'base-image': { type: 'string', alias: 'i', default: 'ubuntu:focal', description: 'Base Image' },  // TODO: Optionally replace 'scenario' configs with this value?
			'remote-user': { type: 'string', alias: 'u', default: 'root', describe: 'Remote user', },  // TODO: Optionally replace 'scenario' configs with this value?
			'log-level': { choices: ['info' as 'info', 'debug' as 'debug', 'trace' as 'trace'], default: 'info' as 'info', description: 'Log level.' },
			'quiet': { type: 'boolean', alias: 'q', default: false, description: 'Quiets output' },
		})
		.positional('target', { type: 'string', default: '.', description: 'Path to folder containing \'src\' and \'test\' sub-folders.' })
		.check(argv => {
			if (argv['global-scenarios-only'] && argv['features']) {
				throw new Error('Cannot combine --global-scenarios-only and --features');
			}
			if (argv['skip-scenarios'] && argv['global-scenarios-only']) {
				throw new Error('Cannot combine --skip-scenarios and --global-scenarios-only');
			}
			return true;
		});
}

export type FeaturesTestArgs = UnpackArgv<ReturnType<typeof featuresTestOptions>>;
export interface FeaturesTestCommandInput {
	cliHost: CLIHost;
	pkg: PackageConfiguration;
	baseImage: string;
	collectionFolder: string;
	features?: string[];
	skipScenarios: boolean;
	globalScenariosOnly: boolean;
	remoteUser: string;
	quiet: boolean;
	logLevel: LogLevel;
	disposables: (() => Promise<unknown> | undefined)[];
}

export function featuresTestHandler(args: FeaturesTestArgs) {
	(async () => await featuresTest(args))().catch(console.error);
}

async function featuresTest({
	'base-image': baseImage,
	'target': collectionFolder,
	features,
	'global-scenarios-only': globalScenariosOnly,
	'skip-scenarios': skipScenarios,
	'remote-user': remoteUser,
	quiet,
	'log-level': inputLogLevel,
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
		quiet,
		pkg,
		collectionFolder: cliHost.path.resolve(collectionFolder),
		features: features ? (Array.isArray(features) ? features as string[] : [features]) : undefined,
		globalScenariosOnly: !!globalScenariosOnly,
		skipScenarios,
		remoteUser,
		disposables
	};

	const exitCode = await doFeaturesTestCommand(args);

	await dispose();
	process.exit(exitCode);
}
// -- End: 'features test' command
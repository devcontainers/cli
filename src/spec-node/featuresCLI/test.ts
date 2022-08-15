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
			'features': { type: 'array', alias: 'f', describe: 'Feature(s) to test as space-separated parameters. Omit to auto-detect all features in the collection test directory.', },
			'global-only': { type: 'boolean', alias: 'g', default: false, describe: 'Only test global features (not nested under a folder). Cannot be combined with --features.' },
			// Auto generate configuration
			'base-image': { type: 'string', alias: 'i', default: 'ubuntu:focal', description: 'Set a custom base image.  Does not apply to scenarios.' },
			'remote-user': { type: 'string', alias: 'u', default: 'root', describe: 'Set the remote user. Does not apply to scenarios.', },
			// Flags
			'run-test-scenarios': { type: 'boolean', alias: 's', default: true, description: 'Flag to toggle running \'scenarios.json\' style tests.' },
			'run-global-tests': { type: 'boolean', alias: 'g', default: false, description: 'Flag to toggle running tests not associated with a single feature.' },
			// Metadata
			'log-level': { choices: ['info' as 'info', 'debug' as 'debug', 'trace' as 'trace'], default: 'info' as 'info', description: 'Log level.' },
			'quiet': { type: 'boolean', alias: 'q', default: false, description: 'Quiets output' },
		})
		.check(argv => {
			if (argv['global-only'] && argv['features']) {
				throw new Error('Cannot combine --global-only and --features');
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
		remoteUser,
		disposables
	};

	const exitCode = await doFeaturesTestCommand(args);

	await dispose();
	process.exit(exitCode);
}
import * as path from 'path';
import { Argv } from 'yargs';
import { CLIHost, getCLIHost } from '../../spec-common/cliHost';
import { loadNativeModule } from '../../spec-common/commonUtils';
import { LogLevel, mapLogLevel } from '../../spec-utils/log';
import { getPackageConfig, PackageConfiguration } from '../../spec-utils/product';
import { UnpackArgv } from '../devContainersSpecCLI';
import { doFeaturesPackageCommand } from './packageCommandImpl';

export function featuresPackageOptions(y: Argv) {
    return y
        .options({
            // 'features': { type: 'array', alias: 'f', describe: 'Feature(s) to test as space-separated parameters. Omit to auto-detect all features in collection directory.  Cannot be combined with \'-s\'.', },
            'collection-folder': { type: 'string', alias: 'c', default: '.', description: 'Path to folder containing \'src\' and \'test\' sub-folders.' },
            'output-dir': { type: 'string', alias: 'o', default: 'dist', description: 'Path to write packages to' },
            'log-level': { choices: ['info' as 'info', 'debug' as 'debug', 'trace' as 'trace'], default: 'info' as 'info', description: 'Log level.' },
            'quiet': { type: 'boolean', alias: 'q', default: false, description: 'Quiets output' },
        })
        .check(_argv => {
            // if (argv['scenarios'] && argv['features']) {
            //     throw new Error('Cannot combine --scenarios and --features');
            // }
            return true;
        });
}

export type FeaturesPackageArgs = UnpackArgv<ReturnType<typeof featuresPackageOptions>>;
export interface FeaturesPackageCommandInput {
    cliHost: CLIHost;
    pkg: PackageConfiguration;
    // features?: string[];
    collectionFolder: string;
    quiet: boolean;
    logLevel: LogLevel;
    outputDir: string;
    disposables: (() => Promise<unknown> | undefined)[];
}

export function featuresPackageHandler(args: FeaturesPackageArgs) {
    (async () => await featuresPackage(args))().catch(console.error);
}

async function featuresPackage({
    'collection-folder': collectionFolder,
    quiet,
    'log-level': inputLogLevel,
    'output-dir': outputDir,
}: FeaturesPackageArgs) {
    const disposables: (() => Promise<unknown> | undefined)[] = [];
    const dispose = async () => {
        await Promise.all(disposables.map(d => d()));
    };

    const cwd = process.cwd();
    const cliHost = await getCLIHost(cwd, loadNativeModule);
    const extensionPath = path.join(__dirname, '..', '..');
    const pkg = await getPackageConfig(extensionPath);

    const logLevel = mapLogLevel(inputLogLevel);

    const args: FeaturesPackageCommandInput = {
        cliHost,
        logLevel,
        quiet,
        pkg,
        outputDir: path.resolve(outputDir),
        collectionFolder: cliHost.path.resolve(collectionFolder),
        disposables
    };

    const exitCode = await doFeaturesPackageCommand(args);

    await dispose();
    process.exit(exitCode);
}
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
            'base-image': { type: 'string', alias: 'i', default: 'ubuntu:focal', description: 'Base Image' },
            'features': { type: 'array', alias: 'f', describe: 'Feature(s) to test as space-separated parameters. Omit to auto-detect all features in collection directory.  Cannot be combined with \'-s\'.', },
            'scenarios': { type: 'string', alias: 's', description: 'Path to scenario test directory (containing scenarios.json).  Cannot be combined with \'-f\'.' },
            'remote-user': { type: 'string', alias: 'u', default: 'root', describe: 'Remote user', },
            'collection-folder': { type: 'string', alias: 'c', default: '.', description: 'Path to folder containing \'src\' and \'test\' sub-folders.' },
            'log-level': { choices: ['info' as 'info', 'debug' as 'debug', 'trace' as 'trace'], default: 'info' as 'info', description: 'Log level.' },
            'quiet': { type: 'boolean', alias: 'q', default: false, description: 'Quiets output' },
        })
        .check(argv => {
            if (argv['scenarios'] && argv['features']) {
                throw new Error('Cannot combine --scenarios and --features');
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
    scenariosFolder: string | undefined;
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
    'collection-folder': collectionFolder,
    features,
    scenarios: scenariosFolder,
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
    const extensionPath = path.join(__dirname, '..', '..');
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
        scenariosFolder: scenariosFolder ? cliHost.path.resolve(scenariosFolder) : undefined,
        remoteUser,
        disposables
    };

    const exitCode = await doFeaturesTestCommand(args);

    await dispose();
    process.exit(exitCode);
}
// -- End: 'features test' command
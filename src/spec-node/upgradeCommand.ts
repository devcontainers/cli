import { Argv } from 'yargs';
import { UnpackArgv } from './devContainersSpecCLI';
import { dockerComposeCLIConfig } from './dockerCompose';
import { Log, LogLevel, mapLogLevel } from '../spec-utils/log';
import { createLog } from './devContainers';
import { getPackageConfig } from '../spec-utils/product';
import { DockerCLIParameters } from '../spec-shutdown/dockerUtils';
import path from 'path';
import { getCLIHost } from '../spec-common/cliHost';
import { loadNativeModule } from '../spec-common/commonUtils';
import { URI } from 'vscode-uri';
import { workspaceFromPath } from '../spec-utils/workspaces';
import { getDefaultDevContainerConfigPath, getDevContainerConfigPathIn, uriToFsPath } from '../spec-configuration/configurationCommonUtils';
import { readDevContainerConfigFile } from './configContainer';
import { ContainerError } from '../spec-common/errors';
import { getCacheFolder } from './utils';
import { getLockfilePath, writeLockfile } from '../spec-configuration/lockfile';
import { writeLocalFile } from '../spec-utils/pfs';
import { readFeaturesConfig } from './featureUtils';

export function featuresUpgradeOptions(y: Argv) {
	return y
		.options({
			'workspace-folder': { type: 'string', description: 'Workspace folder.', demandOption: true },
			'docker-path': { type: 'string', description: 'Path to docker executable.', default: 'docker' },
			'docker-compose-path': { type: 'string', description: 'Path to docker-compose executable.', default: 'docker-compose' },
			'config': { type: 'string', description: 'devcontainer.json path. The default is to use .devcontainer/devcontainer.json or, if that does not exist, .devcontainer.json in the workspace folder.' },
			'log-level': { choices: ['error' as 'error', 'info' as 'info', 'debug' as 'debug', 'trace' as 'trace'], default: 'info' as 'info', description: 'Log level.' },
		});
}

export type FeaturesUpgradeArgs = UnpackArgv<ReturnType<typeof featuresUpgradeOptions>>;

export function featuresUpgradeHandler(args: FeaturesUpgradeArgs) {
	(async () => await featuresUpgrade(args))().catch(console.error);
}

async function featuresUpgrade({
	'workspace-folder': workspaceFolderArg,
	'docker-path': dockerPath,
	config: configArg,
	'docker-compose-path': dockerComposePath,
	'log-level': inputLogLevel,
}: FeaturesUpgradeArgs) {
	const disposables: (() => Promise<unknown> | undefined)[] = [];
	const dispose = async () => {
		await Promise.all(disposables.map(d => d()));
	};
	let output: Log | undefined;
	try {
		const workspaceFolder = path.resolve(process.cwd(), workspaceFolderArg);
		const configFile = configArg ? URI.file(path.resolve(process.cwd(), configArg)) : undefined;
		const cliHost = await getCLIHost(workspaceFolder, loadNativeModule, true);
		const extensionPath = path.join(__dirname, '..', '..');
		const sessionStart = new Date();
		const pkg = getPackageConfig();
		const output = createLog({
			logLevel: mapLogLevel(inputLogLevel),
			logFormat: 'text',
			log: text => process.stderr.write(text),
			terminalDimensions: undefined,
		}, pkg, sessionStart, disposables);
		const dockerComposeCLI = dockerComposeCLIConfig({
			exec: cliHost.exec,
			env: cliHost.env,
			output,
		}, dockerPath, dockerComposePath);
		const dockerParams: DockerCLIParameters = {
			cliHost,
			dockerCLI: dockerPath,
			dockerComposeCLI,
			env: cliHost.env,
			output,
		};

		const workspace = workspaceFromPath(cliHost.path, workspaceFolder);
		const configPath = configFile ? configFile : await getDevContainerConfigPathIn(cliHost, workspace.configFolderPath);
		const configs = configPath && await readDevContainerConfigFile(cliHost, workspace, configPath, true, output) || undefined;
		if (!configs) {
			throw new ContainerError({ description: `Dev container config (${uriToFsPath(configFile || getDefaultDevContainerConfigPath(cliHost, workspace!.configFolderPath), cliHost.platform)}) not found.` });
		}
		const config = configs.config.config;
		const cacheFolder = await getCacheFolder(cliHost);
		const params = {
			extensionPath,
			cacheFolder,
			cwd: cliHost.cwd,
			output,
			env: cliHost.env,
			skipFeatureAutoMapping: false,
			platform: cliHost.platform,
		};

		const bold = process.stdout.isTTY ? '\x1b[1m' : '';
		const clear = process.stdout.isTTY ? '\x1b[0m' : '';
		output.raw(`${bold}Upgrading lockfile...\n${clear}\n`, LogLevel.Info);

		// Truncate existing lockfile
		const lockfilePath = getLockfilePath(config);
		await writeLocalFile(lockfilePath, '');
		// Update lockfile
		const featuresConfig = await readFeaturesConfig(dockerParams, pkg, config, extensionPath, false, {});
		if (!featuresConfig) {
			throw new ContainerError({ description: `Failed to update lockfile` });
		}
		await writeLockfile(params, config, featuresConfig, true);
	} catch (err) {
		if (output) {
			output.write(err && (err.stack || err.message) || String(err));
		} else {
			console.error(err);
		}
		await dispose();
		process.exit(1);
	}
	await dispose();
	process.exit(0);
}
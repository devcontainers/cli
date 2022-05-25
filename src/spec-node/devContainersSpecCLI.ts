/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';
import yargs, { Argv } from 'yargs';

import { createDockerParams, createLog, launch, ProvisionOptions } from './devContainers';
import { createContainerProperties, createFeaturesTempFolder, getPackageConfig, isDockerFileConfig } from './utils';
import { URI } from 'vscode-uri';
import { ContainerError } from '../spec-common/errors';
import { Log, LogLevel, makeLog, mapLogLevel } from '../spec-utils/log';
import { UnpackPromise } from '../spec-utils/types';
import { probeRemoteEnv, runPostCreateCommands, runRemoteCommand, UserEnvProbe } from '../spec-common/injectHeadless';
import { bailOut, buildNamedImageAndExtend, findDevContainer, hostFolderLabel } from './singleContainer';
import { extendImage } from './containerFeatures';
import { DockerCLIParameters, dockerPtyCLI, inspectContainer } from '../spec-shutdown/dockerUtils';
import { buildDockerCompose, getProjectName, readDockerComposeConfig } from './dockerCompose';
import { getDockerComposeFilePaths } from '../spec-configuration/configuration';
import { workspaceFromPath } from '../spec-utils/workspaces';
import { readDevContainerConfigFile } from './configContainer';
import { getDefaultDevContainerConfigPath, getDevContainerConfigPathIn, uriToFsPath } from '../spec-configuration/configurationCommonUtils';
import { getCLIHost } from '../spec-common/cliHost';
import { loadNativeModule } from '../spec-common/commonUtils';
import { generateFeaturesConfig, getContainerFeaturesFolder } from '../spec-configuration/containerFeaturesConfiguration';
import { doFeaturesTestCommand } from './testContainerFeatures';

const defaultDefaultUserEnvProbe: UserEnvProbe = 'loginInteractiveShell';

(async () => {

	const argv = process.argv.slice(2);
	const restArgs = argv[0] === 'exec' && argv[1] !== '--help'; // halt-at-non-option doesn't work in subcommands: https://github.com/yargs/yargs/issues/1417
	const y = yargs([])
		.parserConfiguration({
			// By default, yargs allows `--no-myoption` to set a boolean `--myoption` to false
			// Disable this to allow `--no-cache` on the `build` command to align with `docker build` syntax
			'boolean-negation': false,
			'halt-at-non-option': restArgs,
		})
		.scriptName('devcontainer')
		.version((await getPackageConfig(path.join(__dirname, '..', '..'))).version)
		.demandCommand()
		.strict();
	y.wrap(Math.min(120, y.terminalWidth()));
	y.command('up', 'Create and run dev container', provisionOptions, provisionHandler);
	y.command('build [path]', 'Build a dev container image', buildOptions, buildHandler);
	y.command('run-user-commands', 'Run user commands', runUserCommandsOptions, runUserCommandsHandler);
	y.command('read-configuration', 'Read configuration', readConfigurationOptions, readConfigurationHandler);
	y.command('features test [baseImage] [pathToCollection] <features..>', 'Test dev container features', featuresTestOptions, featuresTestHandler);
	y.command(restArgs ? ['exec', '*'] : ['exec <cmd> [args..]'], 'Execute a command on a running dev container', execOptions, execHandler);
	y.parse(restArgs ? argv.slice(1) : argv);

})().catch(console.error);

type UnpackArgv<T> = T extends Argv<infer U> ? U : T;

const mountRegex = /^type=(bind|volume),source=([^,]+),target=([^,]+)(?:,external=(true|false))?$/;

// -- 'features test' command
function featuresTestOptions(y: Argv) {
	return y.options({
		'base-image': { type: 'string', alias: 'b', default: 'mcr.microsoft.com/vscode/devcontainers/base:focal', description: 'Base Image' },
		'path-to-collection': { type: 'string', alias: 'c', default: '.', describe: 'Path to collections folder' },
		'features': { type: 'string', describe: 'Feature(s) IDs to test, comma separated.', }
	});
}

export type FeaturesTestArgs = UnpackArgv<ReturnType<typeof featuresTestOptions>>;

function featuresTestHandler({
	'base-image': baseImage,
	'path-to-collection': pathToCollection,
	features
}: FeaturesTestArgs) {
	if (!features) {
		process.stderr.write('Must supply comma separated list of features to test');
		process.exit(1);
	}
	(async () => await doFeaturesTestCommand(baseImage, pathToCollection, features)().catch(console.error));
}

// -- End: 'features test' command

function provisionOptions(y: Argv) {
	return y.options({
		'docker-path': { type: 'string', description: 'Docker CLI path.' },
		'docker-compose-path': { type: 'string', description: 'Docker Compose CLI path.' },
		'container-data-folder': { type: 'string', description: 'Container data folder where user data inside the container will be stored.' },
		'container-system-data-folder': { type: 'string', description: 'Container system data folder where system data inside the container will be stored.' },
		'workspace-folder': { type: 'string', description: 'Workspace folder path. The devcontainer.json will be looked up relative to this path.' },
		'workspace-mount-consistency': { choices: ['consistent' as 'consistent', 'cached' as 'cached', 'delegated' as 'delegated'], default: 'cached' as 'cached', description: 'Workspace mount consistency.' },
		'mount-workspace-git-root': { type: 'boolean', default: true, description: 'Mount the workspace using its Git root.' },
		'id-label': { type: 'string', description: 'Id label(s) of the format name=value. These will be set on the container and used to query for an existing container. If no --id-label is given, one will be inferred from the --workspace-folder path.' },
		'config': { type: 'string', description: 'devcontainer.json path. The default is to use .devcontainer/devcontainer.json or, if that does not exist, .devcontainer.json in the workspace folder.' },
		'override-config': { type: 'string', description: 'devcontainer.json path to override any devcontainer.json in the workspace folder (or built-in configuration). This is required when there is no devcontainer.json otherwise.' },
		'log-level': { choices: ['info' as 'info', 'debug' as 'debug', 'trace' as 'trace'], default: 'info' as 'info', description: 'Log level for the --terminal-log-file. When set to trace, the log level for --log-file will also be set to trace.' },
		'log-format': { choices: ['text' as 'text', 'json' as 'json'], default: 'text' as 'text', description: 'Log format.' },
		'terminal-columns': { type: 'number', implies: ['terminal-rows'], description: 'Number of rows to render the output for. This is required for some of the subprocesses to correctly render their output.' },
		'terminal-rows': { type: 'number', implies: ['terminal-columns'], description: 'Number of columns to render the output for. This is required for some of the subprocesses to correctly render their output.' },
		'default-user-env-probe': { choices: ['none' as 'none', 'loginInteractiveShell' as 'loginInteractiveShell', 'interactiveShell' as 'interactiveShell', 'loginShell' as 'loginShell'], default: defaultDefaultUserEnvProbe, description: 'Default value for the devcontainer.json\'s "userEnvProbe".' },
		'update-remote-user-uid-default': { choices: ['never' as 'never', 'on' as 'on', 'off' as 'off'], default: 'on' as 'on', description: 'Default for updating the remote user\'s UID and GID to the local user\'s one.' },
		'remove-existing-container': { type: 'boolean', default: false, description: 'Removes the dev container if it already exists.' },
		'build-no-cache': { type: 'boolean', default: false, description: 'Builds the image with `--no-cache` if the container does not exist.' },
		'expect-existing-container': { type: 'boolean', default: false, description: 'Fail if the container does not exist.' },
		'skip-post-create': { type: 'boolean', default: false, description: 'Do not run onCreateCommand, updateContentCommand, postCreateCommand, postStartCommand or postAttachCommand and do not install dotfiles.' },
		'skip-non-blocking-commands': { type: 'boolean', default: false, description: 'Stop running user commands after running the command configured with waitFor or the updateContentCommand by default.' },
		prebuild: { type: 'boolean', default: false, description: 'Stop after onCreateCommand and updateContentCommand, rerunning updateContentCommand if it has run before.' },
		'user-data-folder': { type: 'string', description: 'Host path to a directory that is intended to be persisted and share state between sessions.' },
		'mount': { type: 'string', description: 'Additional mount point(s). Format: type=<bind|volume>,source=<source>,target=<target>[,external=<true|false>]' },
		'remote-env': { type: 'string', description: 'Remote environment variables of the format name=value. These will be added when executing the user commands.' },
		'cache-from': { type: 'string', description: 'Additional image to use as potential layer cache during image building' },
		'buildkit': { choices: ['auto' as 'auto', 'never' as 'never'], default: 'auto' as 'auto', description: 'Control whether BuildKit should be used' },
	})
		.check(argv => {
			const idLabels = (argv['id-label'] && (Array.isArray(argv['id-label']) ? argv['id-label'] : [argv['id-label']])) as string[] | undefined;
			if (idLabels?.some(idLabel => !/.+=.+/.test(idLabel))) {
				throw new Error('Unmatched argument format: id-label must match <name>=<value>');
			}
			if (!(argv['workspace-folder'] || argv['id-label'])) {
				throw new Error('Missing required argument: workspace-folder or id-label');
			}
			if (!(argv['workspace-folder'] || argv['override-config'])) {
				throw new Error('Missing required argument: workspace-folder or override-config');
			}
			const mounts = (argv.mount && (Array.isArray(argv.mount) ? argv.mount : [argv.mount])) as string[] | undefined;
			if (mounts?.some(mount => !mountRegex.test(mount))) {
				throw new Error('Unmatched argument format: mount must match type=<bind|volume>,source=<source>,target=<target>[,external=<true|false>]');
			}
			const remoteEnvs = (argv['remote-env'] && (Array.isArray(argv['remote-env']) ? argv['remote-env'] : [argv['remote-env']])) as string[] | undefined;
			if (remoteEnvs?.some(remoteEnv => !/.+=.+/.test(remoteEnv))) {
				throw new Error('Unmatched argument format: remote-env must match <name>=<value>');
			}
			return true;
		});
}

type ProvisionArgs = UnpackArgv<ReturnType<typeof provisionOptions>>;

function provisionHandler(args: ProvisionArgs) {
	(async () => provision(args))().catch(console.error);
}

async function provision({
	'user-data-folder': persistedFolder,
	'docker-path': dockerPath,
	'docker-compose-path': dockerComposePath,
	'container-data-folder': containerDataFolder,
	'container-system-data-folder': containerSystemDataFolder,
	'workspace-folder': workspaceFolderArg,
	'workspace-mount-consistency': workspaceMountConsistency,
	'mount-workspace-git-root': mountWorkspaceGitRoot,
	'id-label': idLabel,
	config,
	'override-config': overrideConfig,
	'log-level': logLevel,
	'log-format': logFormat,
	'terminal-rows': terminalRows,
	'terminal-columns': terminalColumns,
	'default-user-env-probe': defaultUserEnvProbe,
	'update-remote-user-uid-default': updateRemoteUserUIDDefault,
	'remove-existing-container': removeExistingContainer,
	'build-no-cache': buildNoCache,
	'expect-existing-container': expectExistingContainer,
	'skip-post-create': skipPostCreate,
	'skip-non-blocking-commands': skipNonBlocking,
	prebuild,
	mount,
	'remote-env': addRemoteEnv,
	'cache-from': addCacheFrom,
	'buildkit': buildkit,
}: ProvisionArgs) {

	const workspaceFolder = workspaceFolderArg ? path.resolve(process.cwd(), workspaceFolderArg) : undefined;
	const addRemoteEnvs = addRemoteEnv ? (Array.isArray(addRemoteEnv) ? addRemoteEnv as string[] : [addRemoteEnv]) : [];
	const addCacheFroms = addCacheFrom ? (Array.isArray(addCacheFrom) ? addCacheFrom as string[] : [addCacheFrom]) : [];
	const options: ProvisionOptions = {
		dockerPath,
		dockerComposePath,
		containerDataFolder,
		containerSystemDataFolder,
		workspaceFolder,
		workspaceMountConsistency,
		mountWorkspaceGitRoot,
		idLabels: idLabel ? (Array.isArray(idLabel) ? idLabel as string[] : [idLabel]) : getDefaultIdLabels(workspaceFolder!),
		configFile: config ? URI.file(path.resolve(process.cwd(), config)) : undefined,
		overrideConfigFile: overrideConfig ? URI.file(path.resolve(process.cwd(), overrideConfig)) : undefined,
		logLevel: mapLogLevel(logLevel),
		logFormat,
		log: text => process.stderr.write(text),
		terminalDimensions: terminalColumns && terminalRows ? { columns: terminalColumns, rows: terminalRows } : undefined,
		defaultUserEnvProbe,
		removeExistingContainer,
		buildNoCache,
		expectExistingContainer,
		postCreateEnabled: !skipPostCreate,
		skipNonBlocking,
		prebuild,
		persistedFolder,
		additionalMounts: mount ? (Array.isArray(mount) ? mount : [mount]).map(mount => {
			const [, type, source, target, external] = mountRegex.exec(mount)!;
			return {
				type: type as 'bind' | 'volume',
				source,
				target,
				external: external === 'true'
			};
		}) : [],
		updateRemoteUserUIDDefault,
		remoteEnv: keyValuesToRecord(addRemoteEnvs),
		additionalCacheFroms: addCacheFroms,
		useBuildKit: buildkit,
	};

	const result = await doProvision(options);
	const exitCode = result.outcome === 'error' ? 1 : 0;
	console.log(JSON.stringify(result));
	if (result.outcome === 'success') {
		await result.finishBackgroundTasks();
	}
	await result.dispose();
	process.exit(exitCode);
}

async function doProvision(options: ProvisionOptions) {
	const disposables: (() => Promise<unknown> | undefined)[] = [];
	const dispose = async () => {
		await Promise.all(disposables.map(d => d()));
	};
	try {
		const result = await launch(options, disposables);
		return {
			outcome: 'success' as 'success',
			dispose,
			...result,
		};
	} catch (originalError) {
		const originalStack = originalError?.stack;
		const err = originalError instanceof ContainerError ? originalError : new ContainerError({
			description: 'An error occurred setting up the container.',
			originalError
		});
		if (originalStack) {
			console.error(originalStack);
		}
		return {
			outcome: 'error' as 'error',
			message: err.message,
			description: err.description,
			containerId: err.containerId,
			dispose,
		};
	}
}

export type Result = UnpackPromise<ReturnType<typeof doProvision>> & { backgroundProcessPID?: number };

function buildOptions(y: Argv) {
	return y.options({
		'user-data-folder': { type: 'string', description: 'Host path to a directory that is intended to be persisted and share state between sessions.' },
		'docker-path': { type: 'string', description: 'Docker CLI path.' },
		'docker-compose-path': { type: 'string', description: 'Docker Compose CLI path.' },
		'workspace-folder': { type: 'string', required: true, description: 'Workspace folder path. The devcontainer.json will be looked up relative to this path.' },
		'log-level': { choices: ['info' as 'info', 'debug' as 'debug', 'trace' as 'trace'], default: 'info' as 'info', description: 'Log level.' },
		'log-format': { choices: ['text' as 'text', 'json' as 'json'], default: 'text' as 'text', description: 'Log format.' },
		'no-cache': { type: 'boolean', default: false, description: 'Builds the image with `--no-cache`.' },
		'image-name': { type: 'string', description: 'Image name.' },
		'cache-from': { type: 'string', description: 'Additional image to use as potential layer cache' },
		'buildkit': { choices: ['auto' as 'auto', 'never' as 'never'], default: 'auto' as 'auto', description: 'Control whether BuildKit should be used' },
	});
}

type BuildArgs = UnpackArgv<ReturnType<typeof buildOptions>>;

function buildHandler(args: BuildArgs) {
	(async () => build(args))().catch(console.error);
}

async function build(args: BuildArgs) {
	const result = await doBuild(args);
	const exitCode = result.outcome === 'error' ? 1 : 0;
	console.log(JSON.stringify(result));
	await result.dispose();
	process.exit(exitCode);
}

async function doBuild({
	'user-data-folder': persistedFolder,
	'docker-path': dockerPath,
	'docker-compose-path': dockerComposePath,
	'workspace-folder': workspaceFolderArg,
	'log-level': logLevel,
	'log-format': logFormat,
	'no-cache': buildNoCache,
	'image-name': argImageName,
	'cache-from': addCacheFrom,
	'buildkit': buildkit,
}: BuildArgs) {
	const disposables: (() => Promise<unknown> | undefined)[] = [];
	const dispose = async () => {
		await Promise.all(disposables.map(d => d()));
	};
	try {
		const workspaceFolder = path.resolve(process.cwd(), workspaceFolderArg);
		const configFile: URI | undefined = /* config ? URI.file(path.resolve(process.cwd(), config)) : */ undefined; // TODO
		const overrideConfigFile: URI | undefined = /* overrideConfig ? URI.file(path.resolve(process.cwd(), overrideConfig)) : */ undefined;
		const addCacheFroms = addCacheFrom ? (Array.isArray(addCacheFrom) ? addCacheFrom as string[] : [addCacheFrom]) : [];
		const params = await createDockerParams({
			dockerPath,
			dockerComposePath,
			containerDataFolder: undefined,
			containerSystemDataFolder: undefined,
			workspaceFolder,
			mountWorkspaceGitRoot: false,
			idLabels: getDefaultIdLabels(workspaceFolder),
			configFile,
			overrideConfigFile,
			logLevel: mapLogLevel(logLevel),
			logFormat,
			log: text => process.stderr.write(text),
			terminalDimensions: /* terminalColumns && terminalRows ? { columns: terminalColumns, rows: terminalRows } : */ undefined, // TODO
			defaultUserEnvProbe: 'loginInteractiveShell',
			removeExistingContainer: false,
			buildNoCache,
			expectExistingContainer: false,
			postCreateEnabled: false,
			skipNonBlocking: false,
			prebuild: false,
			persistedFolder,
			additionalMounts: [],
			updateRemoteUserUIDDefault: 'never',
			remoteEnv: {},
			additionalCacheFroms: addCacheFroms,
			useBuildKit: buildkit
		}, disposables);

		const { common, dockerCLI, dockerComposeCLI } = params;
		const { cliHost, env, output } = common;
		const workspace = workspaceFromPath(cliHost.path, workspaceFolder);
		const configPath = configFile ? configFile : workspace
			? (await getDevContainerConfigPathIn(cliHost, workspace.configFolderPath)
				|| (overrideConfigFile ? getDefaultDevContainerConfigPath(cliHost, workspace.configFolderPath) : undefined))
			: overrideConfigFile;
		const configs = configPath && await readDevContainerConfigFile(cliHost, workspace, configPath, params.mountWorkspaceGitRoot, output, undefined, overrideConfigFile) || undefined;
		if (!configs) {
			throw new ContainerError({ description: `Dev container config (${uriToFsPath(configFile || getDefaultDevContainerConfigPath(cliHost, workspace!.configFolderPath), cliHost.platform)}) not found.` });
		}
		const { config } = configs;
		let imageNameResult = '';

		if (isDockerFileConfig(config)) {

			// Build the base image and extend with features etc.
			const { updatedImageName } = await buildNamedImageAndExtend(params, config);

			if (argImageName) {
				await dockerPtyCLI(params, 'tag', updatedImageName, argImageName);
				imageNameResult = argImageName;
			} else {
				imageNameResult = updatedImageName;
			}
		} else if ('dockerComposeFile' in config) {

			const cwdEnvFile = cliHost.path.join(cliHost.cwd, '.env');
			const envFile = Array.isArray(config.dockerComposeFile) && config.dockerComposeFile.length === 0 && await cliHost.isFile(cwdEnvFile) ? cwdEnvFile : undefined;
			const composeFiles = await getDockerComposeFilePaths(cliHost, config, cliHost.env, workspaceFolder);

			// If dockerComposeFile is an array, add -f <file> in order. https://docs.docker.com/compose/extends/#multiple-compose-files
			const composeGlobalArgs = ([] as string[]).concat(...composeFiles.map(composeFile => ['-f', composeFile]));
			if (envFile) {
				composeGlobalArgs.push('--env-file', envFile);
			}
			const projectName = await getProjectName(params, workspace, composeFiles);

			const buildParams: DockerCLIParameters = { cliHost, dockerCLI, dockerComposeCLI, env, output };

			const composeConfig = await readDockerComposeConfig(buildParams, composeFiles, envFile);
			const services = Object.keys(composeConfig.services || {});
			if (services.indexOf(config.service) === -1) {
				throw new Error(`Service '${config.service}' configured in devcontainer.json not found in Docker Compose configuration.`);
			}

			await buildDockerCompose(config, projectName, buildParams, composeFiles, composeGlobalArgs, [config.service], params.buildNoCache || false, undefined, addCacheFroms);

			const service = composeConfig.services[config.service];
			const originalImageName = service.image || `${projectName}_${config.service}`;
			const { updatedImageName } = await extendImage(params, config, originalImageName, !service.build);

			if (argImageName) {
				await dockerPtyCLI(params, 'tag', updatedImageName, argImageName);
				imageNameResult = argImageName;
			} else {
				imageNameResult = updatedImageName;
			}
		} else {

			await dockerPtyCLI(params, 'pull', config.image);
			const { updatedImageName } = await extendImage(params, config, config.image, 'image' in config);

			if (argImageName) {
				await dockerPtyCLI(params, 'tag', updatedImageName, argImageName);
				imageNameResult = argImageName;
			} else {
				imageNameResult = updatedImageName;
			}
		}

		return {
			outcome: 'success' as 'success',
			imageName: imageNameResult,
			dispose,
		};
	} catch (originalError) {
		const originalStack = originalError?.stack;
		const err = originalError instanceof ContainerError ? originalError : new ContainerError({
			description: 'An error occurred building the container.',
			originalError
		});
		if (originalStack) {
			console.error(originalStack);
		}
		return {
			outcome: 'error' as 'error',
			message: err.message,
			description: err.description,
			dispose,
		};
	}
}

function runUserCommandsOptions(y: Argv) {
	return y.options({
		'user-data-folder': { type: 'string', description: 'Host path to a directory that is intended to be persisted and share state between sessions.' },
		'docker-path': { type: 'string', description: 'Docker CLI path.' },
		'docker-compose-path': { type: 'string', description: 'Docker Compose CLI path.' },
		'container-data-folder': { type: 'string', description: 'Container data folder where user data inside the container will be stored.' },
		'container-system-data-folder': { type: 'string', description: 'Container system data folder where system data inside the container will be stored.' },
		'workspace-folder': { type: 'string', required: true, description: 'Workspace folder path. The devcontainer.json will be looked up relative to this path.' },
		'mount-workspace-git-root': { type: 'boolean', default: true, description: 'Mount the workspace using its Git root.' },
		'container-id': { type: 'string', description: 'Id of the container to run the user commands for.' },
		'id-label': { type: 'string', description: 'Id label(s) of the format name=value. If no --container-id is given the id labels will be used to look up the container. If no --id-label is given, one will be inferred from the --workspace-folder path.' },
		'config': { type: 'string', description: 'devcontainer.json path. The default is to use .devcontainer/devcontainer.json or, if that does not exist, .devcontainer.json in the workspace folder.' },
		'override-config': { type: 'string', description: 'devcontainer.json path to override any devcontainer.json in the workspace folder (or built-in configuration). This is required when there is no devcontainer.json otherwise.' },
		'log-level': { choices: ['info' as 'info', 'debug' as 'debug', 'trace' as 'trace'], default: 'info' as 'info', description: 'Log level for the --terminal-log-file. When set to trace, the log level for --log-file will also be set to trace.' },
		'log-format': { choices: ['text' as 'text', 'json' as 'json'], default: 'text' as 'text', description: 'Log format.' },
		'terminal-columns': { type: 'number', implies: ['terminal-rows'], description: 'Number of rows to render the output for. This is required for some of the subprocesses to correctly render their output.' },
		'terminal-rows': { type: 'number', implies: ['terminal-columns'], description: 'Number of columns to render the output for. This is required for some of the subprocesses to correctly render their output.' },
		'default-user-env-probe': { choices: ['none' as 'none', 'loginInteractiveShell' as 'loginInteractiveShell', 'interactiveShell' as 'interactiveShell', 'loginShell' as 'loginShell'], default: defaultDefaultUserEnvProbe, description: 'Default value for the devcontainer.json\'s "userEnvProbe".' },
		'skip-non-blocking-commands': { type: 'boolean', default: false, description: 'Stop running user commands after running the command configured with waitFor or the updateContentCommand by default.' },
		prebuild: { type: 'boolean', default: false, description: 'Stop after onCreateCommand and updateContentCommand, rerunning updateContentCommand if it has run before.' },
		'stop-for-personalization': { type: 'boolean', default: false, description: 'Stop for personalization.' },
		'remote-env': { type: 'string', description: 'Remote environment variables of the format name=value. These will be added when executing the user commands.' },
	})
		.check(argv => {
			const idLabels = (argv['id-label'] && (Array.isArray(argv['id-label']) ? argv['id-label'] : [argv['id-label']])) as string[] | undefined;
			if (idLabels?.some(idLabel => !/.+=.+/.test(idLabel))) {
				throw new Error('Unmatched argument format: id-label must match <name>=<value>');
			}
			const remoteEnvs = (argv['remote-env'] && (Array.isArray(argv['remote-env']) ? argv['remote-env'] : [argv['remote-env']])) as string[] | undefined;
			if (remoteEnvs?.some(remoteEnv => !/.+=.+/.test(remoteEnv))) {
				throw new Error('Unmatched argument format: remote-env must match <name>=<value>');
			}
			return true;
		});
}

type RunUserCommandsArgs = UnpackArgv<ReturnType<typeof runUserCommandsOptions>>;

function runUserCommandsHandler(args: RunUserCommandsArgs) {
	(async () => runUserCommands(args))().catch(console.error);
}
async function runUserCommands(args: RunUserCommandsArgs) {
	const result = await doRunUserCommands(args);
	const exitCode = result.outcome === 'error' ? 1 : 0;
	console.log(JSON.stringify(result));
	await result.dispose();
	process.exit(exitCode);
}

async function doRunUserCommands({
	'user-data-folder': persistedFolder,
	'docker-path': dockerPath,
	'docker-compose-path': dockerComposePath,
	'container-data-folder': containerDataFolder,
	'container-system-data-folder': containerSystemDataFolder,
	'workspace-folder': workspaceFolderArg,
	'mount-workspace-git-root': mountWorkspaceGitRoot,
	'container-id': containerId,
	'id-label': idLabel,
	config: configParam,
	'override-config': overrideConfig,
	'log-level': logLevel,
	'log-format': logFormat,
	'terminal-rows': terminalRows,
	'terminal-columns': terminalColumns,
	'default-user-env-probe': defaultUserEnvProbe,
	'skip-non-blocking-commands': skipNonBlocking,
	prebuild,
	'stop-for-personalization': stopForPersonalization,
	'remote-env': addRemoteEnv,
}: RunUserCommandsArgs) {
	const disposables: (() => Promise<unknown> | undefined)[] = [];
	const dispose = async () => {
		await Promise.all(disposables.map(d => d()));
	};
	try {
		const workspaceFolder = path.resolve(process.cwd(), workspaceFolderArg);
		const idLabels = idLabel ? (Array.isArray(idLabel) ? idLabel as string[] : [idLabel]) : getDefaultIdLabels(workspaceFolder);
		const addRemoteEnvs = addRemoteEnv ? (Array.isArray(addRemoteEnv) ? addRemoteEnv as string[] : [addRemoteEnv]) : [];
		const configFile = configParam ? URI.file(path.resolve(process.cwd(), configParam)) : undefined;
		const overrideConfigFile = overrideConfig ? URI.file(path.resolve(process.cwd(), overrideConfig)) : undefined;
		const params = await createDockerParams({
			dockerPath,
			dockerComposePath,
			containerDataFolder,
			containerSystemDataFolder,
			workspaceFolder,
			mountWorkspaceGitRoot,
			idLabels,
			configFile,
			overrideConfigFile,
			logLevel: mapLogLevel(logLevel),
			logFormat,
			log: text => process.stderr.write(text),
			terminalDimensions: terminalColumns && terminalRows ? { columns: terminalColumns, rows: terminalRows } : undefined,
			defaultUserEnvProbe,
			removeExistingContainer: false,
			buildNoCache: false,
			expectExistingContainer: false,
			postCreateEnabled: true,
			skipNonBlocking,
			prebuild,
			persistedFolder,
			additionalMounts: [],
			updateRemoteUserUIDDefault: 'never',
			remoteEnv: keyValuesToRecord(addRemoteEnvs),
			additionalCacheFroms: [],
			useBuildKit: 'auto'
		}, disposables);

		const { common } = params;
		const { cliHost, output } = common;
		const workspace = workspaceFromPath(cliHost.path, workspaceFolder);
		const configPath = configFile ? configFile : workspace
			? (await getDevContainerConfigPathIn(cliHost, workspace.configFolderPath)
				|| (overrideConfigFile ? getDefaultDevContainerConfigPath(cliHost, workspace.configFolderPath) : undefined))
			: overrideConfigFile;
		const configs = configPath && await readDevContainerConfigFile(cliHost, workspace, configPath, params.mountWorkspaceGitRoot, output, undefined, overrideConfigFile) || undefined;
		if (!configs) {
			throw new ContainerError({ description: `Dev container config (${uriToFsPath(configFile || getDefaultDevContainerConfigPath(cliHost, workspace!.configFolderPath), cliHost.platform)}) not found.` });
		}
		const { config, workspaceConfig } = configs;

		const container = containerId ? await inspectContainer(params, containerId) : await findDevContainer(params, idLabels);
		if (!container) {
			bailOut(common.output, 'Dev container not found.');
		}
		const containerProperties = await createContainerProperties(params, container.Id, workspaceConfig.workspaceFolder, config.remoteUser);
		const remoteEnv = probeRemoteEnv(common, containerProperties, config);
		const result = await runPostCreateCommands(common, containerProperties, config, remoteEnv, stopForPersonalization);
		return {
			outcome: 'success' as 'success',
			result,
			dispose,
		};
	} catch (originalError) {
		const originalStack = originalError?.stack;
		const err = originalError instanceof ContainerError ? originalError : new ContainerError({
			description: 'An error occurred running user commands in the container.',
			originalError
		});
		if (originalStack) {
			console.error(originalStack);
		}
		return {
			outcome: 'error' as 'error',
			message: err.message,
			description: err.description,
			dispose,
		};
	}
}


function readConfigurationOptions(y: Argv) {
	return y.options({
		'user-data-folder': { type: 'string', description: 'Host path to a directory that is intended to be persisted and share state between sessions.' },
		'workspace-folder': { type: 'string', required: true, description: 'Workspace folder path. The devcontainer.json will be looked up relative to this path.' },
		'mount-workspace-git-root': { type: 'boolean', default: true, description: 'Mount the workspace using its Git root.' },
		'config': { type: 'string', description: 'devcontainer.json path. The default is to use .devcontainer/devcontainer.json or, if that does not exist, .devcontainer.json in the workspace folder.' },
		'override-config': { type: 'string', description: 'devcontainer.json path to override any devcontainer.json in the workspace folder (or built-in configuration). This is required when there is no devcontainer.json otherwise.' },
		'log-level': { choices: ['info' as 'info', 'debug' as 'debug', 'trace' as 'trace'], default: 'info' as 'info', description: 'Log level for the --terminal-log-file. When set to trace, the log level for --log-file will also be set to trace.' },
		'log-format': { choices: ['text' as 'text', 'json' as 'json'], default: 'text' as 'text', description: 'Log format.' },
		'terminal-columns': { type: 'number', implies: ['terminal-rows'], description: 'Number of rows to render the output for. This is required for some of the subprocesses to correctly render their output.' },
		'terminal-rows': { type: 'number', implies: ['terminal-columns'], description: 'Number of columns to render the output for. This is required for some of the subprocesses to correctly render their output.' },
		'include-features-configuration': { type: 'boolean', default: false, description: 'Include features configuration.' },
	});
}

type ReadConfigurationArgs = UnpackArgv<ReturnType<typeof readConfigurationOptions>>;

function readConfigurationHandler(args: ReadConfigurationArgs) {
	(async () => readConfiguration(args))().catch(console.error);
}

async function readConfiguration({
	// 'user-data-folder': persistedFolder,
	'workspace-folder': workspaceFolderArg,
	'mount-workspace-git-root': mountWorkspaceGitRoot,
	config: configParam,
	'override-config': overrideConfig,
	'log-level': logLevel,
	'log-format': logFormat,
	'terminal-rows': terminalRows,
	'terminal-columns': terminalColumns,
	'include-features-configuration': includeFeaturesConfig,
}: ReadConfigurationArgs) {
	const disposables: (() => Promise<unknown> | undefined)[] = [];
	const dispose = async () => {
		await Promise.all(disposables.map(d => d()));
	};
	let output: Log | undefined;
	try {
		const workspaceFolder = path.resolve(process.cwd(), workspaceFolderArg);
		const configFile = configParam ? URI.file(path.resolve(process.cwd(), configParam)) : undefined;
		const overrideConfigFile = overrideConfig ? URI.file(path.resolve(process.cwd(), overrideConfig)) : undefined;
		const cwd = workspaceFolder || process.cwd();
		const cliHost = await getCLIHost(cwd, loadNativeModule);
		const extensionPath = path.join(__dirname, '..', '..');
		const sessionStart = new Date();
		const pkg = await getPackageConfig(extensionPath);
		output = createLog({
			logLevel: mapLogLevel(logLevel),
			logFormat,
			log: text => process.stderr.write(text),
			terminalDimensions: terminalColumns && terminalRows ? { columns: terminalColumns, rows: terminalRows } : undefined,
		}, pkg, sessionStart, disposables);

		const workspace = workspaceFromPath(cliHost.path, workspaceFolder);
		const configPath = configFile ? configFile : workspace
			? (await getDevContainerConfigPathIn(cliHost, workspace.configFolderPath)
				|| (overrideConfigFile ? getDefaultDevContainerConfigPath(cliHost, workspace.configFolderPath) : undefined))
			: overrideConfigFile;
		const configs = configPath && await readDevContainerConfigFile(cliHost, workspace, configPath, mountWorkspaceGitRoot, output, undefined, overrideConfigFile) || undefined;
		if (!configs) {
			throw new ContainerError({ description: `Dev container config (${uriToFsPath(configFile || getDefaultDevContainerConfigPath(cliHost, workspace!.configFolderPath), cliHost.platform)}) not found.` });
		}
		const featuresConfiguration = includeFeaturesConfig ? await generateFeaturesConfig({ extensionPath, cwd: process.cwd(), output, env: cliHost.env }, (await createFeaturesTempFolder({ cliHost, package: pkg })), configs.config, async () => /* TODO: ? (await imageDetails()).Config.Labels || */({}), getContainerFeaturesFolder) : undefined;
		await new Promise<void>((resolve, reject) => {
			process.stdout.write(JSON.stringify({
				configuration: configs.config,
				workspace: configs.workspaceConfig,
				featuresConfiguration,
			}) + '\n', err => err ? reject(err) : resolve());
		});
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

function execOptions(y: Argv) {
	return y.options({
		'user-data-folder': { type: 'string', description: 'Host path to a directory that is intended to be persisted and share state between sessions.' },
		'docker-path': { type: 'string', description: 'Docker CLI path.' },
		'docker-compose-path': { type: 'string', description: 'Docker Compose CLI path.' },
		'container-data-folder': { type: 'string', description: 'Container data folder where user data inside the container will be stored.' },
		'container-system-data-folder': { type: 'string', description: 'Container system data folder where system data inside the container will be stored.' },
		'workspace-folder': { type: 'string', required: true, description: 'Workspace folder path. The devcontainer.json will be looked up relative to this path.' },
		'mount-workspace-git-root': { type: 'boolean', default: true, description: 'Mount the workspace using its Git root.' },
		'container-id': { type: 'string', description: 'Id of the container to run the user commands for.' },
		'id-label': { type: 'string', description: 'Id label(s) of the format name=value. If no --container-id is given the id labels will be used to look up the container. If no --id-label is given, one will be inferred from the --workspace-folder path.' },
		'config': { type: 'string', description: 'devcontainer.json path. The default is to use .devcontainer/devcontainer.json or, if that does not exist, .devcontainer.json in the workspace folder.' },
		'override-config': { type: 'string', description: 'devcontainer.json path to override any devcontainer.json in the workspace folder (or built-in configuration). This is required when there is no devcontainer.json otherwise.' },
		'log-level': { choices: ['info' as 'info', 'debug' as 'debug', 'trace' as 'trace'], default: 'info' as 'info', description: 'Log level for the --terminal-log-file. When set to trace, the log level for --log-file will also be set to trace.' },
		'log-format': { choices: ['text' as 'text', 'json' as 'json'], default: 'text' as 'text', description: 'Log format.' },
		'terminal-columns': { type: 'number', implies: ['terminal-rows'], description: 'Number of rows to render the output for. This is required for some of the subprocesses to correctly render their output.' },
		'terminal-rows': { type: 'number', implies: ['terminal-columns'], description: 'Number of columns to render the output for. This is required for some of the subprocesses to correctly render their output.' },
		'default-user-env-probe': { choices: ['none' as 'none', 'loginInteractiveShell' as 'loginInteractiveShell', 'interactiveShell' as 'interactiveShell', 'loginShell' as 'loginShell'], default: defaultDefaultUserEnvProbe, description: 'Default value for the devcontainer.json\'s "userEnvProbe".' },
		'remote-env': { type: 'string', description: 'Remote environment variables of the format name=value. These will be added when executing the user commands.' },
	})
		.positional('cmd', {
			type: 'string',
			description: 'Command to execute.',
			demandOption: true,
		}).positional('args', {
			type: 'string',
			array: true,
			description: 'Arguments to the command.',
			demandOption: true,
		})
		.check(argv => {
			const idLabels = (argv['id-label'] && (Array.isArray(argv['id-label']) ? argv['id-label'] : [argv['id-label']])) as string[] | undefined;
			if (idLabels?.some(idLabel => !/.+=.+/.test(idLabel))) {
				throw new Error('Unmatched argument format: id-label must match <name>=<value>');
			}
			const remoteEnvs = (argv['remote-env'] && (Array.isArray(argv['remote-env']) ? argv['remote-env'] : [argv['remote-env']])) as string[] | undefined;
			if (remoteEnvs?.some(remoteEnv => !/.+=.+/.test(remoteEnv))) {
				throw new Error('Unmatched argument format: remote-env must match <name>=<value>');
			}
			return true;
		});
}

type ExecArgs = UnpackArgv<ReturnType<typeof execOptions>>;

function execHandler(args: ExecArgs) {
	(async () => exec(args))().catch(console.error);
}

async function exec(args: ExecArgs) {
	const result = await doExec(args);
	const exitCode = result.outcome === 'error' ? 1 : 0;
	console.log(JSON.stringify(result));
	await result.dispose();
	process.exit(exitCode);
}

async function doExec({
	'user-data-folder': persistedFolder,
	'docker-path': dockerPath,
	'docker-compose-path': dockerComposePath,
	'container-data-folder': containerDataFolder,
	'container-system-data-folder': containerSystemDataFolder,
	'workspace-folder': workspaceFolderArg,
	'mount-workspace-git-root': mountWorkspaceGitRoot,
	'container-id': containerId,
	'id-label': idLabel,
	config: configParam,
	'override-config': overrideConfig,
	'log-level': logLevel,
	'log-format': logFormat,
	'terminal-rows': terminalRows,
	'terminal-columns': terminalColumns,
	'default-user-env-probe': defaultUserEnvProbe,
	'remote-env': addRemoteEnv,
	_: restArgs,
}: ExecArgs & { _?: string[] }) {
	const disposables: (() => Promise<unknown> | undefined)[] = [];
	const dispose = async () => {
		await Promise.all(disposables.map(d => d()));
	};
	try {
		const workspaceFolder = path.resolve(process.cwd(), workspaceFolderArg);
		const idLabels = idLabel ? (Array.isArray(idLabel) ? idLabel as string[] : [idLabel]) : getDefaultIdLabels(workspaceFolder);
		const addRemoteEnvs = addRemoteEnv ? (Array.isArray(addRemoteEnv) ? addRemoteEnv as string[] : [addRemoteEnv]) : [];
		const configFile = configParam ? URI.file(path.resolve(process.cwd(), configParam)) : undefined;
		const overrideConfigFile = overrideConfig ? URI.file(path.resolve(process.cwd(), overrideConfig)) : undefined;
		const params = await createDockerParams({
			dockerPath,
			dockerComposePath,
			containerDataFolder,
			containerSystemDataFolder,
			workspaceFolder,
			mountWorkspaceGitRoot,
			idLabels,
			configFile,
			overrideConfigFile,
			logLevel: mapLogLevel(logLevel),
			logFormat,
			log: text => process.stderr.write(text),
			terminalDimensions: terminalColumns && terminalRows ? { columns: terminalColumns, rows: terminalRows } : undefined,
			defaultUserEnvProbe,
			removeExistingContainer: false,
			buildNoCache: false,
			expectExistingContainer: false,
			postCreateEnabled: true,
			skipNonBlocking: false,
			prebuild: false,
			persistedFolder,
			additionalMounts: [],
			updateRemoteUserUIDDefault: 'never',
			remoteEnv: keyValuesToRecord(addRemoteEnvs),
			additionalCacheFroms: [],
			useBuildKit: 'auto'
		}, disposables);

		const { common } = params;
		const { cliHost, output } = common;
		const workspace = workspaceFromPath(cliHost.path, workspaceFolder);
		const configPath = configFile ? configFile : workspace
			? (await getDevContainerConfigPathIn(cliHost, workspace.configFolderPath)
				|| (overrideConfigFile ? getDefaultDevContainerConfigPath(cliHost, workspace.configFolderPath) : undefined))
			: overrideConfigFile;
		const configs = configPath && await readDevContainerConfigFile(cliHost, workspace, configPath, params.mountWorkspaceGitRoot, output, undefined, overrideConfigFile) || undefined;
		if (!configs) {
			throw new ContainerError({ description: `Dev container config (${uriToFsPath(configFile || getDefaultDevContainerConfigPath(cliHost, workspace!.configFolderPath), cliHost.platform)}) not found.` });
		}
		const { config, workspaceConfig } = configs;

		const container = containerId ? await inspectContainer(params, containerId) : await findDevContainer(params, idLabels);
		if (!container) {
			bailOut(common.output, 'Dev container not found.');
		}
		const containerProperties = await createContainerProperties(params, container.Id, workspaceConfig.workspaceFolder, config.remoteUser);
		const remoteEnv = probeRemoteEnv(common, containerProperties, config);
		const remoteCwd = containerProperties.remoteWorkspaceFolder || containerProperties.homeFolder;
		const infoOutput = makeLog(output, LogLevel.Info);
		await runRemoteCommand({ ...common, output: infoOutput }, containerProperties, restArgs || [], remoteCwd, { remoteEnv: await remoteEnv, print: 'continuous' });

		return {
			outcome: 'success' as 'success',
			dispose,
		};

	} catch (originalError) {
		const originalStack = originalError?.stack;
		const err = originalError instanceof ContainerError ? originalError : new ContainerError({
			description: 'An error occurred running a command in the container.',
			originalError
		});
		if (originalStack) {
			console.error(originalStack);
		}
		return {
			outcome: 'error' as 'error',
			message: err.message,
			description: err.description,
			containerId: err.containerId,
			dispose,
		};
	}
}

function keyValuesToRecord(keyValues: string[]): Record<string, string> {
	return keyValues.reduce((envs, env) => {
		const i = env.indexOf('=');
		if (i !== -1) {
			envs[env.substring(0, i)] = env.substring(i + 1);
		}
		return envs;
	}, {} as Record<string, string>);
}

function getDefaultIdLabels(workspaceFolder: string) {
	return [`${hostFolderLabel}=${workspaceFolder}`];
}
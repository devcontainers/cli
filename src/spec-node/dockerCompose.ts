/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as yaml from 'js-yaml';
import * as shellQuote from 'shell-quote';

import { createContainerProperties, startEventSeen, ResolverResult, getTunnelInformation, DockerResolverParameters } from './utils';
import { ContainerProperties, setupInContainer, ResolverProgress } from '../spec-common/injectHeadless';
import { ContainerError } from '../spec-common/errors';
import { Workspace } from '../spec-utils/workspaces';
import { equalPaths, parseVersion, isEarlierVersion } from '../spec-common/commonUtils';
import { ContainerDetails, inspectContainer, listContainers, DockerCLIParameters, dockerCLI, dockerComposeCLI, dockerComposePtyCLI, PartialExecParameters, DockerComposeCLI, ImageDetails } from '../spec-shutdown/dockerUtils';
import { DevContainerFromDockerComposeConfig, getDockerComposeFilePaths } from '../spec-configuration/configuration';
import { LogLevel, makeLog, terminalEscapeSequences } from '../spec-utils/log';
import { extendImage, updateRemoteUserUID } from './containerFeatures';
import { Mount, CollapsedFeaturesConfig } from '../spec-configuration/containerFeaturesConfiguration';
import { includeAllConfiguredFeatures } from '../spec-utils/product';

const projectLabel = 'com.docker.compose.project';
const serviceLabel = 'com.docker.compose.service';

export async function openDockerComposeDevContainer(params: DockerResolverParameters, workspace: Workspace, config: DevContainerFromDockerComposeConfig, idLabels: string[]): Promise<ResolverResult> {
	const { common, dockerCLI, dockerComposeCLI } = params;
	const { cliHost, env, output } = common;
	const buildParams: DockerCLIParameters = { cliHost, dockerCLI, dockerComposeCLI, env, output };
	return _openDockerComposeDevContainer(params, buildParams, workspace, config, getRemoteWorkspaceFolder(config), idLabels);
}

async function _openDockerComposeDevContainer(params: DockerResolverParameters, buildParams: DockerCLIParameters, workspace: Workspace, config: DevContainerFromDockerComposeConfig, remoteWorkspaceFolder: string, idLabels: string[]): Promise<ResolverResult> {
	const { common } = params;
	const { cliHost: buildCLIHost } = buildParams;

	let container: ContainerDetails | undefined;
	let containerProperties: ContainerProperties | undefined;
	try {

		const composeFiles = await getDockerComposeFilePaths(buildCLIHost, config, buildCLIHost.env, buildCLIHost.cwd);
		const cwdEnvFile = buildCLIHost.path.join(buildCLIHost.cwd, '.env');
		const envFile = Array.isArray(config.dockerComposeFile) && config.dockerComposeFile.length === 0 && await buildCLIHost.isFile(cwdEnvFile) ? cwdEnvFile : undefined;
		const projectName = await getProjectName(buildParams, workspace, composeFiles);
		const containerId = await findComposeContainer(params, projectName, config.service);
		if (params.expectExistingContainer && !containerId) {
			throw new ContainerError({ description: 'The expected container does not exist.' });
		}
		container = containerId ? await inspectContainer(params, containerId) : undefined;

		if (container && (params.removeOnStartup === true || params.removeOnStartup === container.Id)) {
			const text = 'Removing existing container.';
			const start = common.output.start(text);
			await dockerCLI(params, 'rm', '-f', container.Id);
			common.output.stop(text, start);
			container = undefined;
		}

		// let collapsedFeaturesConfig: CollapsedFeaturesConfig | undefined;
		if (!container || container.State.Status !== 'running') {
			const res = await startContainer(params, buildParams, config, projectName, composeFiles, envFile, container, idLabels);
			container = await inspectContainer(params, res.containerId);
			// 	collapsedFeaturesConfig = res.collapsedFeaturesConfig;
			// } else {
			// 	const labels = container.Config.Labels || {};
			// 	const featuresConfig = await generateFeaturesConfig(params.common, (await createFeaturesTempFolder(params.common)), config, async () => labels, getContainerFeaturesFolder);
			// 	collapsedFeaturesConfig = collapseFeaturesConfig(featuresConfig);
		}

		containerProperties = await createContainerProperties(params, container.Id, remoteWorkspaceFolder, config.remoteUser);

		const {
			remoteEnv: extensionHostEnv,
		} = await setupInContainer(common, containerProperties, config);

		return {
			params: common,
			properties: containerProperties,
			config,
			resolvedAuthority: {
				extensionHostEnv,
			},
			tunnelInformation: common.isLocalContainer ? getTunnelInformation(container) : {},
			dockerParams: params,
			dockerContainerId: container.Id,
			composeProjectName: projectName,
		};

	} catch (originalError) {
		const err = originalError instanceof ContainerError ? originalError : new ContainerError({
			description: 'An error occurred setting up the container.',
			originalError
		});
		if (container) {
			err.manageContainer = true;
			err.params = params.common;
			err.containerId = container.Id;
			err.dockerParams = params;
		}
		if (containerProperties) {
			err.containerProperties = containerProperties;
		}
		err.config = config;
		throw err;
	}
}

export function getRemoteWorkspaceFolder(config: DevContainerFromDockerComposeConfig) {
	return config.workspaceFolder || '/';
}

export async function buildDockerCompose(config: DevContainerFromDockerComposeConfig, projectName: string, buildParams: DockerCLIParameters, localComposeFiles: string[], composeGlobalArgs: string[], runServices: string[], noCache: boolean, imageNameOverride?: string, additionalCacheFroms?: string[]) {
	const { cliHost } = buildParams;
	const args = ['--project-name', projectName, ...composeGlobalArgs];
	if (imageNameOverride || (additionalCacheFroms && additionalCacheFroms.length > 0)) {
		const composeOverrideFile = cliHost.path.join(await cliHost.tmpdir(), `docker-compose.devcontainer.build-${Date.now()}.yml`);
		const imageNameOverrideContent = imageNameOverride ? `    image: ${imageNameOverride}` : '';
		const cacheFromOverrideContent = (additionalCacheFroms && additionalCacheFroms.length > 0) ? `    cache_from: ${additionalCacheFroms.forEach(cacheFrom => `      - ${cacheFrom}`)}` : '';
		const composeOverrideContent = `services:
  ${config.service}:
${imageNameOverrideContent}
${cacheFromOverrideContent}
`;
		await cliHost.writeFile(composeOverrideFile, Buffer.from(composeOverrideContent));
		args.push('-f', composeOverrideFile);
	}
	args.push('build');
	if (noCache) {
		args.push('--no-cache', '--pull');
	}
	if (runServices.length) {
		args.push(...runServices);
		if (runServices.indexOf(config.service) === -1) {
			args.push(config.service);
		}
	}
	try {
		await dockerComposePtyCLI(buildParams, ...args);
	} catch (err) {
		throw err instanceof ContainerError ? err : new ContainerError({ description: 'An error occurred building the Docker Compose images.', originalError: err, data: { fileWithError: localComposeFiles[0] } });
	}
}

async function startContainer(params: DockerResolverParameters, buildParams: DockerCLIParameters, config: DevContainerFromDockerComposeConfig, projectName: string, composeFiles: string[], envFile: string | undefined, container: ContainerDetails | undefined, idLabels: string[]) {
	const { common } = params;
	const { persistedFolder, output } = common;
	const { cliHost: buildCLIHost } = buildParams;
	const overrideFilePrefix = 'docker-compose.devcontainer.containerFeatures';

	const build = !container;
	common.progress(ResolverProgress.StartingContainer);

	const localComposeFiles = composeFiles;
	// If dockerComposeFile is an array, add -f <file> in order. https://docs.docker.com/compose/extends/#multiple-compose-files
	const composeGlobalArgs = ([] as string[]).concat(...localComposeFiles.map(composeFile => ['-f', composeFile]));
	if (envFile) {
		composeGlobalArgs.push('--env-file', envFile);
	}

	const infoOutput = makeLog(buildParams.output, LogLevel.Info);
	const composeConfig = await readDockerComposeConfig({ ...buildParams, output: infoOutput }, localComposeFiles, envFile);
	const services = Object.keys(composeConfig.services || {});
	if (services.indexOf(config.service) === -1) {
		throw new ContainerError({ description: `Service '${config.service}' configured in devcontainer.json not found in Docker Compose configuration.`, data: { fileWithError: composeFiles[0] } });
	}

	let cancel: () => void;
	const canceled = new Promise<void>((_, reject) => cancel = reject);
	const { started } = await startEventSeen(params, { [projectLabel]: projectName, [serviceLabel]: config.service }, canceled, common.output, common.getLogLevel() === LogLevel.Trace); // await getEvents, but only assign started.

	if (build) {
		await buildDockerCompose(config, projectName, { ...buildParams, output: infoOutput }, localComposeFiles, composeGlobalArgs, config.runServices ?? [], params.buildNoCache ?? false, undefined, params.additionalCacheFroms);
	}

	const service = composeConfig.services[config.service];
	const originalImageName = service.image || `${projectName}_${config.service}`;

	// Try to restore the 'third' docker-compose file and featuresConfig from persisted storage.
	// This file may have been generated upon a Codespace creation.
	let didRestoreFromPersistedShare = false;
	const labels = container?.Config?.Labels;
	output.write(`PersistedPath=${persistedFolder}, ContainerHasLabels=${!!labels}`);

	if (persistedFolder && labels) {
		const configFiles = labels['com.docker.compose.project.config_files'];
		output.write(`Container was created with these config files: ${configFiles}`);

		// Parse out the full name of the 'containerFeatures' configFile
		const files = configFiles?.split(',') ?? [];
		const containerFeaturesConfigFile = files.find((f) => f.indexOf(overrideFilePrefix) > -1);
		if (containerFeaturesConfigFile) {
			const composeFileExists = await buildCLIHost.isFile(containerFeaturesConfigFile);

			if (composeFileExists) {
				output.write(`Restoring ${containerFeaturesConfigFile} from persisted storage`);
				didRestoreFromPersistedShare = true;

				// Push path to compose arguments
				composeGlobalArgs.push('-f', containerFeaturesConfigFile);
			} else {
				output.write(`Expected ${containerFeaturesConfigFile} to exist, but it did not`, LogLevel.Error);
			}
		} else {
			output.write(`Expected to find a docker-compose file prefixed with ${overrideFilePrefix}, but did not.`, LogLevel.Error);
		}
	}

	// If features/override docker-compose file hasn't been created yet or a cached version could not be found, generate the file now.
	if (!didRestoreFromPersistedShare) {
		output.write('Generating composeOverrideFile...');

		const { updatedImageName: updatedImageName0, collapsedFeaturesConfig, imageDetails } = await extendImage(params, config, originalImageName, !service.build);
		const updatedImageName = await updateRemoteUserUID(params, config, updatedImageName0, imageDetails, service.user);
		const composeOverrideContent = await generateFeaturesComposeOverrideContent(updatedImageName, originalImageName, collapsedFeaturesConfig, config, buildParams, composeFiles, imageDetails, service, idLabels, params.additionalMounts);

		const overrideFileHasContents = !!composeOverrideContent && composeOverrideContent.length > 0 && composeOverrideContent.trim() !== '';

		if (overrideFileHasContents) {
			output.write(`Docker Compose override file:\n${composeOverrideContent}`, LogLevel.Trace);

			// Save override docker-compose file to disk.
			// Persisted folder is a path that will be maintained between sessions
			// Note: As a fallback, persistedFolder is set to the build's tmpDir() directory

			const fileName = `${overrideFilePrefix}-${Date.now()}.yml`;
			const composeFolder = buildCLIHost.path.join(persistedFolder, 'docker-compose');
			const composeOverrideFile = buildCLIHost.path.join(composeFolder, fileName);
			output.write(`Writing ${fileName} to ${composeFolder}`);
			await buildCLIHost.mkdirp(composeFolder);
			await buildCLIHost.writeFile(composeOverrideFile, Buffer.from(composeOverrideContent));

			// Add file path to override file as parameter
			composeGlobalArgs.push('-f', composeOverrideFile);
		} else {
			output.write('Override file was generated, but was empty and thus not persisted or included in the docker-compose arguments.');
		}
	}

	const args = ['--project-name', projectName, ...composeGlobalArgs];
	args.push('up', '-d');
	if (params.expectExistingContainer) {
		args.push('--no-recreate');
	}
	if (config.runServices && config.runServices.length) {
		args.push(...config.runServices);
		if (config.runServices.indexOf(config.service) === -1) {
			args.push(config.service);
		}
	}
	try {
		await dockerComposePtyCLI({ ...buildParams, output: infoOutput }, ...args);
	} catch (err) {
		cancel!();
		throw new ContainerError({ description: 'An error occurred starting Docker Compose up.', originalError: err, data: { fileWithError: localComposeFiles[0] } });
	}

	await started;
	return {
		containerId: (await findComposeContainer(params, projectName, config.service))!,
	};
}

async function generateFeaturesComposeOverrideContent(
	updatedImageName: string,
	originalImageName: string,
	collapsedFeaturesConfig: CollapsedFeaturesConfig | undefined,
	config: DevContainerFromDockerComposeConfig,
	buildParams: DockerCLIParameters,
	composeFiles: string[],
	imageDetails: () => Promise<ImageDetails>,
	service: any,
	additionalLabels: string[],
	additionalMounts: Mount[],
) {

	const { cliHost: buildCLIHost } = buildParams;
	let composeOverrideContent: string = '';

	const overrideImage = updatedImageName !== originalImageName;

	const featureCaps = [...new Set(([] as string[]).concat(...(collapsedFeaturesConfig?.allFeatures || [])
		.filter(f => (includeAllConfiguredFeatures || f.included) && f.value)
		.map(f => f.capAdd || [])))];
	const featureSecurityOpts = [...new Set(([] as string[]).concat(...(collapsedFeaturesConfig?.allFeatures || [])
		.filter(f => (includeAllConfiguredFeatures || f.included) && f.value)
		.map(f => f.securityOpt || [])))];
	const featureMounts = ([] as Mount[]).concat(
		...(collapsedFeaturesConfig?.allFeatures || [])
			.map(f => (includeAllConfiguredFeatures || f.included) && f.value && f.mounts)
			.filter(Boolean) as Mount[][],
		additionalMounts,
	);
	const volumeMounts = featureMounts.filter(m => m.type === 'volume');
	const customEntrypoints = (collapsedFeaturesConfig?.allFeatures || [])
		.map(f => (includeAllConfiguredFeatures || f.included) && f.value && f.entrypoint)
		.filter(Boolean) as string[];
	const composeEntrypoint: string[] | undefined = typeof service.entrypoint === 'string' ? shellQuote.parse(service.entrypoint) : service.entrypoint;
	const composeCommand: string[] | undefined = typeof service.command === 'string' ? shellQuote.parse(service.command) : service.command;
	const userEntrypoint = config.overrideCommand ? [] : composeEntrypoint /* $ already escaped. */
		|| ((await imageDetails()).Config.Entrypoint || []).map(c => c.replace(/\$/g, '$$$$')); // $ > $$ to escape docker-compose.yml's interpolation.
	const userCommand = config.overrideCommand ? [] : composeCommand /* $ already escaped. */
		|| (composeEntrypoint ? [/* Ignore image CMD per docker-compose.yml spec. */] : ((await imageDetails()).Config.Cmd || []).map(c => c.replace(/\$/g, '$$$$'))); // $ > $$ to escape docker-compose.yml's interpolation.

	composeOverrideContent = `services:
  '${config.service}':${overrideImage ? `
    image: ${updatedImageName}` : ''}
    entrypoint: ["/bin/sh", "-c", "echo Container started\\n
trap \\"exit 0\\" 15\\n
${customEntrypoints.join('\\n\n')}\\n
exec \\"$$@\\"\\n
while sleep 1 & wait $$!; do :; done", "-"${userEntrypoint.map(a => `, ${JSON.stringify(a)}`).join('')}]${userCommand !== composeCommand ? `
    command: ${JSON.stringify(userCommand)}` : ''}${(collapsedFeaturesConfig?.allFeatures || []).some(f => (includeAllConfiguredFeatures || f.included) && f.value && f.init) ? `
    init: true` : ''}${(collapsedFeaturesConfig?.allFeatures || []).some(f => (includeAllConfiguredFeatures || f.included) && f.value && f.privileged) ? `
    privileged: true` : ''}${featureCaps.length ? `
    cap_add:${featureCaps.map(cap => `
      - ${cap}`).join('')}` : ''}${featureSecurityOpts.length ? `
    security_opt:${featureSecurityOpts.map(securityOpt => `
      - ${securityOpt}`).join('')}` : ''}${additionalLabels.length ? `
    labels:${additionalLabels.map(label => `
      - ${label.replace(/\$/g, '$$$$')}`).join('')}` : ''}${featureMounts.length ? `
    volumes:${featureMounts.map(m => `
      - ${m.source}:${m.target}`).join('')}` : ''}${volumeMounts.length ? `
volumes:${volumeMounts.map(m => `
  ${m.source}:${m.external ? '\n    external: true' : ''}`).join('')}` : ''}
`;
	const firstComposeFile = (await buildCLIHost.readFile(composeFiles[0])).toString();
	const version = (/^\s*(version:.*)$/m.exec(firstComposeFile) || [])[1];
	if (version) {
		composeOverrideContent = `${version}

${composeOverrideContent}`;
	}
	return composeOverrideContent;
}

export async function readDockerComposeConfig(params: DockerCLIParameters, composeFiles: string[], envFile: string | undefined) {
	try {
		const composeGlobalArgs = ([] as string[]).concat(...composeFiles.map(composeFile => ['-f', composeFile]));
		if (envFile) {
			composeGlobalArgs.push('--env-file', envFile);
		}
		const composeCLI = await params.dockerComposeCLI();
		if ((parseVersion(composeCLI.version) || [])[0] >= 2) {
			composeGlobalArgs.push('--profile', '*');
		}
		try {
			const { stdout } = await dockerComposeCLI(params, ...composeGlobalArgs, 'config');
			const stdoutStr = stdout.toString();
			params.output.write(stdoutStr);
			return yaml.load(stdoutStr) || {} as any;
		} catch (err) {
			if (!Buffer.isBuffer(err?.stderr) || err?.stderr.toString().indexOf('UnicodeEncodeError') === -1) {
				throw err;
			}
			// Upstream issues. https://github.com/microsoft/vscode-remote-release/issues/5308
			if (params.cliHost.platform === 'win32') {
				const { cmdOutput } = await dockerComposePtyCLI({
					...params,
					output: makeLog({
						event: params.output.event,
						dimensions: {
							columns: 999999,
							rows: 1,
						},
					}, LogLevel.Info),
				}, ...composeGlobalArgs, 'config');
				return yaml.load(cmdOutput.replace(terminalEscapeSequences, '')) || {} as any;
			}
			const { stdout } = await dockerComposeCLI({
				...params,
				env: {
					...params.env,
					LANG: 'en_US.UTF-8',
					LC_CTYPE: 'en_US.UTF-8',
				}
			}, ...composeGlobalArgs, 'config');
			const stdoutStr = stdout.toString();
			params.output.write(stdoutStr);
			return yaml.load(stdoutStr) || {} as any;
		}
	} catch (err) {
		throw err instanceof ContainerError ? err : new ContainerError({ description: 'An error occurred retrieving the Docker Compose configuration.', originalError: err, data: { fileWithError: composeFiles[0] } });
	}
}

export async function findComposeContainer(params: DockerCLIParameters | DockerResolverParameters, projectName: string, serviceName: string): Promise<string | undefined> {
	const list = await listContainers(params, true, [
		`${projectLabel}=${projectName}`,
		`${serviceLabel}=${serviceName}`
	]);
	return list && list[0];
}

export async function getProjectName(params: DockerCLIParameters | DockerResolverParameters, workspace: Workspace, composeFiles: string[]) {
	const { cliHost } = 'cliHost' in params ? params : params.common;
	const newProjectName = await useNewProjectName(params);
	const envName = toProjectName(cliHost.env.COMPOSE_PROJECT_NAME || '', newProjectName);
	if (envName) {
		return envName;
	}
	try {
		const envPath = cliHost.path.join(cliHost.cwd, '.env');
		const buffer = await cliHost.readFile(envPath);
		const match = /^COMPOSE_PROJECT_NAME=(.+)$/m.exec(buffer.toString());
		const value = match && match[1].trim();
		const envFileName = toProjectName(value || '', newProjectName);
		if (envFileName) {
			return envFileName;
		}
	} catch (err) {
		if (!(err && (err.code === 'ENOENT' || err.code === 'EISDIR'))) {
			throw err;
		}
	}
	const configDir = workspace.configFolderPath;
	const workingDir = composeFiles[0] ? cliHost.path.dirname(composeFiles[0]) : cliHost.cwd; // From https://github.com/docker/compose/blob/79557e3d3ab67c3697641d9af91866d7e400cfeb/compose/config/config.py#L290
	if (equalPaths(cliHost.platform, workingDir, cliHost.path.join(configDir, '.devcontainer'))) {
		return toProjectName(`${cliHost.path.basename(configDir)}_devcontainer`, newProjectName);
	}
	return toProjectName(cliHost.path.basename(workingDir), newProjectName);
}

function toProjectName(basename: string, newProjectName: boolean) {
	// From https://github.com/docker/compose/blob/79557e3d3ab67c3697641d9af91866d7e400cfeb/compose/cli/command.py#L152
	if (!newProjectName) {
		return basename.toLowerCase().replace(/[^a-z0-9]/g, '');
	}
	return basename.toLowerCase().replace(/[^-_a-z0-9]/g, '');
}

async function useNewProjectName(params: DockerCLIParameters | DockerResolverParameters) {
	try {
		const version = parseVersion((await params.dockerComposeCLI()).version);
		if (!version) {
			return true; // Optimistically continue.
		}
		return !isEarlierVersion(version, [1, 21, 0]); // 1.21.0 changed allowed characters in project names (added hyphen and underscore).
	} catch (err) {
		return true; // Optimistically continue.
	}
}

export function dockerComposeCLIConfig(params: Omit<PartialExecParameters, 'cmd'>, dockerCLICmd: string, dockerComposeCLICmd: string) {
	let result: Promise<DockerComposeCLI>;
	return () => {
		return result || (result = (async () => {
			let v2 = false;
			let stdout: Buffer;
			try {
				stdout = (await dockerComposeCLI({
					...params,
					cmd: dockerComposeCLICmd,
				}, 'version', '--short')).stdout;
			} catch (err) {
				if (err?.code !== 'ENOENT') {
					throw err;
				}
				stdout = (await dockerComposeCLI({
					...params,
					cmd: dockerCLICmd,
				}, 'compose', 'version', '--short')).stdout;
				v2 = true;
			}
			return {
				version: stdout.toString().trim(),
				cmd: v2 ? dockerCLICmd : dockerComposeCLICmd,
				args: v2 ? ['compose'] : [],
			};
		})());
	};
}

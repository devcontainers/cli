/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';

import * as jsonc from 'jsonc-parser';

import { openDockerfileDevContainer } from './singleContainer';
import { openDockerComposeDevContainer } from './dockerCompose';
import { ResolverResult, DockerResolverParameters, isDockerFileConfig, runUserCommand, createDocuments, getWorkspaceConfiguration, BindMountConsistency, uriToFsPath, DevContainerAuthority, isDevContainerAuthority, SubstituteConfig, SubstitutedConfig } from './utils';
import { substitute } from '../spec-common/variableSubstitution';
import { ContainerError } from '../spec-common/errors';
import { Workspace, workspaceFromPath, isWorkspacePath } from '../spec-utils/workspaces';
import { URI } from 'vscode-uri';
import { CLIHost } from '../spec-common/commonUtils';
import { Log } from '../spec-utils/log';
import { getDefaultDevContainerConfigPath, getDevContainerConfigPathIn } from '../spec-configuration/configurationCommonUtils';
import { DevContainerConfig, DevContainerFromDockerComposeConfig, DevContainerFromDockerfileConfig, DevContainerFromImageConfig, updateFromOldProperties } from '../spec-configuration/configuration';

export { getWellKnownDevContainerPaths as getPossibleDevContainerPaths } from '../spec-configuration/configurationCommonUtils';

export async function resolve(params: DockerResolverParameters, configFile: URI | undefined, overrideConfigFile: URI | undefined, idLabels: string[], additionalFeatures?: Record<string, string | boolean | Record<string, string | boolean>>): Promise<ResolverResult> {
	if (configFile && !/\/\.?devcontainer\.json$/.test(configFile.path)) {
		throw new Error(`Filename must be devcontainer.json or .devcontainer.json (${uriToFsPath(configFile, params.common.cliHost.platform)}).`);
	}
	const parsedAuthority = params.parsedAuthority;
	if (!parsedAuthority || isDevContainerAuthority(parsedAuthority)) {
		return resolveWithLocalFolder(params, parsedAuthority, configFile, overrideConfigFile, idLabels, additionalFeatures);
	} else {
		throw new Error(`Unexpected authority: ${JSON.stringify(parsedAuthority)}`);
	}
}

async function resolveWithLocalFolder(params: DockerResolverParameters, parsedAuthority: DevContainerAuthority | undefined, configFile: URI | undefined, overrideConfigFile: URI | undefined, idLabels: string[], additionalFeatures?: Record<string, string | boolean | Record<string, string | boolean>>): Promise<ResolverResult> {
	const { common, workspaceMountConsistencyDefault } = params;
	const { cliHost, output } = common;

	const cwd = cliHost.cwd; // Can be inside WSL.
	const workspace = parsedAuthority && workspaceFromPath(cliHost.path, isWorkspacePath(parsedAuthority.hostPath) ? cliHost.path.join(cwd, path.basename(parsedAuthority.hostPath)) : cwd);

	const configPath = configFile ? configFile : workspace
		? (await getDevContainerConfigPathIn(cliHost, workspace.configFolderPath)
			|| (overrideConfigFile ? getDefaultDevContainerConfigPath(cliHost, workspace.configFolderPath) : undefined))
		: overrideConfigFile;
	const configs = configPath && await readDevContainerConfigFile(cliHost, workspace, configPath, params.mountWorkspaceGitRoot, output, workspaceMountConsistencyDefault, overrideConfigFile) || undefined;
	if (!configs) {
		if (configPath || workspace) {
			throw new ContainerError({ description: `Dev container config (${uriToFsPath(configPath || getDefaultDevContainerConfigPath(cliHost, workspace!.configFolderPath), cliHost.platform)}) not found.` });
		} else {
			throw new ContainerError({ description: `No dev container config and no workspace found.` });
		}
	}
	const configWithRaw = configs.config;
	const { config } = configWithRaw;

	await runUserCommand({ ...params, common: { ...common, output: common.postCreate.output } }, config.initializeCommand, common.postCreate.onDidInput);

	let result: ResolverResult;
	if (isDockerFileConfig(config) || 'image' in config) {
		result = await openDockerfileDevContainer(params, configWithRaw as SubstitutedConfig<DevContainerFromDockerfileConfig | DevContainerFromImageConfig>, configs.workspaceConfig, idLabels, additionalFeatures);
	} else if ('dockerComposeFile' in config) {
		if (!workspace) {
			throw new ContainerError({ description: `A Dev Container using Docker Compose requires a workspace folder.` });
		}
		result = await openDockerComposeDevContainer(params, workspace, configWithRaw as SubstitutedConfig<DevContainerFromDockerComposeConfig>, idLabels, additionalFeatures);
	} else {
		throw new ContainerError({ description: `Dev container config (${(config as DevContainerConfig).configFilePath}) is missing one of "image", "dockerFile" or "dockerComposeFile" properties.` });
	}
	return result;
}

export async function readDevContainerConfigFile(cliHost: CLIHost, workspace: Workspace | undefined, configFile: URI, mountWorkspaceGitRoot: boolean, output: Log, consistency?: BindMountConsistency, overrideConfigFile?: URI) {
	const documents = createDocuments(cliHost);
	const content = await documents.readDocument(overrideConfigFile ?? configFile);
	if (!content) {
		return undefined;
	}
	const raw = jsonc.parse(content) as DevContainerConfig | undefined;
	const updated = raw && updateFromOldProperties(raw);
	if (!updated || typeof updated !== 'object' || Array.isArray(updated)) {
		throw new ContainerError({ description: `Dev container config (${uriToFsPath(configFile, cliHost.platform)}) must contain a JSON object literal.` });
	}
	const workspaceConfig = await getWorkspaceConfiguration(cliHost, workspace, updated, mountWorkspaceGitRoot, output, consistency);
	const substitute0: SubstituteConfig = value => substitute({
		platform: cliHost.platform,
		localWorkspaceFolder: workspace?.rootFolderPath,
		containerWorkspaceFolder: workspaceConfig.workspaceFolder,
		configFile,
		env: cliHost.env,
	}, value);
	const config: DevContainerConfig = substitute0(updated);
	if (typeof config.workspaceFolder === 'string') {
		workspaceConfig.workspaceFolder = config.workspaceFolder;
	}
	if ('workspaceMount' in config) {
		workspaceConfig.workspaceMount = config.workspaceMount;
	}
	config.configFilePath = configFile;
	return {
		config: {
			config,
			raw: updated,
			substitute: substitute0,
		},
		workspaceConfig,
	};
}

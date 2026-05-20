/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';
import { DevContainerFromDockerComposeConfig, DevContainerFromDockerfileConfig } from '../spec-configuration/configuration';
import { ContainerError, toErrorText } from '../spec-common/errors';
import { CLIHost, runCommandNoPty } from '../spec-common/commonUtils';
import { Log, LogLevel, makeLog } from '../spec-utils/log';

export function getDockerfilePreprocessedPath(dockerfilePath: string, output?: string): string | undefined {
	if (!dockerfilePath.toLowerCase().endsWith('.in')) {
		return undefined;
	}
	if (output) {
		return path.isAbsolute(output) ? output : path.join(path.dirname(dockerfilePath), output);
	}
	return dockerfilePath.slice(0, -3);
}

export async function preprocessDockerExtensionFile(
	params: { cliHost: CLIHost; output: Log },
	config: Pick<DevContainerFromDockerfileConfig | DevContainerFromDockerComposeConfig, 'dockerfilePreprocessor'>,
	dockerfilePath: string
): Promise<string> {
	const outputDockerfilePath = getDockerfilePreprocessedPath(dockerfilePath, config.dockerfilePreprocessor?.output);
	if (!outputDockerfilePath) {
		return dockerfilePath;
	}

	const commands = (config.dockerfilePreprocessor?.commands || []).map(command => command.trim()).filter(command => command.length > 0);
	if (!commands.length) {
		throw new ContainerError({
			description: `Dockerfile preprocessor commands are required to build from '${dockerfilePath}'. Set 'dockerfilePreprocessor.commands' in devcontainer.json.`,
			data: { fileWithError: dockerfilePath },
		});
	}

	const { cliHost, output } = params;
	const infoOutput = makeLog(output, LogLevel.Info);
	const isWindows = cliHost.platform === 'win32';
	const shell = isWindows ? [cliHost.env.ComSpec || 'cmd.exe', '/c'] : ['/bin/sh', '-c'];

	const env = {
		...cliHost.env,
		DEVCONTAINER_DOCKERFILE_PREPROCESSOR_INPUT: dockerfilePath,
		DEVCONTAINER_DOCKERFILE_PREPROCESSOR_OUTPUT: outputDockerfilePath,
		input_file: dockerfilePath,
		output_file: outputDockerfilePath,
	};

	try {
		infoOutput.write(`Preprocessing '${dockerfilePath}' -> '${outputDockerfilePath}'`);
		for (const command of commands) {
			await runCommandNoPty({
				exec: cliHost.exec,
				cmd: shell[0],
				args: [shell[1], command],
				cwd: path.dirname(dockerfilePath),
				env,
				output: infoOutput,
				print: 'continuous',
			});
		}
	} catch (err) {
		throw new ContainerError({
			description: `Dockerfile preprocessing failed while running '${commands[commands.length - 1]}'.`,
			originalError: {
				...err,
				message: `${err?.message || 'Dockerfile preprocessing command failed.'} ${toErrorText(err?.stderr || err?.cmdOutput || '')}`.trim(),
			},
			data: { fileWithError: dockerfilePath },
		});
	}

	if (!await cliHost.isFile(outputDockerfilePath)) {
		throw new ContainerError({
			description: `Dockerfile preprocessing did not produce '${outputDockerfilePath}'.`,
			data: { fileWithError: dockerfilePath },
		});
	}

	return outputDockerfilePath;
}

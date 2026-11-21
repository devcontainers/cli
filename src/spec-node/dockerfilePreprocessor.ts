/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';
import { DevContainerFromDockerComposeConfig, DevContainerFromDockerfileConfig } from '../spec-configuration/configuration';
import { ContainerError, toErrorText } from '../spec-common/errors';
import { CLIHost } from '../spec-common/cliHost';
import { runCommandNoPty } from '../spec-common/commonUtils';
import { Log, LogLevel, makeLog } from '../spec-utils/log';

function dockerfilePreprocessorToolDocs(): string {
	return "Set 'dockerfilePreprocessor.tool', optional 'dockerfilePreprocessor.args', and 'dockerfilePreprocessor.generatedDockerfilePath' in devcontainer.json. The CLI invokes the tool with configured args and validates that the generated Dockerfile exists at the configured path.";
}

export async function preprocessDockerExtensionFile(
	params: { cliHost: CLIHost; output: Log },
	config: Pick<DevContainerFromDockerfileConfig | DevContainerFromDockerComposeConfig, 'dockerfilePreprocessor'>,
	dockerfilePath: string
): Promise<string> {

	const tool = config.dockerfilePreprocessor?.tool?.trim();
	const args = (config.dockerfilePreprocessor?.args || []).map(arg => arg.trim()).filter(arg => arg.length > 0);
	const generatedDockerfilePath = config.dockerfilePreprocessor?.generatedDockerfilePath?.trim();
	if (!tool) {
		throw new ContainerError({
			description: `A Dockerfile preprocessor tool is required to build from '${dockerfilePath}'. ${dockerfilePreprocessorToolDocs()}`,
			data: { fileWithError: dockerfilePath },
		});
	}
	if (!generatedDockerfilePath) {
		throw new ContainerError({
			description: `dockerfilePreprocessor.generatedDockerfilePath is required. ${dockerfilePreprocessorToolDocs()}`,
			data: { fileWithError: dockerfilePath },
		});
	}

	const { cliHost, output } = params;
	const infoOutput = makeLog(output, LogLevel.Info);
	const workdirPath = path.dirname(dockerfilePath);
	const generatedOutputPath = path.resolve(workdirPath, generatedDockerfilePath);
	const generatedOutputDir = path.dirname(generatedOutputPath);
	await cliHost.mkdirp(generatedOutputDir);
	if (await cliHost.isFile(generatedOutputPath)) {
		await cliHost.remove(generatedOutputPath);
	}

	// Minimal contract: tool args are user-controlled and run in the Dockerfile
	// directory. The CLI only provides the resolved generated Dockerfile path.
	const env = {
		...cliHost.env,
		DEVCONTAINER_DOCKERFILE_PREPROCESSOR_GENERATED_DOCKERFILE: generatedOutputPath,
	};
	const invocationArgs = [...args];

	try {
		infoOutput.write(`Preprocessing '${dockerfilePath}' -> '${generatedOutputPath}'`);
		await runCommandNoPty({
			exec: cliHost.exec,
			cmd: tool,
			args: invocationArgs,
			cwd: workdirPath,
			env,
			output: infoOutput,
			print: 'continuous',
		});
	} catch (err) {
		const originalError = err as {
			message?: string;
			stderr?: Buffer | string;
			cmdOutput?: string;
			code?: number;
			signal?: string;
		};
		const stderrText = typeof originalError?.stderr === 'string' ? originalError.stderr : originalError?.stderr?.toString();
		throw new ContainerError({
			description: `Dockerfile preprocessing failed while running '${tool}'. ${dockerfilePreprocessorToolDocs()}`,
			originalError: {
				message: `${originalError?.message || 'Dockerfile preprocessing command failed.'} ${toErrorText(stderrText || originalError?.cmdOutput || '')}`.trim(),
				code: originalError?.code,
				signal: originalError?.signal,
				stderr: originalError?.stderr,
			},
			data: { fileWithError: dockerfilePath },
		});
	}

	const generatedExists = await cliHost.isFile(generatedOutputPath);
	if (!generatedExists) {
		throw new ContainerError({
			description: `Dockerfile preprocessing did not produce '${generatedOutputPath}'. Ensure the configured tool writes the final Dockerfile to the configured generatedDockerfile path. ${dockerfilePreprocessorToolDocs()}`,
			data: { fileWithError: dockerfilePath },
		});
	}

	infoOutput.write(`Preprocessed Dockerfile written to '${generatedOutputPath}'`);

	return generatedOutputPath;
}

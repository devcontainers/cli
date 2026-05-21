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
	return "Set 'dockerfilePreprocessor.tool' and optional 'dockerfilePreprocessor.args' in devcontainer.json. 'outputMode' controls CLI invocation shape: 'single-file' passes input/output and 'build-tree' passes input/output/workdir. When using 'build-tree', set 'generatedDockerfile' to the tool's produced Dockerfile path so the CLI can verify and synchronize outputs.";
}

export function getDockerfilePreprocessedPath(dockerfilePath: string): string | undefined {
	if (!dockerfilePath.toLowerCase().endsWith('.in')) {
		return undefined;
	}
	return path.join(path.dirname(dockerfilePath), '.devcontainer-preprocessed', 'Dockerfile');
}

export async function preprocessDockerExtensionFile(
	params: { cliHost: CLIHost; output: Log },
	config: Pick<DevContainerFromDockerfileConfig | DevContainerFromDockerComposeConfig, 'dockerfilePreprocessor'>,
	dockerfilePath: string
): Promise<string> {
	const cliOutputPath = getDockerfilePreprocessedPath(dockerfilePath);
	if (!cliOutputPath) {
		return dockerfilePath;
	}

	const tool = config.dockerfilePreprocessor?.tool?.trim();
	const args = (config.dockerfilePreprocessor?.args || []).map(arg => arg.trim()).filter(arg => arg.length > 0);
	const outputMode = config.dockerfilePreprocessor?.outputMode || 'build-tree';
	const generatedDockerfile = config.dockerfilePreprocessor?.generatedDockerfile?.trim();
	if (!tool) {
		throw new ContainerError({
			description: `A Dockerfile preprocessor tool is required to build from '${dockerfilePath}'. ${dockerfilePreprocessorToolDocs()}`,
			data: { fileWithError: dockerfilePath },
		});
	}
	if (outputMode === 'single-file' && generatedDockerfile) {
		throw new ContainerError({
			description: `dockerfilePreprocessor.outputMode 'single-file' cannot be used with 'dockerfilePreprocessor.generatedDockerfile'. Omit generatedDockerfile in single-file mode. ${dockerfilePreprocessorToolDocs()}`,
			data: { fileWithError: dockerfilePath },
		});
	}
	if (outputMode === 'build-tree' && !generatedDockerfile) {
		throw new ContainerError({
			description: `dockerfilePreprocessor.outputMode 'build-tree' requires 'dockerfilePreprocessor.generatedDockerfile' to be set. ${dockerfilePreprocessorToolDocs()}`,
			data: { fileWithError: dockerfilePath },
		});
	}

	const { cliHost, output } = params;
	const infoOutput = makeLog(output, LogLevel.Info);
	const cliOutputDir = path.dirname(cliOutputPath);
	await cliHost.mkdirp(cliOutputDir);
	const workdirPath = path.dirname(dockerfilePath);
	const inputPath = dockerfilePath;
	const outputPath = cliOutputPath;
	const generatedOutputPath = generatedDockerfile ? path.resolve(workdirPath, generatedDockerfile) : outputPath;
	const staleOutputPaths = generatedOutputPath === outputPath ? [outputPath] : [outputPath, generatedOutputPath];
	for (const stalePath of staleOutputPaths) {
		if (!await cliHost.isFile(stalePath)) {
			continue;
		}
		await cliHost.remove(stalePath);
	}

	// Strict contract: the CLI owns the final output path. Direct-transform
	// tools can write to the CLI-provided output argument; workspace generators
	// can instead declare a generated Dockerfile path for the CLI to promote.
	const env = {
		...cliHost.env,
		DEVCONTAINER_DOCKERFILE_PREPROCESSOR_INPUT: inputPath,
		DEVCONTAINER_DOCKERFILE_PREPROCESSOR_OUTPUT: outputPath,
		DEVCONTAINER_DOCKERFILE_PREPROCESSOR_WORKDIR: workdirPath,
		DEVCONTAINER_DOCKERFILE_PREPROCESSOR_GENERATED_DOCKERFILE: generatedOutputPath,
		input_file: inputPath,
		output_file: outputPath,
		generated_dockerfile: generatedOutputPath,
		workdir: workdirPath,
	};
	const directOutputArgs = outputMode === 'single-file'
		? [inputPath, outputPath]
		: [inputPath, outputPath, workdirPath];
	const invocationArgs = [...args, ...directOutputArgs];

	try {
		infoOutput.write(`Preprocessing '${dockerfilePath}' -> '${cliOutputPath}'`);
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

	if (generatedDockerfile && generatedOutputPath !== outputPath && !await cliHost.isFile(generatedOutputPath) && await cliHost.isFile(outputPath)) {
		infoOutput.write(`No generated Dockerfile found at '${generatedOutputPath}', copying from CLI output '${outputPath}' to keep generated output consistent.`);
		await cliHost.copyFile(outputPath, generatedOutputPath);
	}

	if (!await cliHost.isFile(generatedOutputPath)) {
		throw new ContainerError({
			description: generatedDockerfile
				? `Dockerfile preprocessing did not produce '${generatedOutputPath}'. Ensure the configured tool writes the final Dockerfile to the configured generatedDockerfile path. ${dockerfilePreprocessorToolDocs()}`
				: `Dockerfile preprocessing did not produce '${outputPath}'. Ensure the configured tool writes the final Dockerfile to the CLI-provided output argument. ${dockerfilePreprocessorToolDocs()}`,
			data: { fileWithError: dockerfilePath },
		});
	}

	if (generatedOutputPath !== outputPath) {
		await cliHost.copyFile(generatedOutputPath, outputPath);
	}

	infoOutput.write(`Preprocessed Dockerfile written to '${cliOutputPath}'`);

	return cliOutputPath;
}

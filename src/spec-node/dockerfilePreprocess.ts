/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { randomUUID } from 'crypto';
import { CLIHost } from '../spec-common/cliHost';
import { ContainerError } from '../spec-common/errors';

const includeLine = /^\s*#include\s+"([^"]+)"\s*$/;

export interface ResolvedDockerfile {
	originalDockerfilePath: string;
	effectiveDockerfilePath: string;
	effectiveDockerfileContent: string;
	preprocessed: boolean;
}

export async function resolveDockerfileIncludesIfNeeded(cliHost: CLIHost, dockerfilePath: string): Promise<ResolvedDockerfile> {
	const dockerfileText = (await cliHost.readFile(dockerfilePath)).toString();
	if (!dockerfilePath.toLowerCase().endsWith('.in')) {
		return {
			originalDockerfilePath: dockerfilePath,
			effectiveDockerfilePath: dockerfilePath,
			effectiveDockerfileContent: dockerfileText,
			preprocessed: false,
		};
	}

	const effectiveDockerfileContent = await preprocessDockerfileIncludes(cliHost, dockerfilePath, []);
	const preprocessedDockerfilePath = await writePreprocessedDockerfile(cliHost, dockerfilePath, effectiveDockerfileContent);

	return {
		originalDockerfilePath: dockerfilePath,
		effectiveDockerfilePath: preprocessedDockerfilePath,
		effectiveDockerfileContent,
		preprocessed: true,
	};
}

async function preprocessDockerfileIncludes(cliHost: CLIHost, currentPath: string, stack: string[]): Promise<string> {
	if (stack.includes(currentPath)) {
		const chain = [...stack, currentPath].join(' -> ');
		throw new ContainerError({ description: `Cyclic #include detected while preprocessing Dockerfile: ${chain}` });
	}
	if (!(await cliHost.isFile(currentPath))) {
		throw new ContainerError({ description: `Included Dockerfile not found: ${currentPath}` });
	}

	const currentText = (await cliHost.readFile(currentPath)).toString();
	const lines = currentText.split(/\r?\n/);
	const expanded: string[] = [];
	const nextStack = [...stack, currentPath];
	for (const line of lines) {
		const match = includeLine.exec(line);
		if (!match) {
			expanded.push(line);
			continue;
		}

		const includePath = match[1];
		const resolvedIncludePath = cliHost.path.isAbsolute(includePath)
			? includePath
			: cliHost.path.resolve(cliHost.path.dirname(currentPath), includePath);
		expanded.push(await preprocessDockerfileIncludes(cliHost, resolvedIncludePath, nextStack));
	}

	return expanded.join('\n');
}

async function writePreprocessedDockerfile(cliHost: CLIHost, sourceDockerfilePath: string, content: string): Promise<string> {
	const cacheFolder = cliHost.path.join(
		await cliHost.tmpdir(),
		cliHost.platform === 'linux' ? `devcontainercli-${await cliHost.getUsername()}` : 'devcontainercli',
		'dockerfile-preprocess'
	);
	await cliHost.mkdirp(cacheFolder);

	const sourceBasename = cliHost.path.basename(sourceDockerfilePath);
	const targetBasename = sourceBasename.replace(/\.in$/i, '') || 'Dockerfile';
	const preprocessedDockerfilePath = cliHost.path.join(cacheFolder, `${Date.now()}-${randomUUID()}-${targetBasename}`);
	await cliHost.writeFile(preprocessedDockerfilePath, Buffer.from(content));
	return preprocessedDockerfilePath;
}

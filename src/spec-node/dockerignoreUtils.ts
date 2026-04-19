/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CLIHost } from '../spec-common/cliHost';

export async function copyDockerIgnoreFileIfExists(cliHost: CLIHost, sourceDockerfilePath: string, targetDockerfilePath: string) {
	const sourceDockerIgnorePath = `${sourceDockerfilePath}.dockerignore`;
	if (!(await cliHost.isFile(sourceDockerIgnorePath))) {
		return;
	}

	const targetDockerIgnorePath = `${targetDockerfilePath}.dockerignore`;
	await cliHost.writeFile(targetDockerIgnorePath, await cliHost.readFile(sourceDockerIgnorePath));
}

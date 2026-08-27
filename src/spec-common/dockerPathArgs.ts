/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export function parseDockerPathArgs(value: string | undefined): string[] | undefined {
	if (value === undefined) {
		return undefined;
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(value);
	} catch {
		throw new Error('--docker-path-args must be a JSON array of strings.');
	}

	if (!Array.isArray(parsed) || !parsed.every(arg => typeof arg === 'string')) {
		throw new Error('--docker-path-args must be a JSON array of strings.');
	}

	return parsed;
}

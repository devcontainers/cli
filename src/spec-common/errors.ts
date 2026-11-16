/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ContainerProperties, CommonDevContainerConfig, ResolverParameters } from './injectHeadless';

export { toErrorText, toWarningText } from '../spec-utils/log';

export interface ContainerErrorAction {
	readonly id: string;
	readonly title: string;
	readonly isCloseAffordance?: boolean;
	readonly isLastAction: boolean;
	applicable: (err: ContainerError, primary: boolean) => boolean | Promise<boolean>;
	execute: (err: ContainerError) => Promise<void>;
}

interface ContainerErrorData {
	reload?: boolean;
	start?: boolean;
	attach?: boolean;
	fileWithError?: string;
	disallowedFeatureId?: string;
	didStopContainer?: boolean;
	learnMoreUrl?: string;
}

interface ContainerErrorInfo {
	description: string;
	originalError?: any;
	manageContainer?: boolean;
	params?: ResolverParameters;
	containerId?: string;
	dockerParams?: any; // TODO
	containerProperties?: ContainerProperties;
	actions?: ContainerErrorAction[];
	data?: ContainerErrorData;
}

export class ContainerError extends Error implements ContainerErrorInfo {
	description!: string;
	originalError?: any;
	manageContainer = false;
	params?: ResolverParameters;
	containerId?: string; // TODO
	dockerParams?: any; // TODO
	volumeName?: string;
	repositoryPath?: string;
	folderPath?: string;
	containerProperties?: ContainerProperties;
	config?: CommonDevContainerConfig;
	actions: ContainerErrorAction[] = [];
	data: ContainerErrorData = {};

	constructor(info: ContainerErrorInfo) {
		super(info.originalError && info.originalError.message || info.description);
		Object.assign(this, info);
		if (this.originalError?.stack) {
			this.stack = this.originalError.stack;
		}
	}
}

const maxErrorOutputLines = 20;
const maxErrorOutputLength = 2000;

/**
 * Returns the end of the output of the failed command that caused an error, without terminal control sequences.
 * That is the combined output for commands run in a terminal and the standard error for other commands.
 */
export function getErrorOutput(err: any): string | undefined {
	for (let cause = err, depth = 0; cause && typeof cause === 'object' && depth < 10; cause = cause.originalError, depth++) {
		const output = typeof cause.cmdOutput === 'string' ? cause.cmdOutput : cause.stderr;
		if (output?.length) {
			const lines = String(output)
				.replace(/\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-_]/g, '')
				.split(/\r?\n/)
				// Progress output rewrites the line after a carriage return.
				.map(line => line.replace(/\r+$/, '').split('\r').pop()!.trimEnd())
				.filter(line => line.trim());
			const text = lines.slice(-maxErrorOutputLines).join('\n');
			return text.length > maxErrorOutputLength ? text.substring(text.length - maxErrorOutputLength) : text || undefined;
		}
	}
	return undefined;
}

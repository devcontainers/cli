/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as jsonc from 'jsonc-parser';

import { LifecycleCommand } from '../spec-common/injectHeadless';
import { DevContainerFromDockerComposeConfig, DevContainerFromDockerfileConfig, DevContainerFromImageConfig } from '../spec-configuration/configuration';
import { ImageMetadataEntry } from './imageMetadata';
import { CLIHost } from '../spec-common/cliHost';
import { Log, LogLevel } from '../spec-utils/log';
import { ContainerError } from '../spec-common/errors';

export type PolicyConstraints = Constraint[];

const readPolicyFileError = 'Failed to parse policy constraints file';
const errorPrefix = 'Policy violation';

export interface Constraint {
	action: 'filter' | 'deny';    	// | 'transformation';
	selector: string; 				// TODO: Define interface for selector
	// value?: any;  				// TODO: Allow requiring a match value as well for more complex constraints
}

export async function readPolicyConstraintsFromFile(params: { output?: Log; policyFile?: string; cliHost: CLIHost }): Promise<PolicyConstraints | undefined> {
	const { policyFile, cliHost, output } = params;
	if (!policyFile) {
		return;
	}

	try {
		const fileBuff = await cliHost.readFile(policyFile);
		const parseErrors: jsonc.ParseError[] = [];
		const policyConstraints = jsonc.parse(fileBuff.toString(), parseErrors) as PolicyConstraints;
		if (parseErrors.length) {
			// Log errors
			if (output) {
				parseErrors.forEach(e => {
					output.write(`(${e.offset}) ${e.error}`, LogLevel.Error);
				});
			}
			throw new Error(`Invalid json data`);
		}

		// Validate that the top-level item is an array
		if (!Array.isArray(policyConstraints)) {
			throw new Error(`Policy constraints file must be an array of constraint objects`);
		}

		return policyConstraints;
	}
	catch (e) {
		throw new ContainerError({
			description: readPolicyFileError,
			originalError: e
		});
	}
}

export function applyConstraintsToMetadataEntries(params: { output: Log }, metadata: ImageMetadataEntry[], constraints: PolicyConstraints | undefined) {
	if (!constraints) {
		return metadata;
	}
	const copy = metadata.slice();
	return copy.map(entry => apply<ImageMetadataEntry>(params, entry, constraints));
}

export function applyConstraintsToSingleContainerConfig(params: { output: Log }, config: DevContainerFromImageConfig | DevContainerFromDockerfileConfig, constraints: PolicyConstraints | undefined) {
	if (!constraints) {
		return config;
	}
	const configApplied = apply(params, config, constraints);
	return {
		...configApplied,
		runArgs: applyConstraintsToRunArgs(params, configApplied.runArgs, constraints)
	};
}

export function applyConstraintsToComposeConfig(params: { output: Log }, config: DevContainerFromDockerComposeConfig, constraints: PolicyConstraints | undefined) {
	if (!constraints) {
		return config;
	}
	return apply(params, config, constraints);
}

// Currently used for 'initializeCommand' only
export function applyConstraintsToLifecycleHook(params: { output: Log }, userCommand: LifecycleCommand | undefined, constraints: PolicyConstraints | undefined) {
	const { output } = params;

	if (!userCommand || !constraints) {
		return userCommand;
	}
	const constraint = constraints.find(c => c.selector === 'initializeCommand');
	if (constraint) {
		switch (constraint.action) {
			case 'deny':
				throwPolicyError('initializeCommand', userCommand);
			case 'filter':
				return undefined;
			default:
				output.write(`Unrecognized action for policy constraint: ${constraint.action}`, LogLevel.Warning);
		}
	}

	return userCommand;
}

function applyConstraintsToRunArgs(params: { output: Log }, runArgs: string[] | undefined, constraints: PolicyConstraints | undefined) {
	const { output } = params;
	if (!constraints || !runArgs) {
		return runArgs;
	}

	const approvedRunArgs: string[] = [];
	while (runArgs.length) {
		const flag = runArgs.shift()!;
		const value = runArgs[0] && !runArgs[0].startsWith('-') ? runArgs.shift()! : undefined;
		const selector = flag.startsWith('--') ? flag.slice(2) : flag.slice(1);
		const constraint = constraints.find(c => c.selector === selector);
		if (constraint) {
			switch (constraint.action) {
				case 'deny':
					throwPolicyError(selector, value);
				case 'filter':
					// Skip this flag and value
					break;
				default:
					output.write(`Unrecognized action for policy constraint: '${constraint.action}'. Assuming filter behavior.`, LogLevel.Warning);
			}
		} else {
			// Not matching a constraint, default approve
			approvedRunArgs.push(flag);
			if (value) {
				approvedRunArgs.push(value);
			}
		}
	}

	output.write(`Approved runArgs: ${approvedRunArgs}`, LogLevel.Trace);
	return approvedRunArgs;
}

function apply<T extends {}>(params: { output: Log }, obj: T, constraints: PolicyConstraints): T {
	const { output } = params;
	if (!constraints) {
		return obj;
	}

	const result = { ...obj };
	for (const constraint of constraints) {
		const { action, selector } = constraint;

		if (!selector) {
			output.write(`Missing selector on constraint. Skipping...`, LogLevel.Warning);
			continue;
		}

		if (!(selector in result) || !(result[selector as keyof typeof result])) {
			continue;
		}

		switch (action) {
			case 'deny':
				throwPolicyError(selector);
			case 'filter':
				delete (result as any)[selector];
				break;
			default:
				output.write(`Unrecognized constraint action '${action}'.  Skipping...`, LogLevel.Warning);
		}
	}
	return result;
}

function throwPolicyError(selector: string, value?: any) {
	throw new Error(`${errorPrefix}: Property '${selector}'${value ? ` with value '${value}'` : ''} is not permitted.`);
}
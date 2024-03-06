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
			throw new Error('Invalid json data');
		}
		return policyConstraints;
	}
	catch (e) {
		if (output) {
			output.write(`Failed to parse policy constraints file from '${policyFile}'`, LogLevel.Error);
		}

		throw new ContainerError({
			description: 'Failed to parse policy constraints file',
			originalError: e
		});
	}
}

export function applyConstraintsToMetadataEntries(metadata: ImageMetadataEntry[], constraints: PolicyConstraints | undefined) {
	if (!constraints) {
		return metadata;
	}
	return metadata.map(entry => apply<ImageMetadataEntry>(entry, constraints));
}

export function applyConstraintsToSingleContainerConfig(config: DevContainerFromImageConfig | DevContainerFromDockerfileConfig, constraints: PolicyConstraints | undefined) {
	if (!constraints) {
		return config;
	}
	const configApplied = apply(config, constraints);
	return {
		...configApplied,
		runArgs: applyConstraintsToRunArgs(configApplied.runArgs, constraints)
	};
}

export function applyConstraintsToComposeConfig(config: DevContainerFromDockerComposeConfig, constraints: PolicyConstraints | undefined) {
	if (!constraints) {
		return config;
	}
	return apply(config, constraints);
}

// Currently used for 'initializeCommand' only
export function applyConstraintsToLifecycleHook(userCommand: LifecycleCommand | undefined, constraints: PolicyConstraints | undefined) {
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
		}
	}

	return userCommand;
}

function applyConstraintsToRunArgs(runArgs: string[] | undefined, constraints: PolicyConstraints | undefined) {
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
					break;
				default:
					// Approved!
					approvedRunArgs.push(flag);
					if (value) {
						approvedRunArgs.push(value);
					}
			}
		}
	}
	return approvedRunArgs;
}

function apply<T extends {}>(obj: T, constraints: PolicyConstraints): T {
	if (!constraints) {
		return obj;
	}

	const result = { ...obj };
	for (const constraint of constraints) {
		const { action, selector } = constraint;
		if (!(selector in result) || !(result[selector as keyof typeof result])) {
			continue;
		}
		switch (action) {
			case 'deny':
				throwPolicyError(selector);
			case 'filter':
				delete (result as any)[selector];
		}
	}
	return result;
}

function throwPolicyError(selector: string, value?: any) {
	throw new Error(`Policy violation: Property '${selector}' ${value ? `with value '${value}'` : ''} is not permitted.`);
}
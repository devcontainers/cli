/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { MergedDevContainerConfig } from './imageMetadata';

export type PolicyConstraints = Constraint[];

export interface Constraint {
	action: 'filter' | 'deny' | 'transformation';
	selector: keyof MergedDevContainerConfig;
	// value?: any;  // TODO: Allow requiring a match value as well for more complex constraints
}

export function applyConstraintsToMergedConfig(constraints: PolicyConstraints | undefined, mergedConfig: MergedDevContainerConfig) {
	if (!constraints) {
		return mergedConfig;
	}
	return constraints
		.reduce((config, constraint) => apply(constraint, config), mergedConfig);
}

export function applyConstraintsToRunArgs(runArgs: string[] | undefined, constraints: PolicyConstraints | undefined) {
	const approvedRunArgs: string[] = [];
	if (!constraints || !runArgs) {
		return runArgs;
	}

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

function apply(constraint: Constraint, mergedConfig: MergedDevContainerConfig): MergedDevContainerConfig {
	const { action, selector } = constraint;
	switch (action) {
		case 'transformation':
			// TODO
			return mergedConfig;
		case 'filter':
		case 'deny':
			if (selector in mergedConfig && mergedConfig[selector]) {
				action === 'deny' ? throwPolicyError(selector) : delete mergedConfig[selector];
				return mergedConfig;
			}
			return mergedConfig;
		default:
			return mergedConfig;
	}
}

function throwPolicyError(selector: string, value?: any) {
	throw new Error(`Policy violation: Property '${selector}' ${value ? `with value '${value}'` : ''} is not permitted.`);
}
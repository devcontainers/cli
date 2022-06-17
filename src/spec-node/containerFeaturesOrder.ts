/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


import { ContainerError } from '../spec-common/errors';
import { Feature } from '../spec-configuration/containerFeaturesConfiguration';

interface FeatureNode {
	feature: Feature;
	before: Set<FeatureNode>;
	after: Set<FeatureNode>;
}

export function computeInstallationOrder(features: Feature[]) {
	const nodesById = features.map<FeatureNode>(feature => ({
		feature,
		before: new Set(),
		after: new Set(),
	})).reduce((map, feature) => map.set(feature.feature.id, feature), new Map<string, FeatureNode>());

	const nodes = [...nodesById.values()];
	for (const later of nodes) {
		for (const firstId of later.feature.installAfter || []) {
			const first = nodesById.get(firstId);
			// soft dependencies
			if (first) {
				later.after.add(first);
				first.before.add(later);
			}
		}
	}

	const { roots, islands } = nodes.reduce((prev, node) => {
		if (node.after.size === 0) {
			if (node.before.size === 0) {
				prev.islands.push(node);
			} else {
				prev.roots.push(node);
			}
		}
		return prev;
	}, { roots: [] as FeatureNode[], islands: [] as FeatureNode[] });

	const orderedFeatures = [];
	let current = roots;
	while (current.length) {
		const next = [];
		for (const first of current) {
			for (const later of first.before) {
				later.after.delete(first);
				if (later.after.size === 0) {
					next.push(later);
				}
			}
		}
		orderedFeatures.push(
			...current.map(node => node.feature)
				.sort((a, b) => a.id.localeCompare(b.id)) // stable order
		);
		current = next;
	}

	orderedFeatures.push(
		...islands.map(node => node.feature)
			.sort((a, b) => a.id.localeCompare(b.id)) // stable order
	);
	
	const missing = new Set(nodesById.keys());
	for (const feature of orderedFeatures) {
		missing.delete(feature.id);
	}

	if (missing.size !== 0) {
		throw new ContainerError({ description: `Features declare cyclic dependency: ${[...missing].join(', ')}` });
	}

	return orderedFeatures;
}

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


import { FeatureSet } from './containerFeaturesConfiguration';
import { DevContainerConfig } from './configuration';

interface FeatureNode {
    feature: FeatureSet;
    before: Set<FeatureNode>;
    after: Set<FeatureNode>;
}

export function computeFeatureInstallationOrder_deprecated(config: DevContainerConfig, features: FeatureSet[]) {

    if (config.overrideFeatureInstallOrder) {
        return computeOverrideInstallationOrder_deprecated(config, features);
    }
    else {
        return computeInstallationOrder_deprecated(features);
    }
}

// Exported for unit tests.
export function computeOverrideInstallationOrder_deprecated(config: DevContainerConfig, features: FeatureSet[]) {
    // Starts with the automatic installation order.
    const automaticOrder = computeInstallationOrder_deprecated(features);

    // Moves to the beginning the features that are explicitly configured.
    const orderedFeatures = [];
    for (const featureId of config.overrideFeatureInstallOrder!) {
        // Reference: https://github.com/devcontainers/spec/blob/main/proposals/devcontainer-features.md#1-overridefeatureinstallorder
        const feature = automaticOrder.find(feature => feature.sourceInformation.userFeatureIdWithoutVersion === featureId || feature.sourceInformation.userFeatureId === featureId);
        if (!feature) {
            throw new Error(`Feature ${featureId} not found`);
        }
        orderedFeatures.push(feature);
        features.splice(features.indexOf(feature), 1);
    }

    return orderedFeatures.concat(features);
}

// Exported for unit tests.
export function computeInstallationOrder_deprecated(features: FeatureSet[]) {
    const nodesById = features.map<FeatureNode>(feature => ({
        feature,
        before: new Set(),
        after: new Set(),
    })).reduce((map, feature) => map.set(feature.feature.sourceInformation.userFeatureId.split(':')[0], feature), new Map<string, FeatureNode>());

    let nodes = [...nodesById.values()];

    // Currently legacyIds only contain an id, hence append `registry/namespace` to it.
    nodes = nodes.map(node => {
        if (node.feature.sourceInformation.type === 'oci' && node.feature.features[0].legacyIds && node.feature.features[0].legacyIds.length > 0) {
            const featureRef = node.feature.sourceInformation.featureRef;
            if (featureRef) {
                node.feature.features[0].legacyIds = node.feature.features[0].legacyIds.map(legacyId => `${featureRef.registry}/${featureRef.namespace}/` + legacyId);
                node.feature.features[0].currentId = `${featureRef.registry}/${featureRef.namespace}/${node.feature.features[0].currentId}`;
            }
        }
        return node;
    });

    for (const later of nodes) {
        for (const firstId of later.feature.features[0].installsAfter || []) {
            let first = nodesById.get(firstId);

            // Check for legacyIds (back compat)
            if (!first) {
                first = nodes.find(node => node.feature.features[0].legacyIds?.includes(firstId));
            }

            // Check for currentId (forward compat)
            if (!first) {
                first = nodes.find(node => node.feature.features[0].currentId === firstId);
            }

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
                .sort((a, b) => a.sourceInformation.userFeatureId < b.sourceInformation.userFeatureId ? -1 : 1) // stable order
        );
        current = next;
    }

    orderedFeatures.push(
        ...islands.map(node => node.feature)
            .sort((a, b) => a.sourceInformation.userFeatureId < b.sourceInformation.userFeatureId ? -1 : 1) // stable order
    );

    const missing = new Set(nodesById.keys());
    for (const feature of orderedFeatures) {
        missing.delete(feature.sourceInformation.userFeatureId.split(':')[0]);
    }

    if (missing.size !== 0) {
        throw new Error(`Features declare cyclic dependency: ${[...missing].join(', ')}`);
    }

    return orderedFeatures;
}
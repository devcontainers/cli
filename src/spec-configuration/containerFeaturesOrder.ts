/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Feature, FeatureSet, OCISourceInformation } from '../spec-configuration/containerFeaturesConfiguration';
import { LogLevel } from '../spec-utils/log';
import { DevContainerConfig, DevContainerFeature } from './configuration';
import { CommonParams } from './containerCollectionsOCI';

interface FeatureNode {
    feature: FeatureSet;
    before: Set<FeatureNode>;
    after: Set<FeatureNode>;
}

export function computeFeatureInstallationOrder(config: DevContainerConfig, features: FeatureSet[]) {

    if (config.overrideFeatureInstallOrder) {
        return computeOverrideInstallationOrder(config, features);
    }
    else {
        return computeInstallationOrder(features);
    }
}

// Exported for unit tests.
export function computeOverrideInstallationOrder(config: DevContainerConfig, features: FeatureSet[]) {
    // Starts with the automatic installation order.
    const automaticOrder = computeInstallationOrder(features);

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

// Represents a Feature provided by the user in their devcontainer.json.
interface UserProvidedFNode extends FNode {
    type: 'user-provided';
}

// Represents a 'no-op' Feature injected into the dependency graph to influence installation order.
interface ArtificialFNode extends FNode {
    type: 'artificial';
}

export interface FNode {
    type: 'user-provided' | 'artificial' | '';
    userFeatureId: string;
    options: string | boolean | Record<string, string | boolean | undefined>;

    // FeatureSet contains 'sourceInformation', useful for:
    //      Providing information on if Feature is an OCI Feature, Direct HTTPS Feature, or Local Feature.
    //      Additionally, contains 'ref' and 'manifestDigest' for OCI Features - useful for sorting.
    // Property set programatically when discovering all the nodes in the graph.
    featureSet?: FeatureSet;

    // Graph directed adjacency lists.
    dependsOn: FNode[];
    installsAfter: FNode[];
}

function equals(a: FNode, b: FNode) {
    const aSourceInfo = a.featureSet?.sourceInformation;
    let bSourceInfo = b.featureSet?.sourceInformation; // Mutable only for type-casting.

    if (!aSourceInfo || !bSourceInfo) {
        // TODO: This indicates a bug - remove once confident this is not happening!
        throw new Error('ERR: Missing source information!');
    }

    if (aSourceInfo.type !== bSourceInfo.type) {
        // Not equal, cannot compare.
        // TODO: But should we?
        return false;
    }

    return comparesTo(a, b) === 0;
}

function satisfiesSoftDependency(a: FNode, b: FNode) {
    const aSourceInfo = a.featureSet?.sourceInformation;
    let bSourceInfo = b.featureSet?.sourceInformation; // Mutable only for type-casting.

    if (!aSourceInfo || !bSourceInfo) {
        // TODO: This indicates a bug - remove once confident this is not happening!
        throw new Error('ERR: Missing source information!');
    }

    if (aSourceInfo.type !== bSourceInfo.type) {
        // TODO
        return false;
    }

    switch (aSourceInfo.type) {
        case 'oci':
            bSourceInfo = bSourceInfo as OCISourceInformation;
            return aSourceInfo.featureRef.resource === bSourceInfo.featureRef.resource;
        case 'direct-tarball':
        case 'file-path':
            throw new Error(`TODO: Should be supported but is unimplemented!`);
        default:
            throw new Error(`Feature dependencies are only supported in Features published (1) to an OCI registry, (2) as direct HTTPS tarball, or (3) as a local Feature.  Got type: '${aSourceInfo.type}'.`);
    }
}

// If the two features are equal, return 0.
// If the sorting algorithm should place A _before_ B, return negative number.
// If the sorting algorithm should place A _after_  B, return positive number.
function comparesTo(a: FNode, b: FNode): number {
    const aSourceInfo = a.featureSet?.sourceInformation;
    let bSourceInfo = b.featureSet?.sourceInformation; // Mutable only for type-casting.

    if (!aSourceInfo || !bSourceInfo) {
        // TODO: This indicates a bug - remove once confident this is not happening!
        throw new Error('ERR: Missing source information!');
    }

    switch (aSourceInfo.type) {
        case 'oci':
            bSourceInfo = bSourceInfo as OCISourceInformation;

            const aResource = aSourceInfo.featureRef.resource;
            const bResource = bSourceInfo.featureRef.resource;

            const aDigest = aSourceInfo.manifestDigest;
            const bDigest = bSourceInfo.manifestDigest;

            const aOptions = JSON.stringify(a.options);
            const bOptions = JSON.stringify(b.options);

            const aCanonicalId = `${aResource}@${aDigest}`;
            const bCanonicalId = `${bResource}@${bDigest}`;

            if (aCanonicalId === bCanonicalId && aOptions === bOptions) {
                // Equal!
                return 0;
            }

            // Sort by resource name
            if (aResource !== bResource) {
                return aResource.localeCompare(bResource);
            }

            const aTag = aSourceInfo.featureRef.tag;
            const bTag = bSourceInfo.featureRef.tag;
            // Sort by tags (if both have tags)
            // Eg: 1.9.9, 2.0.0, 2.0.1, 3, latest
            if ((aTag && bTag) && (aTag !== bTag)) {
                return aTag.localeCompare(bTag);
            }

            // Sort by options
            // TODO: Compares options Record by stringifying them.  This isn't fully correct.
            if (aOptions !== bOptions) {
                return aOptions.localeCompare(bOptions);
            }

            // Sort by manifest digest hash
            if (aDigest !== bDigest) {
                return aDigest.localeCompare(bDigest);
            }

            // Consider these two OCI Features equal.
            return 0;

        case 'direct-tarball':
            throw new Error(`Feature type 'direct-tarball' will be supported but is unimplemented.`);

        case 'file-path':
            throw new Error(`'Feature type 'file-path' will be supported but is unimplemented.`);

        default:
            throw new Error(`Feature dependencies are only supported in Features published (2) to an OCI registry, (2) as direct HTTPS tarball, or (3) as a local Feature.  Got type: '${aSourceInfo.type}'.`);
    }
}

function featureSupportsDependencies(feature: FeatureSet): boolean {
    const publishType = feature.sourceInformation.type;
    return publishType === 'oci' || publishType === 'direct-tarball' || publishType === 'file-path';
}

async function _buildDependencyGraph(params: CommonParams, processFeature: (userFeature: DevContainerFeature) => Promise<FeatureSet | undefined>, worklist: FNode[], acc: FNode[]): Promise<FNode[]> {
    const { output } = params;

    while (worklist.length > 0) {
        const current = worklist.shift()!;

        output.write(`Resolving dependencies for '${current.userFeatureId}'...`, LogLevel.Info);

        const processedFeature = await processFeature(current);
        if (!processedFeature) {
            throw new Error(`ERR: Feature '${current.userFeatureId}' in dependency graph could not be processed.  You may not have permission to access this Feature.  Please report this to the Feature author.`);
        }

        // Set the processed FeatureSet object onto Node.
        current.featureSet = processedFeature;

        if (!featureSupportsDependencies(processedFeature)) {
            throw new Error(`ERR: Feature '${current.userFeatureId}' in dependency graph does not support dependencies.  Please report this to the Feature author.`);
        }

        // If the current Feature is already in the accumulator, skip it.
        // This stops cycles but doesn't report them.  
        // Cycles/inconsistencies are thrown as errors in the next stage (rounds).
        if (acc.some(f => equals(f, current))) {
            continue;
        }

        const type = processedFeature.sourceInformation.type;
        switch (type) {
            case 'oci':
                const manifest = (current.featureSet.sourceInformation as OCISourceInformation).manifest;
                const metadataSerialized = manifest.annotations?.['dev.containers.experimental.metadata'];
                if (!metadataSerialized) {
                    acc.push(current);
                    continue;
                }

                const featureMetadata = JSON.parse(metadataSerialized) as Feature;

                const dependsOn = featureMetadata.dependsOn || {};
                const installsAfter = featureMetadata.installsAfter || [];

                // Add a new node for each 'dependsOn' dependency onto the 'current' node.
                // Add this new node to the worklist to further process.
                for (const [userFeatureId, options] of Object.entries(dependsOn)) {
                    const dependency: FNode = {
                        type: '',
                        userFeatureId,
                        options,
                        featureSet: undefined,
                        dependsOn: [],
                        installsAfter: [],
                    };
                    current.dependsOn.push(dependency);
                    worklist.push(dependency);
                }

                // Add a new node for each 'installsAfter' soft-dependency onto the 'current' node.
                // Soft-dependencies are NOT recursively processed - do not add to worklist.
                for (const userFeatureId of installsAfter) {
                    const dependency: FNode = {
                        type: '',
                        userFeatureId,
                        options: {},
                        featureSet: undefined,
                        dependsOn: [],
                        installsAfter: [],
                    };
                    const processedFeature = await processFeature(dependency);
                    if (!processedFeature) {
                        throw new Error(`installsAfter dependency '${userFeatureId}' of Feature '${current.userFeatureId}' could not be processed.`);
                    }
                    dependency.featureSet = processedFeature;
                    current.installsAfter.push(dependency);
                }

                acc.push(current);
                await _buildDependencyGraph(params, processFeature, worklist, acc);
                break;

            case 'direct-tarball':
                throw new Error(`Feature type 'direct-tarball' will be supported but is unimplemented.`);

            case 'file-path':
                throw new Error(`'Feature type 'file-path' will be supported but is unimplemented.`);

            default:
                throw new Error(`Feature dependencies are only supported in Features published (2) to an OCI registry, (2) as direct HTTPS tarball, or (3) as a local Feature.  Got type: '${processedFeature.sourceInformation.type}'.`);
        }
    }
    return acc;
}

// Creates the directed asyclic graph (DAG) of Features and their dependencies.
export async function buildDependencyGraph(
    params: CommonParams,
    processFeature: (userFeature: DevContainerFeature) => Promise<FeatureSet | undefined>,
    userFeatures: DevContainerFeature[],
    config?: { overrideFeatureInstallOrder?: string[] }): Promise<FNode[] | undefined> {

    const artificialOverrideFeatures = config?.overrideFeatureInstallOrder?.map<ArtificialFNode>(f => {
        return {
            type: 'artificial',
            userFeatureId: f,
            options: {},
            dependsOn: [],
            installsAfter: [],
        };
    }) || [];

    const rootNodes =
        userFeatures.map<UserProvidedFNode>(f => {
            return {
                type: 'user-provided', // This Feature was provided by the user in the 'features' object of devcontainer.json.
                userFeatureId: f.userFeatureId,
                options: f.options,
                dependsOn: [],
                installsAfter: artificialOverrideFeatures, // Soft dependency on the config's override property, if any.
            };
        });

    const nodes: FNode[] = [];
    return await _buildDependencyGraph(params, processFeature, rootNodes, nodes);
}

export async function computeDependsOnInstallationOrder(
    params: CommonParams,
    processFeature: (userFeature: DevContainerFeature) => Promise<FeatureSet | undefined>,
    userFeatures: DevContainerFeature[],
    config?: { overrideFeatureInstallOrder?: string[] }): Promise<FNode[] | undefined> {

    const { output } = params;

    // Build dependency graph and resolves all to featureSets.
    const worklist = await buildDependencyGraph(params, processFeature, userFeatures, config);
    if (!worklist || worklist.length === 0) {
        return;
    }

    // Sanity check
    if (worklist.some(node => !node.featureSet)) {
        throw new Error(`ERR: Some nodes in the dependency graph are malformed.`);
    }

    output.write(`[1]: ${worklist.map(n => n.userFeatureId).join(', ')}`, LogLevel.Info);

    // Remove all 'soft-dependency' graph edges that are irrelevant (i.e. the node is not in the worklist)
    for (let i = 0; i < worklist.length; i++) {
        const node = worklist[i];

        // output.write(`Resolving soft - dependencies for '${node.userFeatureId}'...`, LogLevel.Info);

        // reverse iterate
        for (let j = node.installsAfter.length - 1; j >= 0; j--) {
            const softDep = node.installsAfter[j];
            if (!worklist.some(n => satisfiesSoftDependency(n, softDep))) {
                output.write(`Soft-dependency '${softDep.userFeatureId}' is unnecessary.  Removing from installation order...`, LogLevel.Info);
                // Delete that soft-dependency
                node.installsAfter.splice(j, 1);
            }
        }
    }


    output.write(`[2]: ${worklist.map(n => n.userFeatureId).join(', ')}`, LogLevel.Info);

    const installationOrder: FNode[] = [];
    while (worklist.length > 0) {
        const round = worklist.filter(node =>
            // If the node has no hard/soft dependencies, the node can always be installed.
            (node.dependsOn.length === 0 && node.installsAfter.length === 0)
            // Or, every hard-dependency (dependsOn) and soft-dependency (installsAfter) has been satified in prior rounds
            || node.dependsOn.every(dep =>
                installationOrder.some(installed => equals(installed, dep)))
            && node.installsAfter.every(dep =>
                installationOrder.some(installed => equals(installed, dep)))); // TODO: This means that we MUST satisfy the soft-dependency.

        output.write(`Round: ${round.map(r => r.userFeatureId).join(', ')}`, LogLevel.Info);

        if (round.length === 0) {
            output.write('Circular dependency detected!', LogLevel.Error);
            output.write(`Nodes remaining: ${worklist.map(n => n.userFeatureId!).join(', ')}`, LogLevel.Error);
            return;
        }

        // Delete all nodes present in this round from the worklist.
        worklist.splice(0, worklist.length, ...worklist.filter(node => !round.some(r => equals(r, node))));

        // Sort rounds lexicographically by id.
        round.sort((a, b) => comparesTo(a, b));

        installationOrder.push(...round);
    }

    return installationOrder;
}

// Exported for unit tests.
export function computeInstallationOrder(features: FeatureSet[]) {
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
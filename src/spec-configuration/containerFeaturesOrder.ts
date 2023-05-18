/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';
import * as jsonc from 'jsonc-parser';
import * as os from 'os';

import { DEVCONTAINER_FEATURE_FILE_NAME, Feature, FeatureSet, FilePathSourceInformation, OCISourceInformation } from '../spec-configuration/containerFeaturesConfiguration';
import { LogLevel } from '../spec-utils/log';
import { DevContainerConfig, DevContainerFeature } from './configuration';
import { CommonParams } from './containerCollectionsOCI';
import { isLocalFile, readLocalFile } from '../spec-utils/pfs';
import { fetchOCIFeature } from './containerFeaturesOCI';

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
// interface ArtificialFNode extends FNode {
//     type: 'artificial';
// }

export interface FNode {
    type: 'user-provided' | 'artificial' | 'resolved';
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
        throw new Error(`ERR: Missing source information! (${a.userFeatureId} ?= ${b.userFeatureId})`);
    }

    if (aSourceInfo.type !== bSourceInfo.type) {
        // Not equal, cannot compare.
        // TODO: But should we?
        return false;
    }

    return comparesTo(a, b) === 0;
}

function satisfiesSoftDependency(node: FNode, softDep: FNode) {
    const nodeSourceInfo = node.featureSet?.sourceInformation;
    let softDepSourceInfo = softDep.featureSet?.sourceInformation; // Mutable only for type-casting.

    if (!nodeSourceInfo || !softDepSourceInfo) {
        // TODO: This indicates a bug - remove once confident this is not happening!
        throw new Error(`ERR: Missing source information! (${node.userFeatureId} ?~> ${softDep.userFeatureId})`);
    }

    if (nodeSourceInfo.type !== softDepSourceInfo.type) {
        // TODO
        return false;
    }

    if (!featureSupportsDependencies(node.featureSet) || !featureSupportsDependencies(softDep.featureSet)) {
        return false;
    }

    switch (nodeSourceInfo.type) {
        case 'oci':
            softDepSourceInfo = softDepSourceInfo as OCISourceInformation;
            return nodeSourceInfo.featureRef.resource === softDepSourceInfo.featureRef.resource;
        case 'direct-tarball':
            throw new Error(`TODO: Should be supported but is unimplemented!`);
        case 'file-path':
            softDepSourceInfo = softDepSourceInfo as FilePathSourceInformation;
            return nodeSourceInfo.resolvedFilePath === softDepSourceInfo.resolvedFilePath;
        default:
            throw new Error(`Feature dependencies are only supported in Features published (1) to an OCI registry, (2) as direct HTTPS tarball, or (3) as a local Feature.  Got type: '${nodeSourceInfo.type}'.`);
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
        throw new Error(`ERR: Missing source information! (${a.userFeatureId} ?~ ${b.userFeatureId})`);
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
            bSourceInfo = bSourceInfo as FilePathSourceInformation;
            return aSourceInfo.resolvedFilePath.localeCompare(bSourceInfo.resolvedFilePath);

        default:
            throw new Error(`Feature dependencies are only supported in Features published (2) to an OCI registry, (2) as direct HTTPS tarball, or (3) as a local Feature.  Got type: '${aSourceInfo.type}'.`);
    }
}

function featureSupportsDependencies(featureSet?: FeatureSet): boolean {
    if (!featureSet) {
        return false;
    }

    const publishType = featureSet.sourceInformation.type;
    // TODO: Implement 'direct-tarball'.
    return publishType === 'oci' /*|| publishType === 'direct-tarball'*/ || publishType === 'file-path';
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

        // If the Feature doesn't support dependencies, still add it to the
        // accumulator (to list of Features to install later), but do not attempt
        // to process its dependencies (since it cannot have any!)
        if (!featureSupportsDependencies(processedFeature)) {
            acc.push(current);
            continue;
        }

        // If the current Feature is already in the accumulator, skip it.
        // This stops cycles but doesn't report them.  
        // Cycles/inconsistencies are thrown as errors in the next stage (rounds).
        if (acc.some(f => equals(f, current))) {
            continue;
        }

        const type = processedFeature.sourceInformation.type;
        let metadata: Feature | undefined;
        // Switch on the source type of the provided Feature.
        // Retrieving the metadata for the Feature (the contents of 'devcontainer-feature.json')
        switch (type) {
            case 'oci':
                const manifest = (current.featureSet.sourceInformation as OCISourceInformation).manifest;
                const annotation = manifest.annotations?.['dev.containers.experimental.metadata'];
                if (annotation) {
                    metadata = jsonc.parse(annotation) as Feature;
                } else {
                    // For backwards compatibility,
                    // If the metadata is not present on the manifest, we have to fetch the entire blob
                    // to extract the 'installsAfter' property.
                    const tmp = path.join(os.tmpdir(), Math.random().toString(36).substring(2, 15));
                    // TODO: This can be cached!!
                    const f = await fetchOCIFeature(params, current.featureSet, tmp, tmp, DEVCONTAINER_FEATURE_FILE_NAME);

                    output.write(JSON.stringify(f, null, 2), LogLevel.Trace);

                    if (f && f.metadata) {
                        metadata = f.metadata as Feature;
                    }
                }
                break;

            case 'direct-tarball':
                throw new Error(`Feature type 'direct-tarball' will be supported but is unimplemented.`);

            case 'file-path':
                const filePath = (current.featureSet.sourceInformation as FilePathSourceInformation).resolvedFilePath;
                const metadataFilePath = path.join(filePath, DEVCONTAINER_FEATURE_FILE_NAME);
                if (!isLocalFile(filePath)) {
                    throw new Error(`Metadata file '${metadataFilePath}' cannot be read for Feature '${current.userFeatureId}'.`);
                }
                const serialized = (await readLocalFile(metadataFilePath)).toString();
                if (serialized) {
                    metadata = jsonc.parse(serialized) as Feature;
                }
                break;

            default:
                throw new Error(`Feature dependencies are only supported in Features published (2) to an OCI registry, (2) as direct HTTPS tarball, or (3) as a local Feature.  Got type: '${processedFeature.sourceInformation.type}'.`);
        }

        // Resolve dependencies given the current Feature's metadata.
        if (metadata) {
            output.write(`METADATA: ${JSON.stringify(metadata, null, 2)}`, LogLevel.Trace);


            // Dependency-related properties
            const dependsOn = metadata.dependsOn || {};
            const installsAfter = metadata.installsAfter || [];

            // Add a new node for each 'dependsOn' dependency onto the 'current' node.
            // **Add this new node to the worklist to process recursively**
            for (const [userFeatureId, options] of Object.entries(dependsOn)) {
                const dependency: FNode = {
                    type: 'resolved',
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
            // Soft-dependencies are NOT recursively processed - do *not* add to worklist.
            for (const userFeatureId of installsAfter) {
                const dependency: FNode = {
                    type: 'resolved',
                    userFeatureId,
                    options: {},
                    featureSet: undefined,
                    dependsOn: [],
                    installsAfter: [],
                };
                const processedFeatureSet = await processFeature(dependency);
                if (!processedFeatureSet) {
                    throw new Error(`installsAfter dependency '${userFeatureId}' of Feature '${current.userFeatureId}' could not be processed.`);
                }
                dependency.featureSet = processedFeatureSet;
                current.installsAfter.push(dependency);
            }
        }

        acc.push(current);
        await _buildDependencyGraph(params, processFeature, worklist, acc);
    }

    // Return the accumulated collection of dependencies.
    return acc;
}

// Creates the directed asyclic graph (DAG) of Features and their dependencies.
export async function buildDependencyGraph(
    params: CommonParams,
    processFeature: (userFeature: DevContainerFeature) => Promise<FeatureSet | undefined>,
    userFeatures: DevContainerFeature[]): Promise<FNode[] | undefined> {

    const { output } = params;

    const rootNodes =
        userFeatures.map<UserProvidedFNode>(f => {
            return {
                type: 'user-provided', // This Feature was provided by the user in the 'features' object of devcontainer.json.
                userFeatureId: f.userFeatureId,
                options: f.options,
                dependsOn: [],
                installsAfter: []
            };
        });

    output.write(`User provided FNodes: ${rootNodes.map(n => n.userFeatureId).join(', ')}`, LogLevel.Trace);


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
    const worklist = await buildDependencyGraph(params, processFeature, userFeatures);
    if (!worklist || worklist.length === 0) {
        output.write('Zero length or undefined worklist.', LogLevel.Error);
        return;
    }

    output.write(`${JSON.stringify(worklist, null, 4)}`, LogLevel.Trace);

    // Sanity check
    if (worklist.some(node => !node.featureSet)) {
        throw new Error(`ERR: Some nodes in the dependency graph are malformed.`);
    }

    output.write(`[raw worklist]: ${worklist.map(n => n.userFeatureId).join(', ')}`, LogLevel.Info);

    // TODO
    // Handle 'overrideFeatureInstallOrder' config option.
    // let overrideFeatureTailNode: ArtificialFNode | undefined = undefined;
    if (config?.overrideFeatureInstallOrder) {
        output.write('TODO: OVERRIDE FEATURE INSTALL ORDER', LogLevel.Warning);
    }

    // Filter and then splice out
    //  - Legacy (v1) Features
    //  - Features that do not support dependencies.
    let legacyFeatures: FNode[] = [];
    // reverse iterate
    for (let j = worklist.length - 1; j >= 0; j--) {
        const node = worklist[j];
        if (node.featureSet?.internalVersion === '1' || !featureSupportsDependencies(node.featureSet)) {
            output.write(`Feature '${node.userFeatureId}' does not support dependencies. Excluding from dependency resolution...`, LogLevel.Info);
            // remove from worklist
            worklist.splice(j, 1);
            // add to legacyFeatures (to be re-appended at the end)
            legacyFeatures.push(node);
        }
    }

    output.write(`[worklist-without-legacy]: ${worklist.map(n => n.userFeatureId).join(', ')}`, LogLevel.Info);
    output.write(`[legacy]: ${legacyFeatures.map(n => n.userFeatureId).join(', ')}`, LogLevel.Info);

    // For each node in the worklist, remove all 'soft-dependency' graph edges that are irrelevant
    // i.e. the node is not a 'soft match' for any node in the worklist itself
    for (let i = 0; i < worklist.length; i++) {
        const node = worklist[i];
        // reverse iterate
        for (let j = node.installsAfter.length - 1; j >= 0; j--) {
            const softDep = node.installsAfter[j];
            if (!worklist.some(n => satisfiesSoftDependency(n, softDep))) {
                output.write(`Soft-dependency '${softDep.userFeatureId}' is not required.  Removing from installation order...`, LogLevel.Info);
                // Delete that soft-dependency
                node.installsAfter.splice(j, 1);
            }
        }
    }

    output.write(`[worklist-without-legacy-and-dangling-soft-deps]: ${worklist.map(n => n.userFeatureId).join(', ')}`, LogLevel.Info);

    const installationOrder: FNode[] = [];
    while (worklist.length > 0) {
        const round = worklist.filter(node =>
            // If the node has no hard/soft dependencies, the node can always be installed.
            (node.dependsOn.length === 0 && node.installsAfter.length === 0)
            // OR, every hard-dependency (dependsOn) AND soft-dependency (installsAfter) has been satified in prior rounds
            || node.dependsOn.every(dep =>
                installationOrder.some(installed => equals(installed, dep)))
            && node.installsAfter.every(dep =>
                installationOrder.some(installed => satisfiesSoftDependency(installed, dep))));

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

    return installationOrder.concat(legacyFeatures.reverse());
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
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';
import * as jsonc from 'jsonc-parser';
import * as os from 'os';
import * as crypto from 'crypto';

import { DEVCONTAINER_FEATURE_FILE_NAME, DirectTarballSourceInformation, Feature, FeatureSet, FilePathSourceInformation, OCISourceInformation } from '../spec-configuration/containerFeaturesConfiguration';
import { LogLevel } from '../spec-utils/log';
import { DevContainerFeature } from './configuration';
import { CommonParams } from './containerCollectionsOCI';
import { isLocalFile, readLocalFile } from '../spec-utils/pfs';
import { fetchOCIFeature } from './containerFeaturesOCI';

interface FNode {
	type: 'user-provided' | 'override' | 'resolved';
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

	legacyIdAliases?: string[];

	// Round Order Priority
	// Effective value is always the max
	roundPriority: number;
}

interface DependencyGraph {
	worklist: FNode[];
	legacyWorklist: FNode[];
}

function equals(params: CommonParams, a: FNode, b: FNode): boolean {
	const { output } = params;

	const aSourceInfo = a.featureSet?.sourceInformation;
	let bSourceInfo = b.featureSet?.sourceInformation; // Mutable only for type-casting.

	if (!aSourceInfo || !bSourceInfo) {
		output.write(`Missing sourceInfo: equals(${aSourceInfo?.userFeatureId}, ${bSourceInfo?.userFeatureId})`, LogLevel.Trace);
		throw new Error('ERR: Failure resolving Features.');
	}

	if (aSourceInfo.type !== bSourceInfo.type) {
		return false;
	}

	return comparesTo(params, a, b) === 0;
}

function satisfiesSoftDependency(params: CommonParams, node: FNode, softDep: FNode): boolean {
	const { output } = params;

	const nodeSourceInfo = node.featureSet?.sourceInformation;
	let softDepSourceInfo = softDep.featureSet?.sourceInformation; // Mutable only for type-casting.

	if (!nodeSourceInfo || !softDepSourceInfo) {
		output.write(`Missing sourceInfo: satisifiesSoftDependency(${nodeSourceInfo?.userFeatureId}, ${softDepSourceInfo?.userFeatureId})`, LogLevel.Trace);
		throw new Error('ERR: Failure resolving Features.');
	}

	if (nodeSourceInfo.type !== softDepSourceInfo.type) {
		return false;
	}

	if (!featureSupportsDependencies(node.featureSet) || !featureSupportsDependencies(softDep.featureSet)) {
		return false;
	}

	switch (nodeSourceInfo.type) {
		case 'oci':
			softDepSourceInfo = softDepSourceInfo as OCISourceInformation;
			const nodeFeatureRef = nodeSourceInfo.featureRef;
			const softDepFeatureRef = softDepSourceInfo.featureRef;
			const softDepFeatureRefPrefix = `${softDepFeatureRef.registry}/${softDepFeatureRef.namespace}`;

			return nodeFeatureRef.resource === softDepFeatureRef.resource // Same resource
				|| softDep.legacyIdAliases?.some(legacyId => `${softDepFeatureRefPrefix}/${legacyId}` === nodeFeatureRef.resource) // Handle 'legacyIds'
				|| false;

		case 'file-path':
			softDepSourceInfo = softDepSourceInfo as FilePathSourceInformation;
			return nodeSourceInfo.resolvedFilePath === softDepSourceInfo.resolvedFilePath;

		default:
			throw new Error(`Unexpected sourceInfo type: '${nodeSourceInfo.type}'.`);
	}
}

function optionsCompareTo(a: string | boolean | Record<string, string | boolean | undefined>, b: string | boolean | Record<string, string | boolean | undefined>): number {
	if (typeof a === 'string' && typeof b === 'string') {
		return a.localeCompare(b);
	}

	if (typeof a === 'boolean' && typeof b === 'boolean') {
		return a === b ? 0 : a ? 1 : -1;
	}

	if (typeof a === 'object' && typeof b === 'object') {
		// Compare lengths
		const aKeys = Object.keys(a);
		const bKeys = Object.keys(b);
		if (aKeys.length !== bKeys.length) {
			return aKeys.length - bKeys.length;
		}

		aKeys.sort();
		bKeys.sort();

		for (let i = 0; i < aKeys.length; i++) {
			// Compare keys
			if (aKeys[i] !== bKeys[i]) {
				return aKeys[i].localeCompare(bKeys[i]);
			}
			// Compare values
			const aVal = a[aKeys[i]];
			const bVal = b[bKeys[i]];
			if (typeof aVal === 'string' && typeof bVal === 'string') {
				const v = aVal.localeCompare(bVal);
				if (v !== 0) {
					return v;
				}
			}
			if (typeof aVal === 'boolean' && typeof bVal === 'boolean') {
				const v = aVal === bVal ? 0 : aVal ? 1 : -1;
				if (v !== 0) {
					return v;
				}
			}

			if (typeof aVal === undefined) {
				return 1;
			}

			if (typeof bVal === undefined) {
				return -1;
			}
		}
		// Object is piece-wise equal
		return 0;
	}
	return (typeof a).localeCompare(typeof b);
}

// If the two features are equal, return 0.
// If the sorting algorithm should place A _before_ B, return negative number.
// If the sorting algorithm should place A _after_  B, return positive number.
function comparesTo(params: CommonParams, a: FNode, b: FNode): number {
	const { output } = params;

	const aSourceInfo = a.featureSet?.sourceInformation;
	let bSourceInfo = b.featureSet?.sourceInformation; // Mutable only for type-casting.

	if (!aSourceInfo || !bSourceInfo) {
		output.write(`Missing sourceInfo: comparesTo(${aSourceInfo?.userFeatureId}, ${bSourceInfo?.userFeatureId})`, LogLevel.Trace);
		throw new Error('ERR: Failure resolving Features.');
	}

	if (aSourceInfo.type !== bSourceInfo.type) {
		return aSourceInfo.userFeatureId.localeCompare(bSourceInfo.userFeatureId);
	}

	switch (aSourceInfo.type) {
		case 'oci':
			bSourceInfo = bSourceInfo as OCISourceInformation;

			const aResource = aSourceInfo.featureRef.resource;
			const bResource = bSourceInfo.featureRef.resource;

			const aDigest = aSourceInfo.manifestDigest;
			const bDigest = bSourceInfo.manifestDigest;

			const aCanonicalId = `${aResource}@${aDigest}`;
			const bCanonicalId = `${bResource}@${bDigest}`;

			// Equal
			if (aCanonicalId === bCanonicalId) {
				if (optionsCompareTo(a.options, b.options) === 0) {
					return 0;
				}
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
			const optionsVal = optionsCompareTo(a.options, b.options);
			if (optionsVal !== 0) {
				return optionsVal;
			}

			// Sort by manifest digest hash
			if (aDigest !== bDigest) {
				return aDigest.localeCompare(bDigest);
			}

			// Consider these two OCI Features equal.
			return 0;

		case 'file-path':
			bSourceInfo = bSourceInfo as FilePathSourceInformation;
			const pathCompare = aSourceInfo.resolvedFilePath.localeCompare(bSourceInfo.resolvedFilePath);
			if (pathCompare !== 0) {
				return pathCompare;
			}
			return optionsCompareTo(a.options, b.options);

		default:
			throw new Error(`Unexpected sourceInfo type: '${aSourceInfo.type}'.`);
	}
}

function featureSupportsDependencies(featureSet?: FeatureSet): boolean {
	if (!featureSet) {
		return false;
	}
	const publishType = featureSet.sourceInformation.type;
	// TODO: Support direct-tarball
	return publishType === 'oci' /*|| publishType === 'direct-tarball'*/ || publishType === 'file-path';
}

async function applyOverrideFeatureInstallOrder(
	params: CommonParams,
	processFeature: (userFeature: DevContainerFeature) => Promise<FeatureSet | undefined>,
	worklist: FNode[],
	config: { overrideFeatureInstallOrder?: string[] },
) {
	const { output } = params;

	if (!config.overrideFeatureInstallOrder) {
		return worklist;
	}

	// Create an override node for each Feature in the override property.
	// Reverse iterate to remove out items from config that have been processed.
	const originalLength = config.overrideFeatureInstallOrder.length;
	for (let i = config.overrideFeatureInstallOrder.length - 1; i >= 0; i--) {
		const overrideFeatureId = config.overrideFeatureInstallOrder[i];

		// First element == N, last element == 1
		const roundPriority = originalLength - i;

		const tmpOverrideNode: FNode = {
			type: 'override',
			userFeatureId: overrideFeatureId,
			options: {},
			roundPriority,
			installsAfter: [],
			dependsOn: [],
			featureSet: undefined,
		};

		const processed = await processFeature(tmpOverrideNode);
		if (!processed) {
			throw new Error(`Feature '${tmpOverrideNode.userFeatureId}' in 'overrideFeatureInstallOrder' could not be processed.`);
		}

		if (!featureSupportsDependencies(processed)) {
			// Process legacy Features later.
			continue;
		}

		tmpOverrideNode.featureSet = processed;
		// Remove from the config list to not double process when handling legacy Features.
		config.overrideFeatureInstallOrder.splice(i, 1);

		// Scan the worklist, incrementing the priority of each Feature that matches the override.
		for (const node of worklist) {
			if (satisfiesSoftDependency(params, node, tmpOverrideNode)) {
				// Increase the priority of this node to install it sooner.
				output.write(`[override]: '${node.userFeatureId}' has override priority of ${roundPriority}`, LogLevel.Trace);
				node.roundPriority = Math.max(node.roundPriority, roundPriority);
			}
		}
	}

	// Return the modified worklist.
	return worklist;
}

async function _buildDependencyGraph(
	params: CommonParams,
	processFeature: (userFeature: DevContainerFeature) => Promise<FeatureSet | undefined>,
	worklist: FNode[],
	acc: FNode[],
	legacyAcc: FNode[]): Promise<DependencyGraph> {
	const { output } = params;

	while (worklist.length > 0) {
		const current = worklist.shift()!;

		output.write(`Resolving Feature dependencies for '${current.userFeatureId}'...`, LogLevel.Info);

		const processedFeature = await processFeature(current);
		if (!processedFeature) {
			throw new Error(`ERR: Feature '${current.userFeatureId}' could not be processed.  You may not have permission to access this Feature, or may not be logged in.  If the issue persists, report this to the Feature author.`);
		}

		// Set the processed FeatureSet object onto Node.
		current.featureSet = processedFeature;

		// If the Feature doesn't support dependencies,  add it to the
		// legacy accumulator but do not attempt to process its dependencies (since it cannot have any!)
		if (!featureSupportsDependencies(processedFeature)) {
			legacyAcc.push(current);
			continue;
		}

		// If the current Feature is already in the accumulator, skip it.
		// This stops cycles but doesn't report them.  
		// Cycles/inconsistencies are thrown as errors in the next stage (rounds).
		if (acc.some(f => equals(params, f, current))) {
			continue;
		}

		const type = processedFeature.sourceInformation.type;
		let metadata: Feature | undefined;
		// Switch on the source type of the provided Feature.
		// Retrieving the metadata for the Feature (the contents of 'devcontainer-feature.json')
		switch (type) {
			case 'oci':
				metadata = await getOCIFeatureMetadata(params, current);
				break;

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
				throw new Error(`Unexpected sourceInfo type: '${processedFeature.sourceInformation.type}'.`);
		}

		// Resolve dependencies given the current Feature's metadata.
		if (metadata) {
			current.featureSet.features[0] = {
				...current.featureSet.features[0],
				...metadata,
			};

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
					roundPriority: 0,
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
					roundPriority: 0,
				};
				const processedFeatureSet = await processFeature(dependency);
				if (!processedFeatureSet) {
					throw new Error(`installsAfter dependency '${userFeatureId}' of Feature '${current.userFeatureId}' could not be processed.`);
				}

				dependency.featureSet = processedFeatureSet;

				// Resolve and add all 'legacyIds' as aliases for the soft dependency relationship.
				// https://containers.dev/implementors/features/#steps-to-rename-a-feature
				const softDepMetadata = await getOCIFeatureMetadata(params, dependency);
				if (softDepMetadata) {
					const legacyIds = (softDepMetadata.legacyIds || []).concat(softDepMetadata.id);
					dependency.legacyIdAliases = legacyIds;
				}

				current.installsAfter.push(dependency);
			}
		}

		acc.push(current);
	}

	// Return the accumulated collection of dependencies.
	return {
		worklist: acc,
		legacyWorklist: legacyAcc
	};
}

async function getOCIFeatureMetadata(params: CommonParams, node: FNode): Promise<Feature | undefined> {
	const { output } = params;

	// TODO: Implement a caching layer here!
	//       This can be optimized to share work done here
	//       with the 'fetchFeatures()` stage later on.
	const srcInfo = node?.featureSet?.sourceInformation;
	if (!node.featureSet || !srcInfo || srcInfo.type !== 'oci') {
		return;
	}

	const manifest = srcInfo.manifest;
	const annotation = manifest?.annotations?.['dev.containers.metadata'];

	if (annotation) {
		return jsonc.parse(annotation) as Feature;
	} else {
		// For backwards compatibility,
		// If the metadata is not present on the manifest, we have to fetch the entire blob
		// to extract the 'installsAfter' property.
		// TODO: Cache this smarter to reuse later!
		const tmp = path.join(os.tmpdir(), crypto.randomUUID());
		const f = await fetchOCIFeature(params, node.featureSet, tmp, tmp, DEVCONTAINER_FEATURE_FILE_NAME);

		if (f && f.metadata) {
			return f.metadata as Feature;
		}
	}
	output.write('No metadata found for Feature', LogLevel.Trace);
	return;
}

// Creates the directed acyclic graph (DAG) of Features and their dependencies.
export async function buildDependencyGraph(
	params: CommonParams,
	processFeature: (userFeature: DevContainerFeature) => Promise<FeatureSet | undefined>,
	userFeatures: DevContainerFeature[],
	config: { overrideFeatureInstallOrder?: string[] }): Promise<DependencyGraph | undefined> {

	const { output } = params;

	const rootNodes =
		userFeatures.map<FNode>(f => {
			return {
				type: 'user-provided', // This Feature was provided by the user in the 'features' object of devcontainer.json.
				userFeatureId: f.userFeatureId,
				options: f.options,
				dependsOn: [],
				installsAfter: [],
				roundPriority: 0,
			};
		});

	output.write(`[* user-provided] ${rootNodes.map(n => n.userFeatureId).join(', ')}`, LogLevel.Trace);

	const { worklist, legacyWorklist } = await _buildDependencyGraph(params, processFeature, rootNodes, [], []);

	output.write(`[* resolved worklist] ${worklist.map(n => n.userFeatureId).join(', ')}`, LogLevel.Trace);
	output.write(`[* legacy worklist] ${legacyWorklist.map(n => n.userFeatureId).join(', ')}`, LogLevel.Trace);

	// Apply the 'overrideFeatureInstallOrder' to the (non-legacy) worklist.
	if (config?.overrideFeatureInstallOrder) {
		await applyOverrideFeatureInstallOrder(params, processFeature, worklist, config);
	}

	return { worklist, legacyWorklist };
}

// Returns the ordered list of FeatureSets to fetch and install, or undefined on error.
export async function computeDependsOnInstallationOrder(
	params: CommonParams,
	processFeature: (userFeature: DevContainerFeature) => Promise<FeatureSet | undefined>,
	userFeatures: DevContainerFeature[],
	config: { overrideFeatureInstallOrder?: string[] },
	precomputedGraph?: DependencyGraph): Promise<FeatureSet[] | undefined> {

	const { output } = params;

	// Make a copy of config to avoid mutating the original.
	const configCopy = { ...config };

	// Build dependency graph and resolves all to FeatureSets.
	const graph = precomputedGraph ?? await buildDependencyGraph(params, processFeature, userFeatures, configCopy);
	if (!graph) {
		return;
	}

	const { worklist, legacyWorklist } = graph;

	if ((worklist.length + legacyWorklist.length) === 0) {
		output.write('Zero length or undefined worklist.', LogLevel.Error);
		return;
	}

	output.write(`${JSON.stringify(worklist, null, 2)}`, LogLevel.Trace);

	// Sanity check
	if (worklist.some(node => !node.featureSet) || legacyWorklist.some(node => !node.userFeatureId)) {
		output.write('Feature dependency worklist contains one or more undefined entries.', LogLevel.Error);
		throw new Error(`ERR: Failure resolving Feature dependencies.`);
	}

	output.write(`[raw worklist]: ${worklist.map(n => n.userFeatureId).join(', ')}`, LogLevel.Trace);

	// For each node in the worklist, remove all 'soft-dependency' graph edges that are irrelevant
	// i.e. the node is not a 'soft match' for any node in the worklist itself
	for (let i = 0; i < worklist.length; i++) {
		const node = worklist[i];
		// reverse iterate
		for (let j = node.installsAfter.length - 1; j >= 0; j--) {
			const softDep = node.installsAfter[j];
			if (!worklist.some(n => satisfiesSoftDependency(params, n, softDep))) {
				output.write(`Soft-dependency '${softDep.userFeatureId}' is not required.  Removing from installation order...`, LogLevel.Info);
				// Delete that soft-dependency
				node.installsAfter.splice(j, 1);
			}
		}
	}

	output.write(`[worklist-without-dangling-soft-deps]: ${worklist.map(n => n.userFeatureId).join(', ')}`, LogLevel.Trace);
	output.write('Starting round-based Feature install order calculation from worklist...', LogLevel.Trace);

	const installationOrder: FNode[] = [];
	while (worklist.length > 0) {
		const round = worklist.filter(node =>
			// If the node has no hard/soft dependencies, the node can always be installed.
			(node.dependsOn.length === 0 && node.installsAfter.length === 0)
			// OR, every hard-dependency (dependsOn) AND soft-dependency (installsAfter) has been satified in prior rounds
			|| node.dependsOn.every(dep =>
				installationOrder.some(installed => equals(params, installed, dep)))
			&& node.installsAfter.every(dep =>
				installationOrder.some(installed => satisfiesSoftDependency(params, installed, dep))));

		output.write(`\n[round] ${round.map(r => r.userFeatureId).join(', ')}`, LogLevel.Trace);
		if (round.length === 0) {
			output.write('Circular dependency detected!', LogLevel.Error);
			output.write(`Nodes remaining: ${worklist.map(n => n.userFeatureId!).join(', ')}`, LogLevel.Error);
			return;
		}

		output.write(`[round-candidates] ${round.map(r => `${r.userFeatureId} (${r.roundPriority})`).join(', ')}`, LogLevel.Trace);

		// Given the set of eligible nodes to install this round,
		// determine the highest 'roundPriority' present of the nodes in this
		//  round, and exclude nodes from this round with a lower priority.
		// This ensures that both:
		//  -  The pre-computed graph derived from dependOn/installsAfter is honored
		//  -  The overrideFeatureInstallOrder property (more generically, 'roundPriority') is honored
		const maxRoundPriority = Math.max(...round.map(r => r.roundPriority));
		round.splice(0, round.length, ...round.filter(node => node.roundPriority === maxRoundPriority));
		output.write(`[round-after-filter-priority] (maxPriority=${maxRoundPriority}) ${round.map(r => `${r.userFeatureId} (${r.roundPriority})`).join(', ')}`, LogLevel.Trace);

		// Delete all nodes present in this round from the worklist.
		worklist.splice(0, worklist.length, ...worklist.filter(node => !round.some(r => equals(params, r, node))));

		// Sort rounds lexicographically by id.
		round.sort((a, b) => comparesTo(params, a, b));
		output.write(`[round-after-comparesTo] ${round.map(r => r.userFeatureId).join(', ')}`, LogLevel.Trace);

		// Commit round
		installationOrder.push(...round);
	}

	// Handle legacy worklist
	const legacy = computeFeatureInstallationOrder_deprecated(configCopy, legacyWorklist.reverse().map(n => n.featureSet!));

	return legacy.concat(
		installationOrder.map(n => n.featureSet!)
	);
}

// Pretty-print the calculated graph in the mermaid flowchart format.
// Viewable by copy-pasting the output string to a live editor, i.e: https://mermaid.live/
export function generateMermaidDiagram(params: CommonParams, graph: FNode[]) {
	// Output dependency graph in a mermaid flowchart format
	const roots = graph?.filter(f => f.type === 'user-provided')!;
	let str = 'flowchart\n';
	for (const root of roots) {
		str += `${generateMermaidNode(root)}\n`;
		str += `${generateMermaidSubtree(params, root, graph).reduce((p, c) => p + c + '\n', '')}`;
	}
	return str;
}

function generateMermaidSubtree(params: CommonParams, current: FNode, worklist: FNode[], acc: string[] = []) {
	for (const child of current.dependsOn) {
		// For each corresponding member of the worklist that satisfies this hard-dependency
		for (const w of worklist) {
			if (equals(params, w, child)) {
				acc.push(`${generateMermaidNode(current)} --> ${generateMermaidNode(w)}`);
			}
		}
		generateMermaidSubtree(params, child, worklist, acc);
	}
	for (const child of current.installsAfter) {
		// For each corresponding member of the worklist that satisfies this soft-dependency
		for (const w of worklist) {
			if (satisfiesSoftDependency(params, w, child)) {
				acc.push(`${generateMermaidNode(current)} -.-> ${generateMermaidNode(w)}`);
			}
		}
		generateMermaidSubtree(params, child, worklist, acc);
	}
	return acc;
}

function generateMermaidNode(node: FNode) {
	const hasher = crypto.createHash('sha256', { encoding: 'hex' });
	const hash = hasher.update(JSON.stringify(node)).digest('hex').slice(0, 6);
	return `${hash}[${node.userFeatureId}<br/><${node.roundPriority}>]`;
}
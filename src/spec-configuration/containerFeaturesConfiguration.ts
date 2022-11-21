/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as jsonc from 'jsonc-parser';
import * as path from 'path';
import * as URL from 'url';
import * as tar from 'tar';
import { DevContainerConfig, DevContainerFeature, VSCodeCustomizations } from './configuration';
import { mkdirpLocal, readLocalFile, rmLocal, writeLocalFile, cpDirectoryLocal, isLocalFile } from '../spec-utils/pfs';
import { Log, LogLevel } from '../spec-utils/log';
import { request } from '../spec-utils/httpRequest';
import { computeFeatureInstallationOrder } from './containerFeaturesOrder';
import { fetchOCIFeature, tryGetOCIFeatureSet, fetchOCIFeatureManifestIfExistsFromUserIdentifier } from './containerFeaturesOCI';
import { OCIManifest, OCIRef } from './containerCollectionsOCI';

// v1
const V1_ASSET_NAME = 'devcontainer-features.tgz';
export const V1_DEVCONTAINER_FEATURES_FILE_NAME = 'devcontainer-features.json';

// v2
export const DEVCONTAINER_FEATURE_FILE_NAME = 'devcontainer-feature.json';

export interface Feature {
	id: string;
	version?: string;
	name?: string;
	description?: string;
	cachePath?: string;
	internalVersion?: string; // set programmatically
	consecutiveId?: string;
	documentationURL?: string;
	licenseURL?: string;
	options?: Record<string, FeatureOption>;
	buildArg?: string; // old properties for temporary compatibility
	containerEnv?: Record<string, string>;
	mounts?: Mount[];
	init?: boolean;
	privileged?: boolean;
	capAdd?: string[];
	securityOpt?: string[];
	entrypoint?: string;
	include?: string[];
	exclude?: string[];
	value: boolean | string | Record<string, boolean | string | undefined>; // set programmatically
	included: boolean; // set programmatically
	customizations?: VSCodeCustomizations;
	installsAfter?: string[];
}

export type FeatureOption = {
	type: 'boolean';
	default?: boolean;
	description?: string;
} | {
	type: 'string';
	enum?: string[];
	default?: string;
	description?: string;
} | {
	type: 'string';
	proposals?: string[];
	default?: string;
	description?: string;
};
export interface Mount {
	type: 'bind' | 'volume';
	source: string;
	target: string;
	external?: boolean;
}

const normalizedMountKeys: Record<string, string> = {
	src: 'source',
	destination: 'target',
	dst: 'target',
};

export function parseMount(str: string): Mount {
	return str.split(',')
		.map(s => s.split('='))
		.reduce((acc, [key, value]) => ({ ...acc, [(normalizedMountKeys[key] || key)]: value }), {}) as Mount;
}

export type SourceInformation = LocalCacheSourceInformation | GithubSourceInformation | DirectTarballSourceInformation | FilePathSourceInformation | OCISourceInformation;

interface BaseSourceInformation {
	type: string;
	userFeatureId: string; // Dictates how a supporting tool will locate and download a given feature. See https://github.com/devcontainers/spec/blob/main/proposals/devcontainer-features.md#referencing-a-feature
	userFeatureIdWithoutVersion?: string;
}

export interface LocalCacheSourceInformation extends BaseSourceInformation {
	type: 'local-cache';
}

export interface OCISourceInformation extends BaseSourceInformation {
	type: 'oci';
	featureRef: OCIRef;
	manifest: OCIManifest;
	userFeatureIdWithoutVersion: string;
}

export interface DirectTarballSourceInformation extends BaseSourceInformation {
	type: 'direct-tarball';
	tarballUri: string;
}

export interface FilePathSourceInformation extends BaseSourceInformation {
	type: 'file-path';
	resolvedFilePath: string; // Resolved, absolute file path
}

// deprecated
export interface GithubSourceInformation extends BaseSourceInformation {
	type: 'github-repo';
	apiUri: string;
	unauthenticatedUri: string;
	owner: string;
	repo: string;
	isLatest: boolean; // 'true' indicates user didn't supply a version tag, thus we implicitly pull latest.
	tag?: string;
	ref?: string;
	sha?: string;
	userFeatureIdWithoutVersion: string;
}

export interface GithubSourceInformationInput {
	owner: string;
	repo: string;
	ref?: string;
	sha?: string;
	tag?: string;
}


export interface FeatureSet {
	features: Feature[];
	internalVersion?: string;
	sourceInformation: SourceInformation;
}

export interface FeaturesConfig {
	featureSets: FeatureSet[];
	dstFolder?: string; // set programatically
}

export interface GitHubApiReleaseInfo {
	assets: GithubApiReleaseAsset[];
	name: string;
	tag_name: string;
}

export interface GithubApiReleaseAsset {
	url: string;
	name: string;
	content_type: string;
	size: number;
	download_count: number;
	updated_at: string;
}

// Supports the `node` layer by collapsing all the individual features into a single `features` array.
// Regardless of their origin.
// Information is lost, but for the node layer we need not care about which set a given feature came from.
export interface CollapsedFeaturesConfig {
	allFeatures: Feature[];
}

export const multiStageBuildExploration = false;

// Counter to ensure that no two folders are the same even if we are executing the same feature multiple times.
let counter = 1;
function getCounter() {
	return counter++;
}

const isTsnode = path.basename(process.argv[0]) === 'ts-node' || process.argv.indexOf('ts-node/register') !== -1;

export function getContainerFeaturesFolder(_extensionPath: string | { distFolder: string }) {
	if (isTsnode) {
		return path.join(require.resolve('vscode-dev-containers/package.json'), '..', 'container-features');
	}
	const distFolder = typeof _extensionPath === 'string' ? path.join(_extensionPath, 'dist') : _extensionPath.distFolder;
	return path.join(distFolder, 'node_modules', 'vscode-dev-containers', 'container-features');
}

// Take a SourceInformation and condense it down into a single string
// Useful for calculating a unique build folder name for a given featureSet.
export function getSourceInfoString(srcInfo: SourceInformation): string {
	const { type } = srcInfo;
	switch (type) {
		case 'local-cache':
			return 'local-cache-' + getCounter();
		case 'direct-tarball':
			return srcInfo.tarballUri + getCounter();
		case 'github-repo':
			return `github-${srcInfo.owner}-${srcInfo.repo}-${srcInfo.isLatest ? 'latest' : srcInfo.tag}-${getCounter()}`;
		case 'file-path':
			return srcInfo.resolvedFilePath + '-' + getCounter();
		case 'oci':
			return `oci-${srcInfo.featureRef.resource}-${getCounter()}`;
	}
}

// TODO: Move to node layer.
export function getContainerFeaturesBaseDockerFile() {
	return `
#{featureBuildStages}

#{nonBuildKitFeatureContentFallback}

FROM $_DEV_CONTAINERS_BASE_IMAGE AS dev_containers_feature_content_normalize
USER root
COPY --from=dev_containers_feature_content_source {contentSourceRootPath} /tmp/build-features/
RUN chmod -R 0700 /tmp/build-features

FROM $_DEV_CONTAINERS_BASE_IMAGE AS dev_containers_target_stage

USER root

COPY --from=dev_containers_feature_content_normalize /tmp/build-features /tmp/build-features

#{featureLayer}

#{copyFeatureBuildStages}

#{containerEnv}

ARG _DEV_CONTAINERS_IMAGE_USER=root
USER $_DEV_CONTAINERS_IMAGE_USER

#{devcontainerMetadata}
`;
}

export function getFeatureInstallWrapperScript(feature: Feature, featureSet: FeatureSet, options: string[]): string {
	const id = escapeQuotesForShell(featureSet.sourceInformation.userFeatureIdWithoutVersion ?? 'Unknown');
	const name = escapeQuotesForShell(feature.name ?? 'Unknown');
	const description = escapeQuotesForShell(feature.description ?? '');
	const version = escapeQuotesForShell(feature.version ?? '');
	const documentation = escapeQuotesForShell(feature.documentationURL ?? '');
	const optionsIndented = escapeQuotesForShell(options.map(x => `    ${x}`).join('\n'));

	const errorMessage = `ERROR: Feature "${name}" (${id}) failed to install!`;
	const troubleshootingMessage = documentation
		? ` Look at the documentation at ${documentation} for help troubleshooting this error.`
		: '';

	return `#!/bin/sh
set -e

on_exit () {
	[ $? -eq 0 ] && exit
	echo '${errorMessage}${troubleshootingMessage}'
}

trap on_exit EXIT

echo ===========================================================================
echo 'Feature       : ${name}'
echo 'Description   : ${description}'
echo 'Id            : ${id}'
echo 'Version       : ${version}'
echo 'Documentation : ${documentation}'
echo 'Options       :'
echo '${optionsIndented}'
echo ===========================================================================

set -a
. ../devcontainer-features.builtin.env
. ./devcontainer-features.env
set +a

chmod +x ./install.sh
./install.sh
`;
}

function escapeQuotesForShell(input: string) {
	// The `input` is expected to be a string which will be printed inside single quotes
	// by the caller. This means we need to escape any nested single quotes within the string.
	// We can do this by ending the first string with a single quote ('), printing an escaped
	// single quote (\'), and then opening a new string (').
	return input.replace(new RegExp(`'`, 'g'), `'\\''`);
}

export function getFeatureLayers(featuresConfig: FeaturesConfig, containerUser: string, remoteUser: string) {
	let result = `RUN \\
echo "_CONTAINER_USER_HOME=$(getent passwd ${containerUser} | cut -d: -f6)" >> /tmp/build-features/devcontainer-features.builtin.env && \\
echo "_REMOTE_USER_HOME=$(getent passwd ${remoteUser} | cut -d: -f6)" >> /tmp/build-features/devcontainer-features.builtin.env

`;

	// Features version 1
	const folders = (featuresConfig.featureSets || []).filter(y => y.internalVersion !== '2').map(x => x.features[0].consecutiveId);
	folders.forEach(folder => {
		result += `RUN cd /tmp/build-features/${folder} \\
&& chmod +x ./install.sh \\
&& ./install.sh

`;
	});
	// Features version 2
	featuresConfig.featureSets.filter(y => y.internalVersion === '2').forEach(featureSet => {
		featureSet.features.forEach(feature => {
			result += generateContainerEnvs(feature);
			result += `
RUN cd /tmp/build-features/${feature.consecutiveId} \\
&& chmod +x ./devcontainer-features-install.sh \\
&& ./devcontainer-features-install.sh

`;
		});
	});
	return result;
}

// Features version two export their environment variables as part of the Dockerfile to make them available to subsequent features.
export function generateContainerEnvs(feature: Feature) {
	let result = '';
	if (!feature.containerEnv) {
		return result;
	}
	let keys = Object.keys(feature.containerEnv);
	result = keys.map(k => `ENV ${k}=${feature.containerEnv![k]}`).join('\n');

	return result;
}

const allowedFeatureIdRegex = new RegExp('^[a-zA-Z0-9_-]*$');

// Parses a declared feature in user's devcontainer file into
// a usable URI to download remote features.
// RETURNS
// {
//  "id",              <----- The ID of the feature in the feature set.
//  sourceInformation  <----- Source information (is this locally cached, a GitHub remote feature, etc..), including tarballUri if applicable.
// }
//

const cleanupIterationFetchAndMerge = async (tempTarballPath: string, output: Log) => {
	// Non-fatal, will just get overwritten if we don't do the cleaned up.
	try {
		await rmLocal(tempTarballPath, { force: true });
	} catch (e) {
		output.write(`Didn't remove temporary tarball from disk with caught exception: ${e?.Message} `, LogLevel.Trace);
	}
};

function getRequestHeaders(sourceInformation: SourceInformation, env: NodeJS.ProcessEnv, output: Log) {
	let headers: { 'user-agent': string; 'Authorization'?: string; 'Accept'?: string } = {
		'user-agent': 'devcontainer'
	};

	const isGitHubUri = (srcInfo: DirectTarballSourceInformation) => {
		const uri = srcInfo.tarballUri;
		return uri.startsWith('https://github.com') || uri.startsWith('https://api.github.com');
	};

	if (sourceInformation.type === 'github-repo' || (sourceInformation.type === 'direct-tarball' && isGitHubUri(sourceInformation))) {
		const githubToken = env['GITHUB_TOKEN'];
		if (githubToken) {
			output.write('Using environment GITHUB_TOKEN.');
			headers.Authorization = `Bearer ${githubToken}`;
		} else {
			output.write('No environment GITHUB_TOKEN available.');
		}
	}
	return headers;
}

async function askGitHubApiForTarballUri(sourceInformation: GithubSourceInformation, feature: Feature, headers: { 'user-agent': string; 'Authorization'?: string; 'Accept'?: string }, output: Log) {
	const options = {
		type: 'GET',
		url: sourceInformation.apiUri,
		headers
	};

	const apiInfo: GitHubApiReleaseInfo = JSON.parse(((await request(options, output)).toString()));
	if (apiInfo) {
		const asset =
			apiInfo.assets.find(a => a.name === `${feature.id}.tgz`)  // v2
			|| apiInfo.assets.find(a => a.name === V1_ASSET_NAME) // v1
			|| undefined;

		if (asset && asset.url) {
			output.write(`Found url to fetch release artifact '${asset.name}'. Asset of size ${asset.size} has been downloaded ${asset.download_count} times and was last updated at ${asset.updated_at}`);
			return asset.url;
		} else {
			output.write('Unable to fetch release artifact URI from GitHub API', LogLevel.Error);
			return undefined;
		}
	}
	return undefined;
}

export async function loadFeaturesJson(jsonBuffer: Buffer, filePath: string, output: Log): Promise<FeatureSet | undefined> {
	if (jsonBuffer.length === 0) {
		output.write('Parsed featureSet is empty.', LogLevel.Error);
		return undefined;
	}

	const featureSet: FeatureSet = jsonc.parse(jsonBuffer.toString());
	if (!featureSet?.features || featureSet.features.length === 0) {
		output.write('Parsed featureSet contains no features.', LogLevel.Error);
		return undefined;
	}
	output.write(`Loaded ${filePath}, which declares ${featureSet.features.length} features and ${(!!featureSet.sourceInformation) ? 'contains' : 'does not contain'} explicit source info.`,
		LogLevel.Trace);

	return updateFromOldProperties(featureSet);
}

export async function loadV1FeaturesJsonFromDisk(pathToDirectory: string, output: Log): Promise<FeatureSet | undefined> {
	const filePath = path.join(pathToDirectory, V1_DEVCONTAINER_FEATURES_FILE_NAME);
	const jsonBuffer: Buffer = await readLocalFile(filePath);
	return loadFeaturesJson(jsonBuffer, filePath, output);
}

function updateFromOldProperties<T extends { features: (Feature & { extensions?: string[]; settings?: object; customizations?: VSCodeCustomizations })[] }>(original: T): T {
	// https://github.com/microsoft/dev-container-spec/issues/1
	if (!original.features.find(f => f.extensions || f.settings)) {
		return original;
	}
	return {
		...original,
		features: original.features.map(f => {
			if (!(f.extensions || f.settings)) {
				return f;
			}
			const copy = { ...f };
			const customizations = copy.customizations || (copy.customizations = {});
			const vscode = customizations.vscode || (customizations.vscode = {});
			if (copy.extensions) {
				vscode.extensions = (vscode.extensions || []).concat(copy.extensions);
				delete copy.extensions;
			}
			if (copy.settings) {
				vscode.settings = {
					...copy.settings,
					...(vscode.settings || {}),
				};
				delete copy.settings;
			}
			return copy;
		}),
	};
}

// Generate a base featuresConfig object with the set of locally-cached features, 
// as well as downloading and merging in remote feature definitions.
export async function generateFeaturesConfig(params: { extensionPath: string; cwd: string; output: Log; env: NodeJS.ProcessEnv; skipFeatureAutoMapping: boolean }, dstFolder: string, config: DevContainerConfig, getLocalFeaturesFolder: (d: string) => string, additionalFeatures: Record<string, string | boolean | Record<string, string | boolean>>) {
	const { output } = params;

	const workspaceRoot = params.cwd;
	output.write(`workspace root: ${workspaceRoot}`, LogLevel.Trace);

	const userFeatures = featuresToArray(config, additionalFeatures);
	if (!userFeatures) {
		return undefined;
	}

	// Create the featuresConfig object.
	// Initialize the featureSets object, and stash the dstFolder on the object for use later.
	let featuresConfig: FeaturesConfig = {
		featureSets: [],
		dstFolder
	};

	// load local cache of features;
	// TODO: Update so that cached features are always version 2
	const localFeaturesFolder = getLocalFeaturesFolder(params.extensionPath);
	const locallyCachedFeatureSet = await loadV1FeaturesJsonFromDisk(localFeaturesFolder, output); // TODO: Pass dist folder instead to also work with the devcontainer.json support package.
	if (!locallyCachedFeatureSet) {
		output.write('Failed to load locally cached features', LogLevel.Error);
		return undefined;
	}

	// Read features and get the type.
	output.write('--- Processing User Features ----', LogLevel.Trace);
	featuresConfig = await processUserFeatures(params.output, config, workspaceRoot, params.env, userFeatures, featuresConfig, params.skipFeatureAutoMapping);
	output.write(JSON.stringify(featuresConfig, null, 4), LogLevel.Trace);

	const ociCacheDir = await prepareOCICache(dstFolder);

	// Fetch features, stage into the appropriate build folder, and read the feature's devcontainer-feature.json
	output.write('--- Fetching User Features ----', LogLevel.Trace);
	await fetchFeatures(params, featuresConfig, locallyCachedFeatureSet, dstFolder, localFeaturesFolder, ociCacheDir);

	const orderedFeatures = computeFeatureInstallationOrder(config, featuresConfig.featureSets);

	output.write('--- Computed order ----', LogLevel.Trace);
	for (const feature of orderedFeatures) {
		output.write(`${feature.sourceInformation.userFeatureId}`, LogLevel.Trace);
	}

	featuresConfig.featureSets = orderedFeatures;

	return featuresConfig;
}

async function prepareOCICache(dstFolder: string) {
	const ociCacheDir = path.join(dstFolder, 'ociCache');
	await mkdirpLocal(ociCacheDir);

	return ociCacheDir;
}

function featuresToArray(config: DevContainerConfig, additionalFeatures: Record<string, string | boolean | Record<string, string | boolean>>): DevContainerFeature[] | undefined {
	if (!Object.keys(config.features || {}).length && !Object.keys(additionalFeatures).length) {
		return undefined;
	}

	const userFeatures: DevContainerFeature[] = [];
	const userFeatureKeys = new Set<string>();

	if (config.features) {
		for (const userFeatureKey of Object.keys(config.features)) {
			const userFeatureValue = config.features[userFeatureKey];
			const feature: DevContainerFeature = {
				id: userFeatureKey,
				options: userFeatureValue
			};
			userFeatures.push(feature);
			userFeatureKeys.add(userFeatureKey);
		}
	}

	if (additionalFeatures) {
		for (const userFeatureKey of Object.keys(additionalFeatures)) {
			// add the additional feature if it hasn't already been added from the config features
			if (!userFeatureKeys.has(userFeatureKey)) {
				const userFeatureValue = additionalFeatures[userFeatureKey];
				const feature: DevContainerFeature = {
					id: userFeatureKey,
					options: userFeatureValue
				};
				userFeatures.push(feature);
			}
		}
	}

	return userFeatures;
}

// Process features contained in devcontainer.json
// Creates one feature set per feature to aid in support of the previous structure.
async function processUserFeatures(output: Log, config: DevContainerConfig, workspaceRoot: string, env: NodeJS.ProcessEnv, userFeatures: DevContainerFeature[], featuresConfig: FeaturesConfig, skipFeatureAutoMapping: boolean): Promise<FeaturesConfig> {
	for (const userFeature of userFeatures) {
		const newFeatureSet = await processFeatureIdentifier(output, config.configFilePath.path, workspaceRoot, env, userFeature, skipFeatureAutoMapping);
		if (!newFeatureSet) {
			throw new Error(`Failed to process feature ${userFeature.id}`);
		}
		featuresConfig.featureSets.push(newFeatureSet);
	}
	return featuresConfig;
}

export async function getFeatureIdType(output: Log, env: NodeJS.ProcessEnv, userFeatureId: string) {
	// See the specification for valid feature identifiers:
	//   > https://github.com/devcontainers/spec/blob/main/proposals/devcontainer-features.md#referencing-a-feature
	//
	// Additionally, we support the following deprecated syntaxes for backwards compatibility:
	//      (0)  A 'local feature' packaged with the CLI.
	//			 Syntax:   <feature>
	//
	//      (1)  A feature backed by a GitHub Release
	//			 Syntax:   <repoOwner>/<repoName>/<featureId>[@version]

	// DEPRECATED: This is a legacy feature-set ID
	if (!userFeatureId.includes('/') && !userFeatureId.includes('\\')) {
		return { type: 'local-cache', manifest: undefined };
	}

	// Direct tarball reference
	if (userFeatureId.startsWith('https://')) {
		return { type: 'direct-tarball', manifest: undefined };
	}

	// Local feature on disk
	// !! NOTE: The ability for paths outside the project file tree will soon be removed.
	if (userFeatureId.startsWith('./') || userFeatureId.startsWith('../') || userFeatureId.startsWith('/')) {
		return { type: 'file-path', manifest: undefined };
	}

	// version identifier for a github release feature.
	// DEPRECATED: This is a legacy feature-set ID
	if (userFeatureId.includes('@')) {
		return { type: 'github-repo', manifest: undefined };
	}

	const manifest = await fetchOCIFeatureManifestIfExistsFromUserIdentifier(output, env, userFeatureId);
	if (manifest) {
		return { type: 'oci', manifest: manifest };
	} else {
		// DEPRECATED: This is a legacy feature-set ID
		output.write('(!) WARNING: Falling back to deprecated GitHub Release syntax. See https://github.com/devcontainers/spec/blob/main/proposals/devcontainer-features.md#referencing-a-feature for updated specification.', LogLevel.Warning);
		return { type: 'github-repo', manifest: undefined };
	}
}

export function getBackwardCompatibleFeatureId(output: Log, id: string) {
	const migratedfeatures = ['aws-cli', 'azure-cli', 'desktop-lite', 'docker-in-docker', 'docker-from-docker', 'dotnet', 'git', 'git-lfs', 'github-cli', 'java', 'kubectl-helm-minikube', 'node', 'powershell', 'python', 'ruby', 'rust', 'sshd', 'terraform'];
	const renamedFeatures = new Map();
	renamedFeatures.set('golang', 'go');
	renamedFeatures.set('common', 'common-utils');

	const deprecatedFeaturesIntoOptions = new Map();
	deprecatedFeaturesIntoOptions.set('gradle', 'java');
	deprecatedFeaturesIntoOptions.set('maven', 'java');
	deprecatedFeaturesIntoOptions.set('jupyterlab', 'python');

	// TODO: add warning logs once we have context on the new location for these Features.
	// const deprecatedFeatures = ['fish', 'homebrew'];

	const newFeaturePath = 'ghcr.io/devcontainers/features';
	// Note: Pin the versionBackwardComp to '1' to avoid breaking changes.
	const versionBackwardComp = '1';

	// Mapping feature references (old shorthand syntax) from "microsoft/vscode-dev-containers" to "ghcr.io/devcontainers/features"
	if (migratedfeatures.includes(id)) {
		output.write(`(!) WARNING: Using the deprecated '${id}' Feature. See https://github.com/devcontainers/features/tree/main/src/${id}#example-usage for the updated Feature.`, LogLevel.Warning);
		return `${newFeaturePath}/${id}:${versionBackwardComp}`;
	}

	// Mapping feature references (renamed old shorthand syntax) from "microsoft/vscode-dev-containers" to "ghcr.io/devcontainers/features"
	if (renamedFeatures.get(id) !== undefined) {
		output.write(`(!) WARNING: Using the deprecated '${id}' Feature. See https://github.com/devcontainers/features/tree/main/src/${renamedFeatures.get(id)}#example-usage for the updated Feature.`, LogLevel.Warning);
		return `${newFeaturePath}/${renamedFeatures.get(id)}:${versionBackwardComp}`;
	}

	if (deprecatedFeaturesIntoOptions.get(id) !== undefined) {
		output.write(`(!) WARNING: Falling back to the deprecated '${id}' Feature. It is now part of the '${deprecatedFeaturesIntoOptions.get(id)}' Feature. See https://github.com/devcontainers/features/tree/main/src/${deprecatedFeaturesIntoOptions.get(id)}#options for the updated Feature.`, LogLevel.Warning);
	}

	// Deprecated and all other features references (eg. fish, ghcr.io/devcontainers/features/go, ghcr.io/owner/repo/id etc)
	return id;
}

// Strictly processes the user provided feature identifier to determine sourceInformation type.
// Returns a featureSet per feature.
export async function processFeatureIdentifier(output: Log, configPath: string, _workspaceRoot: string, env: NodeJS.ProcessEnv, userFeature: DevContainerFeature, skipFeatureAutoMapping?: boolean): Promise<FeatureSet | undefined> {
	output.write(`* Processing feature: ${userFeature.id}`);

	// id referenced by the user before the automapping from old shorthand syntax to "ghcr.io/devcontainers/features"
	const originalUserFeatureId = userFeature.id;
	// Adding backward compatibility
	if (!skipFeatureAutoMapping) {
		userFeature.id = getBackwardCompatibleFeatureId(output, userFeature.id);
	}

	const { type, manifest } = await getFeatureIdType(output, env, userFeature.id);

	// cached feature
	// Resolves deprecated features (fish, maven, gradle, homebrew, jupyterlab)
	if (type === 'local-cache') {
		output.write(`Cached feature found.`);

		let feat: Feature = {
			id: userFeature.id,
			name: userFeature.id,
			value: userFeature.options,
			included: true,
		};

		let newFeaturesSet: FeatureSet = {
			sourceInformation: {
				type: 'local-cache',
				userFeatureId: originalUserFeatureId
			},
			features: [feat],
		};

		return newFeaturesSet;
	}

	// remote tar file
	if (type === 'direct-tarball') {
		output.write(`Remote tar file found.`);
		const tarballUri = new URL.URL(userFeature.id);

		const fullPath = tarballUri.pathname;
		const tarballName = fullPath.substring(fullPath.lastIndexOf('/') + 1);
		output.write(`tarballName = ${tarballName}`, LogLevel.Trace);

		const regex = new RegExp('devcontainer-feature-(.*).tgz');
		const matches = regex.exec(tarballName);

		if (!matches || matches.length !== 2) {
			output.write(`Expected tarball name to follow 'devcontainer-feature-<feature-id>.tgz' format.  Received '${tarballName}'`, LogLevel.Error);
			return undefined;
		}
		const id = matches[1];

		if (id === '' || !allowedFeatureIdRegex.test(id)) {
			output.write(`Parse error. Specify a feature id with alphanumeric, dash, or underscore characters. Received ${id}.`, LogLevel.Error);
			return undefined;
		}

		let feat: Feature = {
			id: id,
			name: userFeature.id,
			value: userFeature.options,
			included: true,
		};

		let newFeaturesSet: FeatureSet = {
			sourceInformation: {
				type: 'direct-tarball',
				tarballUri: tarballUri.toString(),
				userFeatureId: originalUserFeatureId
			},
			features: [feat],
		};

		return newFeaturesSet;
	}

	// Spec: https://containers.dev/implementors/features-distribution/#addendum-locally-referenced
	if (type === 'file-path') {
		output.write(`Local disk feature.`);

		const id = path.basename(userFeature.id);

		// Fail on Absolute paths.
		if (path.isAbsolute(userFeature.id)) {
			output.write('An Absolute path to a local feature is not allowed.', LogLevel.Error);
			return undefined;
		}

		// Local-path features are expected to be a sub-folder of the '$WORKSPACE_ROOT/.devcontainer' folder.
		const featureFolderPath = path.join(path.dirname(configPath), userFeature.id);

		// Ensure we aren't escaping .devcontainer folder
		const parent = path.join(_workspaceRoot, '.devcontainer');
		const child = featureFolderPath;
		const relative = path.relative(parent, child);
		output.write(`${parent} -> ${child}:   Relative Distance = '${relative}'`, LogLevel.Trace);
		if (relative.indexOf('..') !== -1) {
			output.write(`Local file path parse error. Resolved path must be a child of the .devcontainer/ folder.  Parsed: ${featureFolderPath}`, LogLevel.Error);
			return undefined;
		}

		output.write(`Resolved: ${userFeature.id}  ->  ${featureFolderPath}`, LogLevel.Trace);

		// -- All parsing and validation steps complete at this point.

		output.write(`Parsed feature id: ${id}`, LogLevel.Trace);
		let feat: Feature = {
			id,
			name: userFeature.id,
			value: userFeature.options,
			included: true,
		};

		let newFeaturesSet: FeatureSet = {
			sourceInformation: {
				type: 'file-path',
				resolvedFilePath: featureFolderPath,
				userFeatureId: originalUserFeatureId
			},
			features: [feat],
		};

		return newFeaturesSet;
	}

	// (6) Oci Identifier
	if (type === 'oci' && manifest) {
		return tryGetOCIFeatureSet(output, userFeature.id, userFeature.options, manifest, originalUserFeatureId);
	}

	output.write(`Github feature.`);
	// Github repository source.
	let version = 'latest';
	let splitOnAt = userFeature.id.split('@');
	if (splitOnAt.length > 2) {
		output.write(`Parse error. Use the '@' symbol only to designate a version tag.`, LogLevel.Error);
		return undefined;
	}
	if (splitOnAt.length === 2) {
		output.write(`[${userFeature.id}] has version ${splitOnAt[1]}`, LogLevel.Trace);
		version = splitOnAt[1];
	}

	// Remaining info must be in the first part of the split.
	const featureBlob = splitOnAt[0];
	const splitOnSlash = featureBlob.split('/');
	// We expect all GitHub/registry features to follow the triple slash pattern at this point
	//  eg: <publisher>/<feature-set>/<feature>
	if (splitOnSlash.length !== 3 || splitOnSlash.some(x => x === '') || !allowedFeatureIdRegex.test(splitOnSlash[2])) {
		// This is the final fallback. If we end up here, we weren't able to resolve the Feature
		output.write(`Could not resolve Feature '${userFeature.id}'.  Ensure the Feature is published and accessible from your current environment.`, LogLevel.Error);
		return undefined;
	}
	const owner = splitOnSlash[0];
	const repo = splitOnSlash[1];
	const id = splitOnSlash[2];

	let feat: Feature = {
		id: id,
		name: userFeature.id,
		value: userFeature.options,
		included: true,
	};

	const userFeatureIdWithoutVersion = originalUserFeatureId.split('@')[0];
	if (version === 'latest') {
		let newFeaturesSet: FeatureSet = {
			sourceInformation: {
				type: 'github-repo',
				apiUri: `https://api.github.com/repos/${owner}/${repo}/releases/latest`,
				unauthenticatedUri: `https://github.com/${owner}/${repo}/releases/latest/download`, // v1/v2 implementations append name of relevant asset
				owner,
				repo,
				isLatest: true,
				userFeatureId: originalUserFeatureId,
				userFeatureIdWithoutVersion
			},
			features: [feat],
		};
		return newFeaturesSet;
	} else {
		// We must have a tag, return a tarball URI for the tagged version. 
		let newFeaturesSet: FeatureSet = {
			sourceInformation: {
				type: 'github-repo',
				apiUri: `https://api.github.com/repos/${owner}/${repo}/releases/tags/${version}`,
				unauthenticatedUri: `https://github.com/${owner}/${repo}/releases/download/${version}`, // v1/v2 implementations append name of relevant asset
				owner,
				repo,
				tag: version,
				isLatest: false,
				userFeatureId: originalUserFeatureId,
				userFeatureIdWithoutVersion
			},
			features: [feat],
		};
		return newFeaturesSet;
	}

	// TODO: Handle invalid source types better by refactoring this function.
	// throw new Error(`Unsupported feature source type: ${type}`);
}

async function fetchFeatures(params: { extensionPath: string; cwd: string; output: Log; env: NodeJS.ProcessEnv }, featuresConfig: FeaturesConfig, localFeatures: FeatureSet, dstFolder: string, localFeaturesFolder: string, ociCacheDir: string) {
	for (const featureSet of featuresConfig.featureSets) {
		try {
			if (!featureSet || !featureSet.features || !featureSet.sourceInformation) {
				continue;
			}

			if (!localFeatures) {
				continue;
			}

			const { output } = params;

			const feature = featureSet.features[0];
			const consecutiveId = feature.id + '_' + getCounter();
			// Calculate some predictable caching paths.
			const featCachePath = path.join(dstFolder, consecutiveId);
			const sourceInfoType = featureSet.sourceInformation?.type;

			feature.cachePath = featCachePath;
			feature.consecutiveId = consecutiveId;

			const featureDebugId = `${feature.consecutiveId}_${sourceInfoType}`;
			output.write(`* Fetching feature: ${featureDebugId}`);

			if (sourceInfoType === 'oci') {
				output.write(`Fetching from OCI`, LogLevel.Trace);
				await mkdirpLocal(featCachePath);
				const success = await fetchOCIFeature(output, params.env, featureSet, ociCacheDir, featCachePath);
				if (!success) {
					const err = `Could not download OCI feature: ${featureSet.sourceInformation.featureRef.id}`;
					throw new Error(err);
				}

				if (!(await applyFeatureConfigToFeature(output, featureSet, feature, featCachePath))) {
					const err = `Failed to parse feature '${featureDebugId}'. Please check your devcontainer.json 'features' attribute.`;
					throw new Error(err);
				}

				continue;
			}

			if (sourceInfoType === 'local-cache') {
				// create copy of the local features to set the environment variables for them.
				await mkdirpLocal(featCachePath);
				await cpDirectoryLocal(localFeaturesFolder, featCachePath);

				if (!(await applyFeatureConfigToFeature(output, featureSet, feature, featCachePath))) {
					const err = `Failed to parse feature '${featureDebugId}'. Please check your devcontainer.json 'features' attribute.`;
					throw new Error(err);
				}
				continue;
			}

			if (sourceInfoType === 'file-path') {
				output.write(`Detected local file path`, LogLevel.Trace);
				await mkdirpLocal(featCachePath);
				const executionPath = featureSet.sourceInformation.resolvedFilePath;
				await cpDirectoryLocal(executionPath, featCachePath);

				if (!(await applyFeatureConfigToFeature(output, featureSet, feature, featCachePath))) {
					const err = `Failed to parse feature '${featureDebugId}'. Please check your devcontainer.json 'features' attribute.`;
					throw new Error(err);
				}
				continue;
			}

			output.write(`Detected tarball`, LogLevel.Trace);
			const headers = getRequestHeaders(featureSet.sourceInformation, params.env, output);

			// Ordered list of tarballUris to attempt to fetch from.
			let tarballUris: string[] = [];

			if (sourceInfoType === 'github-repo') {
				output.write('Determining tarball URI for provided github repo.', LogLevel.Trace);
				if (headers.Authorization && headers.Authorization !== '') {
					output.write('GITHUB_TOKEN available. Attempting to fetch via GH API.', LogLevel.Info);
					const authenticatedGithubTarballUri = await askGitHubApiForTarballUri(featureSet.sourceInformation, feature, headers, output);

					if (authenticatedGithubTarballUri) {
						tarballUris.push(authenticatedGithubTarballUri);
					} else {
						output.write('Failed to generate autenticated tarball URI for provided feature, despite a GitHub token present', LogLevel.Warning);
					}
					headers.Accept = 'Accept: application/octet-stream';
				}

				// Always add the unauthenticated URIs as fallback options.
				output.write('Appending unauthenticated URIs for v2 and then v1', LogLevel.Trace);
				tarballUris.push(`${featureSet.sourceInformation.unauthenticatedUri}/${feature.id}.tgz`);
				tarballUris.push(`${featureSet.sourceInformation.unauthenticatedUri}/${V1_ASSET_NAME}`);

			} else {
				// We have a plain ol' tarball URI, since we aren't in the github-repo case.
				tarballUris.push(featureSet.sourceInformation.tarballUri);
			}

			// Attempt to fetch from 'tarballUris' in order, until one succeeds.
			let didSucceed: boolean = false;
			for (const tarballUri of tarballUris) {
				didSucceed = await fetchContentsAtTarballUri(tarballUri, featCachePath, headers, dstFolder, output);

				if (didSucceed) {
					output.write(`Succeeded fetching ${tarballUri}`, LogLevel.Trace);
					if (!(await applyFeatureConfigToFeature(output, featureSet, feature, featCachePath))) {
						const err = `Failed to parse feature '${featureDebugId}'. Please check your devcontainer.json 'features' attribute.`;
						throw new Error(err);
					}
					break;
				}
			}

			if (!didSucceed) {
				const msg = `(!) Failed to fetch tarball for ${featureDebugId} after attempting ${tarballUris.length} possibilities.`;
				throw new Error(msg);
			}
		}
		catch (e) {
			params.output.write(`(!) ERR: Failed to fetch feature: ${e?.message ?? ''} `, LogLevel.Error);
			throw e;
		}
	}
}

async function fetchContentsAtTarballUri(tarballUri: string, featCachePath: string, headers: { 'user-agent': string; 'Authorization'?: string; 'Accept'?: string }, dstFolder: string, output: Log): Promise<boolean> {
	const tempTarballPath = path.join(dstFolder, 'temp.tgz');
	try {
		const options = {
			type: 'GET',
			url: tarballUri,
			headers
		};
		output.write(`Fetching tarball at ${options.url}`);
		output.write(`Headers: ${JSON.stringify(options)}`, LogLevel.Trace);
		const tarball = await request(options, output);

		if (!tarball || tarball.length === 0) {
			output.write(`Did not receive a response from tarball download URI: ${tarballUri}`, LogLevel.Trace);
			return false;
		}

		// Filter what gets emitted from the tar.extract().
		const filter = (file: string, _: tar.FileStat) => {
			// Don't include .dotfiles or the archive itself.
			if (file.startsWith('./.') || file === `./${V1_ASSET_NAME}` || file === './.') {
				return false;
			}
			return true;
		};

		output.write(`Preparing to unarchive received tgz from ${tempTarballPath} -> ${featCachePath}.`, LogLevel.Trace);
		// Create the directory to cache this feature-set in.
		await mkdirpLocal(featCachePath);
		await writeLocalFile(tempTarballPath, tarball);
		await tar.x(
			{
				file: tempTarballPath,
				cwd: featCachePath,
				filter
			}
		);

		await cleanupIterationFetchAndMerge(tempTarballPath, output);

		return true;
	} catch (e) {
		output.write(`Caught failure when fetching from URI '${tarballUri}': ${e}`, LogLevel.Trace);
		await cleanupIterationFetchAndMerge(tempTarballPath, output);
		return false;
	}
}

// Reads the feature's 'devcontainer-feature.json` and applies any attributes to the in-memory Feature object.
// NOTE:
// 		Implements the latest ('internalVersion' = '2') parsing logic, 
// 		Falls back to earlier implementation(s) if requirements not present.
// 		Returns a boolean indicating whether the feature was successfully parsed.
async function applyFeatureConfigToFeature(output: Log, featureSet: FeatureSet, feature: Feature, featCachePath: string): Promise<boolean> {
	const innerJsonPath = path.join(featCachePath, DEVCONTAINER_FEATURE_FILE_NAME);

	if (!(await isLocalFile(innerJsonPath))) {
		output.write(`Feature ${feature.id} is not a 'v2' feature. Attempting fallback to 'v1' implementation.`, LogLevel.Trace);
		output.write(`For v2, expected devcontainer-feature.json at ${innerJsonPath}`, LogLevel.Trace);
		return await parseDevContainerFeature_v1Impl(output, featureSet, feature, featCachePath);
	}

	featureSet.internalVersion = '2';
	feature.cachePath = featCachePath;
	const jsonString: Buffer = await readLocalFile(innerJsonPath);
	const featureJson = jsonc.parse(jsonString.toString());


	feature = {
		...featureJson,
		...feature
	};

	featureSet.features[0] = updateFromOldProperties({ features: [feature] }).features[0];

	return true;
}

async function parseDevContainerFeature_v1Impl(output: Log, featureSet: FeatureSet, feature: Feature, featCachePath: string): Promise<boolean> {

	const pathToV1DevContainerFeatureJson = path.join(featCachePath, V1_DEVCONTAINER_FEATURES_FILE_NAME);

	if (!(await isLocalFile(pathToV1DevContainerFeatureJson))) {
		output.write(`Failed to find ${V1_DEVCONTAINER_FEATURES_FILE_NAME} metadata file (v1)`, LogLevel.Error);
		return false;
	}
	featureSet.internalVersion = '1';
	feature.cachePath = featCachePath;
	const jsonString: Buffer = await readLocalFile(pathToV1DevContainerFeatureJson);
	const featureJson: FeatureSet = jsonc.parse(jsonString.toString());

	const seekedFeature = featureJson?.features.find(f => f.id === feature.id);
	if (!seekedFeature) {
		output.write(`Failed to find feature '${feature.id}' in provided v1 metadata file`, LogLevel.Error);
		return false;
	}

	feature = {
		...seekedFeature,
		...feature
	};

	featureSet.features[0] = updateFromOldProperties({ features: [feature] }).features[0];


	return true;
}

export function getFeatureMainProperty(feature: Feature) {
	return feature.options?.version ? 'version' : undefined;
}

export function getFeatureMainValue(feature: Feature) {
	const defaultProperty = getFeatureMainProperty(feature);
	if (!defaultProperty) {
		return !!feature.value;
	}
	if (typeof feature.value === 'object') {
		const value = feature.value[defaultProperty];
		if (value === undefined && feature.options) {
			return feature.options[defaultProperty]?.default;
		}
		return value;
	}
	if (feature.value === undefined && feature.options) {
		return feature.options[defaultProperty]?.default;
	}
	return feature.value;
}

export function getFeatureValueObject(feature: Feature) {
	if (typeof feature.value === 'object') {
		return {
			...getFeatureValueDefaults(feature),
			...feature.value
		};
	}
	const mainProperty = getFeatureMainProperty(feature);
	if (!mainProperty) {
		return getFeatureValueDefaults(feature);
	}
	return {
		...getFeatureValueDefaults(feature),
		[mainProperty]: feature.value,
	};
}

function getFeatureValueDefaults(feature: Feature) {
	const options = feature.options || {};
	return Object.keys(options)
		.reduce((defaults, key) => {
			if ('default' in options[key]) {
				defaults[key] = options[key].default;
			}
			return defaults;
		}, {} as Record<string, string | boolean | undefined>);
}

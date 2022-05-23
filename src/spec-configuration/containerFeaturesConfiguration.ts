/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as jsonc from 'jsonc-parser';
import * as path from 'path';
//import * as semver from 'semver';
import * as URL from 'url';
import * as tar from 'tar';
import { DevContainerConfig } from './configuration';
import { mkdirpLocal, readLocalFile, rmLocal, writeLocalFile, cpDirectoryLocal } from '../spec-utils/pfs';
import { Log, LogLevel } from '../spec-utils/log';
import { request } from '../spec-utils/httpRequest';
import { DevContainerFeature } from './configuration';
import { existsSync } from 'fs';

const ASSET_NAME = 'devcontainer-features.tgz';

export interface Feature {
	id: string;
	name: string;
	description?: string;
	filename?: string;
	runApp?: string;
	runParams?: string;
	infoString?: string;
	internalVersion?: string;
	tempLocalPath?: string;
	consecutiveId?: string;
	install?: Record<string, string>;
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

export type SourceInformation = LocalCacheSourceInformation | GithubSourceInformation | DirectTarballSourceInformation | FilePathSourceInformation;

interface BaseSourceInformation {
	type: string;
}

export interface LocalCacheSourceInformation extends BaseSourceInformation {
	type: 'local-cache';
}

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
}

export interface GithubSourceInformationInput {
	owner: string;
	repo: string;
	ref?: string;
	sha?: string;
	tag?: string;
}

export interface DirectTarballSourceInformation extends BaseSourceInformation {
	type: 'direct-tarball';
	tarballUri: string;
}

export interface FilePathSourceInformation extends BaseSourceInformation {
	type: 'file-path';
	filePath: string;
	isRelative: boolean; // If not a relative path, then it is an absolute path.
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

export function collapseFeaturesConfig(original: FeaturesConfig): CollapsedFeaturesConfig {
	const collapsed = {
		allFeatures: original.featureSets
			.map(fSet => fSet.features)
			.flat()
	};
	return collapsed;
}

export const multiStageBuildExploration = false;

// TODO: Cleanup
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
			return srcInfo.filePath + '-' + getCounter();
	}
}

// TODO: Move to node layer.
export function getContainerFeaturesBaseDockerFile() {
	return `
#{featureBuildStages}

#{nonBuildKitFeatureContentFallback}

FROM $_DEV_CONTAINERS_BASE_IMAGE

USER root

COPY --from=dev_containers_feature_content_source {contentSourceRootPath} /tmp/build-features/

#{featureLayer}

#{copyFeatureBuildStages}

#{containerEnv}

ARG _DEV_CONTAINERS_IMAGE_USER=root
USER $_DEV_CONTAINERS_IMAGE_USER
`;
}

export function getFeatureLayers(featuresConfig: FeaturesConfig) {
	let result = '';

	// Features version 1  FIX
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
&& export $(cat devcontainer-features.env | xargs) \\
&& chmod +x ./${feature.runParams} \\
&& ./${feature.runParams}

`;	
		})
	});
	return result;
}

// Used for features version 2
export function generateContainerEnvs(feature: Feature) {
	let result = '';
	if(!feature.containerEnv)
	{
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

async function askGitHubApiForTarballUri(sourceInformation: GithubSourceInformation, headers: { 'user-agent': string; 'Authorization'?: string; 'Accept'?: string }, output: Log) {
	const options = {
		type: 'GET',
		url: sourceInformation.apiUri,
		headers
	};
	const apiInfo: GitHubApiReleaseInfo = JSON.parse(((await request(options, output)).toString()));
	if (apiInfo) {
		const asset = apiInfo.assets.find(a => a.name === ASSET_NAME);
		if (asset && asset.url) {
			output.write(`Found url to fetch release artifact ${asset.name}. Asset of size ${asset.size} has been downloaded ${asset.download_count} times and was last updated at ${asset.updated_at}`);
			return asset.url;
		} else {
			output.write('Unable to fetch release artifact URI from GitHub API', LogLevel.Error);
			return undefined;
		}
	}
	return undefined;
}

export async function loadFeaturesJson(jsonBuffer: Buffer, output: Log): Promise<FeatureSet | undefined> {
	if (jsonBuffer.length === 0) {
		output.write('Parsed featureSet is empty.', LogLevel.Error);
		return undefined;
	}

	const featureSet: FeatureSet = jsonc.parse(jsonBuffer.toString());
	if (!featureSet?.features || featureSet.features.length === 0) {
		output.write('Parsed featureSet contains no features.', LogLevel.Error);
		return undefined;
	}
	output.write(`Loaded devcontainer-features.json declares ${featureSet.features.length} features and ${(!!featureSet.sourceInformation) ? 'contains' : 'does not contain'} explicit source info.`,
		LogLevel.Trace);

	return updateFromOldProperties(featureSet);
}

export async function loadFeaturesJsonFromDisk(pathToDirectory: string, output: Log): Promise<FeatureSet | undefined> {
	const jsonBuffer: Buffer = await readLocalFile(path.join(pathToDirectory, 'devcontainer-features.json'));
	return loadFeaturesJson(jsonBuffer, output);
}

function updateFromOldProperties<T extends { features: (Feature & { extensions?: string[]; settings?: object; customizations?: { vscode?: { extensions?: string[]; settings?: object } } })[] }>(original: T): T {
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
export async function generateFeaturesConfig(params: { extensionPath: string; cwd: string, output: Log; env: NodeJS.ProcessEnv }, dstFolder: string, config: DevContainerConfig, imageLabelDetails: () => Promise<{ definition?: string; version?: string }>, getLocalFolder: (d: string) => string) {
	const { output } = params;

	if (!config.features)
	{
		return undefined;
	}

	if(!imageLabelDetails)
	{
		return undefined;
	}

	const userFeatures = convertOldFeatures(params, config);

	if(!userFeatures) {
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
	let locallyCachedFeatureSet = await loadFeaturesJsonFromDisk(getLocalFolder(params.extensionPath), output); // TODO: Pass dist folder instead to also work with the devcontainer.json support package.
	if (!locallyCachedFeatureSet) {
		output.write('Failed to load locally cached features', LogLevel.Error);
		return undefined;
	}

	// Read features and get the type.
	featuresConfig = await processUserFeatures(params.output, userFeatures, featuresConfig);

	// Fetch features and get version information
	await fetchFeatures(params, featuresConfig, locallyCachedFeatureSet, dstFolder);

	return featuresConfig;
}

// Convert features from object syntax to array syntax
function convertOldFeatures(params: { output: Log }, config: DevContainerConfig): DevContainerFeature[] | undefined 
{
	params.output.write('');

	let userFeatures: DevContainerFeature[] = [];
	if (Array.isArray(config.features))
	{
		userFeatures = config.features;
	}
	else {
		if (!config.features || !Object.keys(config.features).length) {
			return undefined;
		}

		for (const userFeatureKey of Object.keys(config.features)) {
			const userFeatureValue = config.features[userFeatureKey];
			if(userFeatureKey)
			{
				let feature : DevContainerFeature = {
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
async function processUserFeatures(output: Log, userFeatures: DevContainerFeature[], featuresConfig: FeaturesConfig) : Promise<FeaturesConfig>
{
	userFeatures.forEach(userFeature => {
			const newFeatureSet = parseFeatureIdentifier(output, userFeature);
			if(newFeatureSet) {
				featuresConfig.featureSets.push(newFeatureSet);
			}
		}
	);
	return featuresConfig;
}

export function parseFeatureIdentifier(output: Log, userFeature: DevContainerFeature) : FeatureSet | undefined {
	// A identifier takes this form:
	//      (0)  <feature>
	//      (1)  <publisher>/<feature-set>/<feature>@version
	//      (2)  https://<../URI/..>/devcontainer-features.tgz#<feature>
	//      (3) ./<local-path>#<feature>  -or-  ../<local-path>#<feature>  -or-   /<local-path>#<feature>
	// 
	//  (0) This is a locally cached feature.
	//
	//  (1) Our "registry" is backed by GitHub public repositories (or repos visible with the environment's GITHUB_TOKEN).
	//      Say organization 'octocat' has a repo titled 'myfeatures' with a set of feature definitions.
	//      One of the [1..n] features in this repo has an id of 'helloworld'.
	//
	//      eg: octocat/myfeatures/helloworld
	//
	//      The above example assumes the 'latest' GitHub release, and internally will 
	//      fetch the devcontainer-features.tgz artifact from that release.
	//      To specify a certain release tag, append the tag with an @ symbol
	//
	//      eg: octocat/myfeatures/helloworld@v0.0.2
	//
	//  (2) A fully-qualified https URI to a devcontainer-features.tgz file can be provided instead
	//      of a using the GitHub registry "shorthand". Note this is identified by a
	//      s.StartsWith("https://" ||  "http://").
	//
	//      eg: https://example.com/../../devcontainer-features.tgz#helloworld
	//
	//  (3) This is a local path to a directory on disk following the expected file convention
	//      The path can either be:
	//          -  a relative file path to the .devcontainer file (prepended by a ./  or ../)
	//          -  an absolute file path (prepended by a /)
	//
	//      No version can be provided, as the directory is copied 'as is' and is inherently taking the 'latest'
	
	output.write(`Processing feature: ${userFeature.id}`)
			// cached feature
			if (!userFeature.id.includes('/') && !userFeature.id.includes('\\')) {
				output.write(`Cached feature found.`);

				let feat: Feature = {
					id: userFeature.id,
					name: userFeature.id,
					value: userFeature.options,
					included: true,
				}

				let newFeaturesSet: FeatureSet = {
					sourceInformation: {
						type: 'local-cache', 
					},
					features: [feat],
				};
				
				return newFeaturesSet;
			}

			// remote tar file
			if (userFeature.id.startsWith('http://') || userFeature.id.startsWith('https://'))
			{
				output.write(`Remote tar file found.`);
				let input = userFeature.id.replace(/\/+$/, '');
				const featureIdDelimiter = input.lastIndexOf('#');
				const id = input.substring(featureIdDelimiter + 1);

				if (id === '' || !allowedFeatureIdRegex.test(id)) {
					output.write(`Parse error. Specify a feature id with alphanumeric, dash, or underscore characters. Provided: ${id}.`, LogLevel.Error);
					return undefined;
				}

				const tarballUri = new URL.URL(input.substring(0, featureIdDelimiter)).toString();
				let feat: Feature = {
					id: id,
					name: userFeature.id,
					value: userFeature.options,
					included: true,
				}

				let newFeaturesSet: FeatureSet = {
					sourceInformation: {
						type: 'direct-tarball', 
						tarballUri: tarballUri 
					},
					features: [feat],
				};

				return newFeaturesSet;
			}

			// local disk
			const userFeaturePath = path.parse(userFeature.id);
			 // If its a valid path
			 if (userFeature.id.startsWith('./') || userFeature.id.startsWith('../') || (userFeaturePath && path.isAbsolute(userFeature.id))) {
			 //if (userFeaturePath && ((path.isAbsolute(userFeature.id) && existsSync(userFeature.id)) || !path.isAbsolute(userFeature.id))) {
				output.write(`Local disk feature.`);
				const filePath = userFeature.id;
				const id = userFeaturePath.name;
				const isRelative = !path.isAbsolute(userFeature.id);
				
				let feat: Feature = {
					id: id,
					name: userFeature.id,
					value: userFeature.options,
					included: true,
				}

				let newFeaturesSet: FeatureSet = {
					sourceInformation: {
						type: 'file-path', 
						filePath, 
						isRelative: isRelative
					},
					features: [feat],
				};

				return newFeaturesSet;
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
				output.write(`Invalid parse for GitHub/registry feature identifier. Follow format: '<publisher>/<feature-set>/<feature>'`, LogLevel.Error);
				return undefined;
			}
			const owner = splitOnSlash[0];
			const repo = splitOnSlash[1];
			const id = splitOnSlash[2];

			let feat: Feature = {
				id: owner + repo + id,
				name: userFeature.id,
				value: userFeature.options,
				included: true,
			};

			if (version === 'latest') {
				let newFeaturesSet: FeatureSet = {
					sourceInformation : {
					type: 'github-repo',
					apiUri: `https://api.github.com/repos/${owner}/${repo}/releases/latest`,
					unauthenticatedUri: `https://github.com/${owner}/${repo}/releases/latest/download/${ASSET_NAME}`,
					owner,
					repo,
					isLatest: true
					},
					features: [feat],
				};
				return newFeaturesSet;
			} else {
				// We must have a tag, return a tarball URI for the tagged version. 
				let newFeaturesSet: FeatureSet = {
					sourceInformation : {
					type: 'github-repo',
					apiUri: `https://api.github.com/repos/${owner}/${repo}/releases/tags/${version}`,
					unauthenticatedUri: `https://github.com/${owner}/${repo}/releases/download/${version}/${ASSET_NAME}`,
					owner,
					repo,
					tag: version,
					isLatest: false
					},
					features: [feat],
				};
				return newFeaturesSet;
			}
}

async function fetchFeatures(params: { extensionPath: string; cwd: string; output: Log; env: NodeJS.ProcessEnv }, featuresConfig: FeaturesConfig, localFeatures: FeatureSet, dstFolder: string) {
	for(const featureSet of featuresConfig.featureSets)	{
		try {
			if (!featureSet || !featureSet.features || !featureSet.sourceInformation)
			{
				continue;
			}

			if(!localFeatures)
			{
				continue;
			}

			const consecutiveId = featureSet.features[0].id + '_' + getCounter();
			// Calculate some predictable caching paths.
			const featCachePath = path.join(dstFolder, consecutiveId);

			featureSet.features[0].infoString = featCachePath;
			featureSet.features[0].consecutiveId = consecutiveId;

			if(featureSet.sourceInformation?.type === 'local-cache') {
				
				await mkdirpLocal(featCachePath);
				await cpDirectoryLocal(path.join(dstFolder, 'local-cache'), featCachePath);
				continue;
			}
		
			if(featureSet.sourceInformation?.type === 'file-path') {
				params.output.write(`Detected local file path`);
				
				const executionPath = featureSet.sourceInformation.isRelative ? path.join(params.cwd, featureSet.sourceInformation.filePath) : featureSet.sourceInformation.filePath;
				const jsonPath = path.join(executionPath, 'feature.json');

				const jsonString: Buffer = await readLocalFile(jsonPath);
				const featureJson = jsonc.parse(jsonString.toString());

				featureSet.features[0].runApp = featureJson.install.app ?? '';
				featureSet.features[0].runParams = featureJson.install.file ?? 'install.sh';
				featureSet.features[0].containerEnv = featureJson.containerEnv;

				// We only support version 2 for local features.
				featureSet.internalVersion = '2';

				await mkdirpLocal(featCachePath);
				await cpDirectoryLocal(executionPath, featCachePath);
				continue;
			}

			
			const tempTarballPath = path.join(dstFolder, ASSET_NAME);
			params.output.write(`Detected tarball`);
			const headers = getRequestHeaders(featureSet.sourceInformation, params.env, params.output);
			let tarballUri: string | undefined = undefined;
			if (featureSet.sourceInformation.type === 'github-repo') {
				params.output.write('Determining tarball URI for provided github repo.', LogLevel.Trace);
				if (headers.Authorization && headers.Authorization !== '') {
					params.output.write('Authenticated. Fetching from GH API.', LogLevel.Trace);
					tarballUri = await askGitHubApiForTarballUri(featureSet.sourceInformation, headers, params.output);
					headers.Accept = 'Accept: application/octet-stream';
				} else {
					params.output.write('Not authenticated. Fetching from unauthenticated uri', LogLevel.Trace);
					tarballUri = featureSet.sourceInformation.unauthenticatedUri;
				}
			} else {
				tarballUri = featureSet.sourceInformation.tarballUri;
			}
			
			if(tarballUri) {
				const options = {
					type: 'GET',
					url: tarballUri,
					headers
				};
				params.output.write(`Fetching tarball at ${options.url}`);
				params.output.write(`Headers: ${JSON.stringify(options)}`, LogLevel.Trace);
				const tarball = await request(options, params.output);

				if (!tarball || tarball.length === 0) {
					params.output.write(`Did not receive a response from tarball download URI`, LogLevel.Error);
					// Continue loop to the next remote feature.
					// TODO: Should be more fatal.
					await cleanupIterationFetchAndMerge(tempTarballPath, params.output);
					continue;
				}

				// Filter what gets emitted from the tar.extract().
				const filter = (file: string, _: tar.FileStat) => {
					// Don't include .dotfiles or the archive itself.
					if (file.startsWith('./.') || file === `./${ASSET_NAME}` || file === './.') {
						return false;
					}
					return true;
				};

				params.output.write(`Preparing to unarchive received tgz.`, LogLevel.Trace);
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

				// Read version information.
				const jsonPath = path.join(featCachePath, 'feature.json');

				if (existsSync(jsonPath)) {
					const jsonString: Buffer = await readLocalFile(jsonPath);
					const featureJson = jsonc.parse(jsonString.toString());
					featureSet.features[0].runApp = featureJson.install.app ?? '';
					featureSet.features[0].runParams = featureJson.install.file ?? 'install.sh';
					featureSet.features[0].containerEnv = featureJson.containerEnv;
					featureSet.internalVersion === '2';
				} else {
					featureSet.internalVersion === '1';
				}

			}
			continue;
		}
		catch (e) {
			params.output.write(`Exception: ${e?.Message} `, LogLevel.Trace);
		}
	}
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

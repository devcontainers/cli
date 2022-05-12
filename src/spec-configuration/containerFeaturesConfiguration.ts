/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as jsonc from 'jsonc-parser';
import * as path from 'path';
import * as semver from 'semver';
import * as URL from 'url';
import * as tar from 'tar';
import { DevContainerConfig } from './configuration';
import { mkdirpLocal, readLocalFile, rmLocal, writeLocalFile } from '../spec-utils/pfs';
import { Log, LogLevel } from '../spec-utils/log';
import { request } from '../spec-utils/httpRequest';

const ASSET_NAME = 'devcontainer-features.tgz';

export interface Feature {
	id: string;
	name: string;
	documentationURL?: string;
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

export function collapseFeaturesConfig(original: FeaturesConfig | undefined): CollapsedFeaturesConfig | undefined {

	if (!original) {
		return undefined;
	}

	const collapsed = {
		allFeatures: original.featureSets
			.map(fSet => fSet.features)
			.flat()
	};
	return collapsed;
}

export const multiStageBuildExploration = false;

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
			return 'local-cache';
		case 'direct-tarball':
			return Buffer.from(srcInfo.tarballUri).toString('base64');
		case 'github-repo':
			return `github-${srcInfo.owner}-${srcInfo.repo}-${srcInfo.isLatest ? 'latest' : srcInfo.tag}`;
		case 'file-path':
			return Buffer.from(srcInfo.filePath).toString('base64');
	}
}

// TODO: Move to node layer.
export function getContainerFeaturesBaseDockerFile() {
	return `
ARG BASE_IMAGE=mcr.microsoft.com/vscode/devcontainers/base:buster

#{featureBuildStages}

FROM $BASE_IMAGE

USER root

COPY . /tmp/build-features/

#{featureLayer}

#{copyFeatureBuildStages}

#{containerEnv}

ARG IMAGE_USER=root
USER $IMAGE_USER
`;
}

export function getFeatureLayers(featuresConfig: FeaturesConfig) {
	let result = '';
	const folders = (featuresConfig.featureSets || []).map(x => getSourceInfoString(x.sourceInformation));
	folders.forEach(folder => {
		result += `RUN cd /tmp/build-features/${folder} \\
&& chmod +x ./install.sh \\
&& ./install.sh

`;
	});
	return result;
}

// Parses a declared feature in user's devcontainer file into
// a usable URI to download remote features.
// RETURNS
// {
//  "id",              <----- The ID of the feature in the feature set.
//  sourceInformation  <----- Source information (is this locally cached, a GitHub remote feature, etc..), including tarballUri if applicable.
// }
//
export function parseFeatureIdentifier(input: string, output: Log): { id: string; sourceInformation: SourceInformation } | undefined {
	// A identifier takes this form:
	//      (0)  <feature>
	//      (1)  <publisher>/<feature-set>/<feature>@version
	//      (2)  https://<../URI/..>/devcontainer-features.tgz#<feature>
	//      (3) ./<local-path>#<feature>  -or-  ../<local-path>#<feature>  -or-   /<local-path>#<feature>
	// 
	//  (0) This is a locally cached feature. The function should return `undefined` for tarballUrl
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

	// Regexes
	const allowedFeatureIdRegex = new RegExp('^[a-zA-Z0-9_-]*$');

	// Case (0): Cached feature
	if (!input.includes('/')) {
		output.write(`[${input}] - No slash, must be locally cached feature.`, LogLevel.Trace);
		return {
			id: input,
			sourceInformation: { type: 'local-cache' },
		};
	}

	// Case (2): Direct URI to a tgz
	if (input.startsWith('http://') || input.startsWith('https://')) {
		output.write(`[${input}] - Direct URI`, LogLevel.Trace);

		// Trim any trailing slash character to make parsing easier.
		// A slash at the end of the direct tgz identifier is not important.
		input = input.replace(/\/+$/, '');

		// Parse out feature ID by splitting on final slash character.
		const featureIdDelimiter = input.lastIndexOf('#');
		const id = input.substring(featureIdDelimiter + 1);
		// Ensure feature id only contains the expected set of characters.
		if (id === '' || !allowedFeatureIdRegex.test(id)) {
			output.write(`Parse error. Specify a feature id with alphanumeric, dash, or underscore characters. Provided: ${id}.`, LogLevel.Error);
			return undefined;
		}
		const tarballUri =
			new URL.URL(input.substring(0, featureIdDelimiter))
				.toString();

		output.write(`[${input}] - uri: ${tarballUri} , id: ${id}`, LogLevel.Trace);
		return {
			id,
			sourceInformation: { 'type': 'direct-tarball', tarballUri }
		};
	}

	// Case (3): Local disk relative/absolute path to directory
	if (input.startsWith('/') || input.startsWith('./') || input.startsWith('../')) {
		// Currently unimplemented.
		return undefined;

		// const splitOnHash = input.split('#');
		// if (!splitOnHash || splitOnHash.length !== 2) {
		// 	output.write(`Parse error. Relative or absolute path to directory should be of the form: <PATH>#<FEATURE>`, LogLevel.Error);
		// 	return undefined;
		// }
		// const filePath = splitOnHash[0];
		// const id = splitOnHash[1];
		// if (!allowedFeatureIdRegex.test(id)) {
		// 	output.write(`Parse error. Specify a feature id with alphanumeric, dash, or underscore characters. Provided: ${id}.`, LogLevel.Error);
		// 	return undefined;
		// }
		// return {
		// 	id,
		// 	sourceInformation: { 'type': 'file-path', filePath, isRelative: input.startsWith('./') }
		// };
	}

	// Must be case (1) - GH
	let version = 'latest';
	let splitOnAt = input.split('@');
	if (splitOnAt.length > 2) {
		output.write(`Parse error. Use the '@' symbol only to designate a version tag.`, LogLevel.Error);
		return undefined;
	}
	if (splitOnAt.length === 2) {
		output.write(`[${input}] has version ${splitOnAt[1]}`, LogLevel.Trace);
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

	// Return expected tarball URI for a latest release on the parsed repo.
	const ghSrcInfo = createGitHubSourceInformation({ owner, repo, tag: version });
	return {
		id,
		sourceInformation: ghSrcInfo
	};
}

export function createGitHubSourceInformation(params: GithubSourceInformationInput): GithubSourceInformation {
	const { owner, repo, tag } = params;
	if (tag === 'latest') {
		return {
			type: 'github-repo',
			apiUri: `https://api.github.com/repos/${owner}/${repo}/releases/latest`,
			unauthenticatedUri: `https://github.com/${owner}/${repo}/releases/latest/download/${ASSET_NAME}`,
			owner,
			repo,
			isLatest: true
		};
	} else {
		// We must have a tag, return a tarball URI for the tagged version. 
		return {
			type: 'github-repo',
			apiUri: `https://api.github.com/repos/${owner}/${repo}/releases/tags/${tag}`,
			unauthenticatedUri: `https://github.com/${owner}/${repo}/releases/download/${tag}/${ASSET_NAME}`,
			owner,
			repo,
			tag,
			isLatest: false
		};
	}
}


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

async function fetchAndMergeRemoteFeaturesAsync(params: { extensionPath: string; output: Log; env: NodeJS.ProcessEnv }, featuresConfig: FeaturesConfig, config: DevContainerConfig) {

	const { output, env } = params;
	const { dstFolder } = featuresConfig;
	let buildFoldersCreatedAlready: String[] = [];

	// The requested features from the user's devcontainer
	const features = config.features;
	if (!features || !Object.keys(features).length) {
		return undefined;
	}

	// We need a dstFolder to know where to download remote resources to
	if (!dstFolder) {
		return undefined;
	}

	const tempTarballPath = path.join(dstFolder, ASSET_NAME);

	output.write(`Preparing to parse declared features and fetch remote features.`);

	for await (const id of Object.keys(features)) {
		const remoteFeatureParsed = parseFeatureIdentifier(id, output);

		if (remoteFeatureParsed === undefined) {
			output.write(`Failed to parse key: ${id}`, LogLevel.Error);
			// Failed to parse.
			// TODO: Should be more fatal.
			continue;
		}

		// -- Next section handles each possible type of "SourceInformation"

		const featureName = remoteFeatureParsed.id;
		const sourceInformation = remoteFeatureParsed.sourceInformation;
		const sourceType = sourceInformation.type;

		if (sourceType === 'local-cache') {
			output.write(`Detected local feature set. Continuing...`);
			continue;
		}

		const buildFolderName = getSourceInfoString(remoteFeatureParsed.sourceInformation);
		// Calculate some predictable caching paths.
		// Don't create the folder on-disk until we need it.
		const featCachePath = path.join(dstFolder, buildFolderName);

		// Break out earlier if already copied over remote features to dstFolder
		const alreadyExists = buildFoldersCreatedAlready.some(x => x === buildFolderName);
		if (alreadyExists) {
			output.write(`Already pulled remote resource for '${buildFolderName}'. No need to re-fetch.`); //TODO: not true, might have been updated on the repo since if we pulled `local`.  Should probably use commit SHA? 
			continue;
		}

		output.write(`Fetching: featureSet = ${buildFolderName}, feature = ${featureName}, Type = ${sourceType}`);

		if (sourceType === 'file-path') {
			output.write(`Local file-path to features on disk is unimplemented. Continuing...`);
			continue;
		} else {
			let tarballUri: string | undefined = undefined;
			const headers = getRequestHeaders(sourceInformation, env, output);

			// If this is 'github-repo', we need to do an API call to fetch the appropriate asset's tarballUri
			if (sourceType === 'github-repo') {
				output.write('Determining tarball URI for provided github repo.', LogLevel.Trace);
				if (headers.Authorization && headers.Authorization !== '') {
					output.write('Authenticated. Fetching from GH API.', LogLevel.Trace);
					tarballUri = await askGitHubApiForTarballUri(sourceInformation, headers, output);
					headers.Accept = 'Accept: application/octet-stream';
				} else {
					output.write('Not authenticated. Fetching from unauthenticated uri', LogLevel.Trace);
					tarballUri = sourceInformation.unauthenticatedUri;
				}
			} else if (sourceType === 'direct-tarball') {
				tarballUri = sourceInformation.tarballUri;
			} else {
				output.write(`Unhandled source type: ${sourceType}`, LogLevel.Error);
				continue;  // TODO: Should be more fatal?
			}

			// uri direct to the tarball either acquired at this point, or failed.
			if (tarballUri !== undefined && tarballUri !== '') {
				const options = {
					type: 'GET',
					url: tarballUri,
					headers
				};
				output.write(`Fetching tarball at ${options.url}`);
				output.write(`Headers: ${JSON.stringify(options)}`, LogLevel.Trace);
				const tarball = await request(options, output);

				if (!tarball || tarball.length === 0) {
					output.write(`Did not receive a response from tarball download URI`, LogLevel.Error);
					// Continue loop to the next remote feature.
					// TODO: Should be more fatal.
					await cleanupIterationFetchAndMerge(tempTarballPath, output);
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

				output.write(`Preparing to unarchive received tgz.`, LogLevel.Trace);
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

			} else {
				output.write(`Could not fetch features from constructed tarball URL`, LogLevel.Error);
				// Continue loop to the next remote feature.
				// TODO: Should be more fatal.
				await cleanupIterationFetchAndMerge(tempTarballPath, output);
				continue;
			}
		}

		// -- Whichever modality the feature-set was stored, at this point that process of retrieving and extracting a feature-set has completed successfully.
		//    Now, load in the devcontainer-features.json from the `featureCachePath` and continue merging into the featuresConfig.

		output.write('Attempting to load devcontainer-features.json', LogLevel.Trace);
		let newFeaturesSet: FeatureSet | undefined = await loadFeaturesJsonFromDisk(featCachePath, output);

		if (!newFeaturesSet || !newFeaturesSet.features || newFeaturesSet.features.length === 0) {
			output.write(`Unable to parse received devcontainer-features.json.`, LogLevel.Error);
			// TODO: Should be more fatal?
			await cleanupIterationFetchAndMerge(tempTarballPath, output);
			continue;
		}
		output.write(`Done loading FeatureSet ${buildFolderName} into from disk into memory`, LogLevel.Trace);

		// Merge sourceInformation if the remote featureSet provides one.
		// Priority is to maintain the values we had calculated previously.
		if (newFeaturesSet.sourceInformation) {
			newFeaturesSet = {
				...newFeaturesSet,
				sourceInformation: { ...newFeaturesSet.sourceInformation, ...sourceInformation },
			};
		}
		output.write(`Merged sourceInfomation`, LogLevel.Trace);

		// Add this new feature set to our featuresConfig
		featuresConfig.featureSets.push(newFeaturesSet);
		// Remember that we've succeeded in fetching this featureSet
		buildFoldersCreatedAlready.push(buildFolderName);

		// Clean-up
		await cleanupIterationFetchAndMerge(tempTarballPath, output);
		output.write(`Succeeded in fetching feature set ${buildFolderName}`, LogLevel.Trace);
	}

	// Return updated featuresConfig
	return featuresConfig;
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
export async function generateFeaturesConfig(params: { extensionPath: string; output: Log; env: NodeJS.ProcessEnv }, dstFolder: string, config: DevContainerConfig, imageLabelDetails: () => Promise<{definition?: string, version?:string}>, getLocalFolder: (d: string) => string) {
	const { output } = params;

	const userDeclaredFeatures = config.features;
	if (!userDeclaredFeatures || !Object.keys(userDeclaredFeatures).length) {
		return undefined;
	}

	// Create the featuresConfig object.
	// Initialize the featureSets object, and stash the dstFolder on the object for use later.
	let featuresConfig: FeaturesConfig = {
		featureSets: [],
		dstFolder
	};

	let locallyCachedFeatureSet = await loadFeaturesJsonFromDisk(getLocalFolder(params.extensionPath), output); // TODO: Pass dist folder instead to also work with the devcontainer.json support package.
	if (!locallyCachedFeatureSet) {
		output.write('Failed to load locally cached features', LogLevel.Error);
		return undefined;
	}

	// Add in the locally cached features
	locallyCachedFeatureSet = {
		...locallyCachedFeatureSet,
		sourceInformation: { 'type': 'local-cache' },
	};

	// Push feature set to FeaturesConfig
	featuresConfig.featureSets.push(locallyCachedFeatureSet);

	// Parse, fetch, and merge information on remote features (if any).
	// TODO: right now if anything fails in this method and we return `undefined`, we fallback to just the prior state of featureConfig (locally cached only). Is that what we want??
	featuresConfig = await fetchAndMergeRemoteFeaturesAsync(params, featuresConfig, config) ?? featuresConfig;

	// Run filtering and include user options into config.
	featuresConfig = await doReadUserDeclaredFeatures(params, config, featuresConfig, imageLabelDetails);
	if (featuresConfig.featureSets.every(set =>
		set.features.every(feature => feature.value === false))) {
		return undefined;
	}

	return featuresConfig;
}

const getUniqueFeatureId = (id: string, srcInfo: SourceInformation) => `${id}-${getSourceInfoString(srcInfo)}`;

// Given an existing featuresConfig, parse the user's features as they declared them in their devcontainer.
export async function doReadUserDeclaredFeatures(params: { output: Log }, config: DevContainerConfig, featuresConfig: FeaturesConfig, imageLabelDetails: () => Promise<{definition?: string, version?:string}>) {

	const { output } = params;
	const {definition, version} = await imageLabelDetails();

	// Map user's declared features to its appropriate feature-set feature.
	let configFeatures = config.features || {};
	let userValues: Record<string, string | boolean | Record<string, string | boolean>> = {};
	for (const feat of Object.keys(configFeatures)) {
		const { id, sourceInformation } = parseFeatureIdentifier(feat, output) ?? {};
		if (id && sourceInformation) {
			const uniqueId = getUniqueFeatureId(id, sourceInformation);
			userValues[uniqueId] = configFeatures[feat];
		} else {
			output.write(`Failed to read user declared feature ${feat}. Skipping.`, LogLevel.Error);
			continue;
		}
	}

	const included = {} as Record<string, boolean | undefined>;
	for (const featureSet of featuresConfig.featureSets) {
		for (const feature of featureSet.features) {
			updateFeature(feature); // REMOVEME: Temporary migration.
			const uniqueFeatureId = getUniqueFeatureId(feature.id, featureSet.sourceInformation);

			// Compare the feature to the base definition.
			if (definition && (feature.exclude || []).some(e => matches(e, definition, version))) {
				// The feature explicitly excludes the detected base definition
				feature.included = false;
			} else if ('include' in feature) {
				// The feature explicitly includes one or more base definitions
				// Set the included flag to true IFF we have detected a base definition, and its in the feature's list of includes
				feature.included = !!definition && (feature.include || []).some(e => matches(e, definition, version));
			} else {
				// The feature doesn't define any base definitions to "include" or "exclude" in which we can filter on.
				// By default, include it.
				feature.included = true;
			}

			// Mark feature as with its state of inclusion
			included[uniqueFeatureId] = included[uniqueFeatureId] || feature.included;

			// Set the user-defined values from the user's devcontainer onto the feature config.
			feature.value = userValues[uniqueFeatureId] || false;
		}
	}
	params.output.write('Feature configuration:\n' + JSON.stringify({ ...featuresConfig, imageDetails: undefined }, undefined, '  '), LogLevel.Trace);

	// Filter
	for (const featureSet of featuresConfig.featureSets) {
		featureSet.features = featureSet.features.filter(feature => {
			const uniqueFeatureId = getUniqueFeatureId(feature.id, featureSet.sourceInformation);
			// Ensure we are not including duplicate features.
			// Note: Takes first feature even if f.included == false.
			if (uniqueFeatureId in included && feature.included === included[uniqueFeatureId]) {  	// TODO: This logic should be revisited.
				delete included[feature.id];
				return true;
			}
			return false;
		});
	}
	return featuresConfig;
}

function updateFeature(feature: Feature & { type?: 'option' | 'choice'; values?: string[]; customValues?: boolean; hint?: string }) {
	// Update old to new properties for temporary compatiblity.
	if (feature.values) {
		const options = feature.options || (feature.options = {});
		options.version = {
			type: 'string',
			[feature.customValues ? 'proposals' : 'enum']: feature.values,
			default: feature.values[0],
			description: feature.hint,
		};
	}
	delete feature.type;
	delete feature.values;
	delete feature.customValues;
	delete feature.hint;
}

function matches(spec: string, definition: string, version: string | undefined) {
	const i = spec.indexOf('@');
	const [specDefinition, specVersion] = i !== -1 ? [spec.slice(0, i), spec.slice(i + 1)] : [spec, undefined];
	return definition === specDefinition && (!specVersion || !version || semver.satisfies(version, specVersion));
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

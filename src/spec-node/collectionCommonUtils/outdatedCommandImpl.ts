import * as jsonc from 'jsonc-parser';
import * as os from 'os';
import * as path from 'path';
import * as semver from 'semver';
import * as crypto from 'crypto';

import { Log, LogLevel, mapLogLevel, nullLog } from '../../spec-utils/log';
import { OutdatedArgs } from './outdated';
import { CLIHost, getCLIHost } from '../../spec-common/cliHost';
import { URI } from 'vscode-uri';
import { loadNativeModule } from '../../spec-common/commonUtils';
import textTable from 'text-table';
import { ContainerError } from '../../spec-common/errors';
import { getDevContainerConfigPathIn, getDefaultDevContainerConfigPath } from '../../spec-configuration/configurationCommonUtils';
import { fetchOCIFeature, getFeatureIdWithoutVersion, tryGetOCIFeatureSet } from '../../spec-configuration/containerFeaturesOCI';
import { getPackageConfig } from '../../spec-utils/product';
import { workspaceFromPath } from '../../spec-utils/workspaces';
import { readDevContainerConfigFile } from '../configContainer';
import { createLog, createDockerParams } from '../devContainers';
import { uriToFsPath, getCacheFolder, DockerResolverParameters, getDockerfilePath } from '../utils';
import { DevContainerConfig, DevContainerFromDockerfileConfig, getDockerComposeFilePaths } from '../../spec-configuration/configuration';
import { CommonParams, ManifestContainer, getRef, getVersionsStrictSorted } from '../../spec-configuration/containerCollectionsOCI';
import { DockerCLIParameters } from '../../spec-shutdown/dockerUtils';
import { request } from '../../spec-utils/httpRequest';
import { readDockerComposeConfig, getBuildInfoForService } from '../dockerCompose';
import { extractDockerfile, findBaseImage } from '../dockerfileUtils';
import { ContainerFeatureInternalParams, userFeaturesToArray, getFeatureIdType, DEVCONTAINER_FEATURE_FILE_NAME, Feature } from '../../spec-configuration/containerFeaturesConfiguration';
import { readLockfile } from '../../spec-configuration/lockfile';

export async function outdated({
	// 'user-data-folder': persistedFolder,
	'workspace-folder': workspaceFolderArg,
	config: configParam,
	'output-format': outputFormat,
	'log-level': logLevel,
	'log-format': logFormat,
	'terminal-rows': terminalRows,
	'terminal-columns': terminalColumns,
}: OutdatedArgs) {
	const disposables: (() => Promise<unknown> | undefined)[] = [];
	const dispose = async () => {
		await Promise.all(disposables.map(d => d()));
	};
	let output: Log | undefined;
	try {
		const workspaceFolder = path.resolve(process.cwd(), workspaceFolderArg);
		const configFile = configParam ? URI.file(path.resolve(process.cwd(), configParam)) : undefined;
		const cliHost = await getCLIHost(workspaceFolder, loadNativeModule, logFormat === 'text');
		const extensionPath = path.join(__dirname, '..', '..');
		const sessionStart = new Date();
		const pkg = getPackageConfig();
		output = createLog({
			logLevel: mapLogLevel(logLevel),
			logFormat,
			log: text => process.stderr.write(text),
			terminalDimensions: terminalColumns && terminalRows ? { columns: terminalColumns, rows: terminalRows } : undefined,
		}, pkg, sessionStart, disposables);

		const workspace = workspaceFromPath(cliHost.path, workspaceFolder);
		const configPath = configFile ? configFile : await getDevContainerConfigPathIn(cliHost, workspace.configFolderPath);
		const configs = configPath && await readDevContainerConfigFile(cliHost, workspace, configPath, true, output) || undefined;
		if (!configs) {
			throw new ContainerError({ description: `Dev container config (${uriToFsPath(configFile || getDefaultDevContainerConfigPath(cliHost, workspace!.configFolderPath), cliHost.platform)}) not found.` });
		}

		const cacheFolder = await getCacheFolder(cliHost);
		const params = {
			extensionPath,
			cacheFolder,
			cwd: cliHost.cwd,
			output,
			env: cliHost.env,
			skipFeatureAutoMapping: false,
			platform: cliHost.platform,
		};

		const outdatedFeatures = await loadFeatureVersionInfo(params, configs.config.config);

		const outputParams = { output, env: process.env };
		const dockerParams = await createDockerParams({
			containerDataFolder: undefined,
			containerSystemDataFolder: undefined,
			workspaceFolder,
			mountWorkspaceGitRoot: false,
			configFile,
			logLevel: mapLogLevel(logLevel),
			logFormat,
			log: text => process.stderr.write(text),
			terminalDimensions: /* terminalColumns && terminalRows ? { columns: terminalColumns, rows: terminalRows } : */ undefined, // TODO
			defaultUserEnvProbe: 'loginInteractiveShell',
			removeExistingContainer: false,
			buildNoCache: false,
			expectExistingContainer: false,
			postCreateEnabled: false,
			skipNonBlocking: false,
			prebuild: false,
			persistedFolder: undefined,
			additionalMounts: [],
			updateRemoteUserUIDDefault: 'never',
			additionalCacheFroms: [],
			useBuildKit: 'never',
			buildxPlatform: undefined,
			buildxPush: false,
			buildxOutput: undefined,
			buildxCacheTo: undefined,
			skipFeatureAutoMapping: false,
			skipPostAttach: false,
			skipPersistingCustomizationsFromFeatures: false,
			dotfiles: {
				repository: undefined,
				installCommand: undefined,
				targetPath: undefined
			},
			dockerPath: undefined,
			dockerComposePath: undefined,
			overrideConfigFile: undefined,
			remoteEnv: {}
		}, disposables);

		const outdatedImages = await loadImageVersionInfo(outputParams, configs.config.config, cliHost, dockerParams);

		await new Promise<void>((resolve, reject) => {
			let text = '';
			if (outputFormat === 'text') {
				const rows = Object.keys(outdatedFeatures.features).map(key => {
					const value = outdatedFeatures.features[key];
					return [getFeatureIdWithoutVersion(key), value.current, value.wanted, value.latest]
						.map(v => v === undefined ? '-' : v);
				});

				if (rows.length !== 0) {
					const featureHeader = ['Feature', 'Current', 'Wanted', 'Latest'];
					text = textTable([
						featureHeader,
						...rows,
					]);
				}

				if (outdatedImages !== undefined && outdatedImages.image !== undefined) {
					const imageHeader = ['Image', 'Current', 'Latest'];
					const image = outdatedImages.image;

					if (image.current !== undefined && image.wanted !== undefined && image.current !== image.wanted) {
						text += '\n\n';
						text += textTable([
							imageHeader,
							[image.name, image.current, image.wanted],
						]);
					}
				}
			} else {
				text = JSON.stringify({ ...outdatedFeatures, ...outdatedImages }, undefined, process.stdout.isTTY ? '  ' : undefined);
			}
			process.stdout.write(text + '\n', err => err ? reject(err) : resolve());
		});
	} catch (err) {
		if (output) {
			output.write(err && (err.stack || err.message) || String(err));
		} else {
			console.error(err);
		}
		await dispose();
		process.exit(1);
	}
	await dispose();
	process.exit(0);
}

/*
	image: mcr.microsoft.com/devcontainers/python:0.204-3.11-buster
	imageName: mcr.microsoft.com/devcontainers/python
	tag: 0.204-3.11-buster
	version: 0.204
	tagSuffix: 3.11-buster
*/
async function findImageVersionInfo(params: CommonParams, image: string, path: string, currentImageValue: string) {
	const { output } = params;
	const [imageName, tag] = image.split(':');

	if (tag === undefined) {
		output.write(`Skipping image '${imageName}' as it does not have a tag`, LogLevel.Trace);
		return { image: {} };
	}

	const [version, ...tagSuffixParts] = tag.split('-');
	const tagSuffix = tagSuffixParts.join('-');

	if (!imageName.startsWith('mcr.microsoft.com/devcontainers/') && !imageName.startsWith('mcr.microsoft.com/vscode/devcontainers/')) {
		output.write(`Skipping image '${imageName}' as it is not an image hosted from devcontainer/images`, LogLevel.Trace);
		return { image: {} };
	}

	const specialImages = ['base', 'cpp', 'universal'];
	const imageType = imageName.split('/').pop() || '';
	if (tag.startsWith('dev-') || (!specialImages.includes(imageType) && (!tag.includes('-') || !/\d/.test(tagSuffix))) || (specialImages.includes(imageType) && !/^\d/.test(tag))) {
		output.write(`Skipping image '${imageName}' as it does not pin to a semantic version`, LogLevel.Trace);
		return { image: {} };
	}

	try {
		const subName = imageName.replace('mcr.microsoft.com/', '');
		const url = `https://mcr.microsoft.com/v2/${subName}/tags/list`;
		const options = { type: 'GET', url, headers: {} };
		const data = JSON.parse((await request(options, output)).toString());

		const latestVersion: string = data.tags
			.filter((v: string) => v.endsWith(tagSuffix) && semver.valid(v.split('-')[0]))
			.map((v: string) => v.split('-')[0])
			.sort(semver.compare)
			.pop();

		if (latestVersion) {
			const wantedVersion = latestVersion.split('.').slice(0, version.split('.').length).join('.');
			const wantedTag = tagSuffix ? `${wantedVersion}-${tagSuffix}` : wantedVersion;

			if (wantedTag === tag) {
				output.write(`Image '${imageName}' is already at the latest version '${tag}'`, LogLevel.Trace);
				return { image: {} };
			}

			let newImageValue = `${imageName}:${wantedTag}`;

			// Useful when image tag is set with build args (eg. VARIANT)
			const currentImageTag = currentImageValue.split(':')[1];
			if (currentImageTag !== tag) {
				const currentTagSuffix = currentImageTag.split('-').slice(1).join('-');
				newImageValue = `${imageName}:${wantedVersion}-${currentTagSuffix}`;
			}

			return { image: { name: imageName, current: tag, wanted: wantedTag, currentImageValue, newImageValue, path } };
		} else {
			output.write(`Failed to find maximum satisfying latest version for image '${image}'`, LogLevel.Error);
		}
	} catch (e) {
		output.write(`Failed to parse published versions: ${e}`, LogLevel.Error);
	}

	return { image: {} };
}

// const image = config.image;
// const image = "mcr.microsoft.com/devcontainers/python:0-3.9";
// const image = "mcr.microsoft.com/devcontainers/python:0-3.9-buster";
// const image = "mcr.microsoft.com/devcontainers/python:0.203-3.9";
// const image = "mcr.microsoft.com/devcontainers/python:0.203.10-3.9";
// const image = "mcr.microsoft.com/devcontainers/python:0.204-3.11-buster";
// const image = "mcr.microsoft.com/devcontainers/python:3";
// const image = "mcr.microsoft.com/devcontainers/python:3.9";
// const image = "mcr.microsoft.com/devcontainers/python:3.9-buster";
// const image = "mcr.microsoft.com/devcontainers/python:dev";
// const image = "mcr.microsoft.com/devcontainers/python:latest";

// const image = "mcr.microsoft.com/devcontainers/base:0";
// const image = "mcr.microsoft.com/devcontainers/base:0-buster";
// const image = "mcr.microsoft.com/devcontainers/base:0.202-debian-10";
// const image = "mcr.microsoft.com/devcontainers/base:0.202.10-debian-10";
// const image = "mcr.microsoft.com/devcontainers/base:0.203.0-ubuntu-20.04";
// const image = "mcr.microsoft.com/devcontainers/base:ubuntu";
// const image = "mcr.microsoft.com/devcontainers/base:ubuntu-20.04";

// const image = "mcr.microsoft.com/devcontainers/cpp:0.206.6";
// const image = "mcr.microsoft.com/devcontainers/cpp:0.205";
// const image = "mcr.microsoft.com/devcontainers/cpp:0";
// const image = "mcr.microsoft.com/devcontainers/cpp:latest";

// const image = "mcr.microsoft.com/devcontainers/javascript-node:1.0.0-16";
// const image = "mcr.microsoft.com/devcontainers/javascript-node:14";

// const image = "mcr.microsoft.com/devcontainers/jekyll:3.3-bookworm";

// const image = "mcr.microsoft.com/vscode/devcontainers/universal:0";
// const image = "mcr.microsoft.com/vscode/devcontainers/universal:0.18.0-linux";
async function loadImageVersionInfo(params: CommonParams, config: DevContainerConfig, cliHost: CLIHost, dockerParams: DockerResolverParameters) {
	if ('image' in config && config.image !== undefined) {
		return findImageVersionInfo(params, config.image, config.configFilePath?.path || '', config.image);

	} else if ('build' in config && config.build !== undefined && 'dockerfile' in config.build) {
		const dockerfileUri = getDockerfilePath(cliHost, config as DevContainerFromDockerfileConfig);
		const dockerfilePath = await uriToFsPath(dockerfileUri, cliHost.platform);
		const dockerfileText = (await cliHost.readFile(dockerfilePath)).toString();
		const dockerfile = extractDockerfile(dockerfileText);

		if ('build' in config && config.build?.args !== undefined) {
			const image = findBaseImage(dockerfile, config.build.args, undefined);
			if (image === undefined) {
				return { image: {} };
			}

			return findImageVersionInfo(params, image, dockerfilePath, dockerfile.stages[0].from.image);
		}
	} else if ('dockerComposeFile' in config) {
		const { dockerCLI, dockerComposeCLI } = dockerParams;
		const { output } = params;
		const composeFiles = await getDockerComposeFilePaths(cliHost, config, cliHost.env, cliHost.cwd);
		const buildParams: DockerCLIParameters = { cliHost, dockerCLI, dockerComposeCLI, env: cliHost.env, output, platformInfo: dockerParams.platformInfo };
		const cwdEnvFile = cliHost.path.join(cliHost.cwd, '.env');
		const envFile = Array.isArray(config.dockerComposeFile) && config.dockerComposeFile.length === 0 && await cliHost.isFile(cwdEnvFile) ? cwdEnvFile : undefined;
		const composeConfig = await readDockerComposeConfig(buildParams, composeFiles, envFile);

		const services = Object.keys(composeConfig.services || {});
		if (services.indexOf(config.service) === -1) {
			output.write('Service not found in Docker Compose configuration');
			return { image: {} };
		}

		const composeService = composeConfig.services[config.service];
		if (composeService.image) {
			return findImageVersionInfo(params, composeService.image, composeFiles[0], composeService.image);
		} else {
			const serviceInfo = getBuildInfoForService(composeService, cliHost.path, composeFiles);
			if (serviceInfo.build) {
				const { context, dockerfilePath } = serviceInfo.build;
				const resolvedDockerfilePath = cliHost.path.isAbsolute(dockerfilePath) ? dockerfilePath : cliHost.path.resolve(context, dockerfilePath);
				const dockerfileText = (await cliHost.readFile(resolvedDockerfilePath)).toString();
				const dockerfile = extractDockerfile(dockerfileText);

				if (composeService.build?.args !== undefined) {
					const image = findBaseImage(dockerfile, composeService.build?.args, undefined);
					if (image === undefined) {
						return { image: {} };
					}

					return findImageVersionInfo(params, image, resolvedDockerfilePath, dockerfile.stages[0].from.image);
				}
			}
		}
	}

	return { image: {} };
}

export async function loadFeatureVersionInfo(params: ContainerFeatureInternalParams, config: DevContainerConfig) {
	const userFeatures = userFeaturesToArray(config);
	if (!userFeatures) {
		return { features: {} };
	}

	const { lockfile } = await readLockfile(config);

	const resolved: Record<string, any> = {};

	await Promise.all(userFeatures.map(async userFeature => {
		const userFeatureId = userFeature.userFeatureId;
		const featureRef = getRef(nullLog, userFeatureId); // Filters out Feature identifiers that cannot be versioned (e.g. local paths, deprecated, etc..)
		if (featureRef) {
			const versions = (await getVersionsStrictSorted(params, featureRef))
				?.reverse();
			if (versions) {
				const lockfileVersion = lockfile?.features[userFeatureId]?.version;
				let wanted = lockfileVersion;
				const tag = featureRef.tag;
				if (tag) {
					if (tag === 'latest') {
						wanted = versions[0];
					} else {
						wanted = versions.find(version => semver.satisfies(version, tag));
					}
				} else if (featureRef.digest && !wanted) {
					const { type, manifest } = await getFeatureIdType(params, userFeatureId, undefined);
					if (type === 'oci' && manifest) {
						const wantedFeature = await findOCIFeatureMetadata(params, manifest);
						wanted = wantedFeature?.version;
					}
				}
				resolved[userFeatureId] = {
					current: lockfileVersion || wanted,
					wanted,
					wantedMajor: wanted && semver.major(wanted)?.toString(),
					latest: versions[0],
					latestMajor: semver.major(versions[0])?.toString(),
				};
			}
		}
	}));

	// Reorder Features to match the order in which they were specified in config
	return {
		features: userFeatures.reduce((acc, userFeature) => {
			const r = resolved[userFeature.userFeatureId];
			if (r) {
				acc[userFeature.userFeatureId] = r;
			}
			return acc;
		}, {} as Record<string, any>)
	};
}

async function findOCIFeatureMetadata(params: ContainerFeatureInternalParams, manifest: ManifestContainer) {
	const annotation = manifest.manifestObj.annotations?.['dev.containers.metadata'];
	if (annotation) {
		return jsonc.parse(annotation) as Feature;
	}

	// Backwards compatibility.
	const featureSet = tryGetOCIFeatureSet(params.output, manifest.canonicalId, {}, manifest, manifest.canonicalId);
	if (!featureSet) {
		return undefined;
	}

	const tmp = path.join(os.tmpdir(), crypto.randomUUID());
	const f = await fetchOCIFeature(params, featureSet, tmp, tmp, DEVCONTAINER_FEATURE_FILE_NAME);
	return f.metadata as Feature | undefined;
}
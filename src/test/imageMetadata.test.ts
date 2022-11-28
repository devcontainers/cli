/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as path from 'path';
import { URI } from 'vscode-uri';
import { HostGPURequirements } from '../spec-configuration/configuration';
import { Feature, FeaturesConfig, FeatureSet, Mount } from '../spec-configuration/containerFeaturesConfiguration';
import { experimentalImageMetadataDefault } from '../spec-node/devContainers';
import { getDevcontainerMetadata, getDevcontainerMetadataLabel, getImageMetadata, getImageMetadataFromContainer, imageMetadataLabel, internalGetImageMetadata0, mergeConfiguration } from '../spec-node/imageMetadata';
import { SubstitutedConfig } from '../spec-node/utils';
import { ContainerDetails, ImageDetails } from '../spec-shutdown/dockerUtils';
import { nullLog } from '../spec-utils/log';
import { buildKitOptions, shellExec, testSubstitute } from './testUtils';

const pkg = require('../../package.json');

function configWithRaw<T>(raw: T): SubstitutedConfig<T> {
	return {
		config: testSubstitute(raw),
		raw,
		substitute: testSubstitute,
	};
}

describe('Image Metadata', function () {
	this.timeout('120s');

	const tmp = path.relative(process.cwd(), path.join(__dirname, 'tmp'));
	const cli = `npx --prefix ${tmp} devcontainer`;
	const testFolder = `${__dirname}/configs/image-metadata`;

	before('Install', async () => {
		await shellExec(`rm -rf ${tmp}/node_modules`);
		await shellExec(`mkdir -p ${tmp}`);
		await shellExec(`npm --prefix ${tmp} install devcontainers-cli-${pkg.version}.tgz`);
		await shellExec(`docker build -t image-metadata-test-base ${testFolder}/base-image`);
	});
	
	describe('CLI', () => {

		buildKitOptions.forEach(({ text, options }) => {
			it(`should collect metadata on image label  [${text}]`, async () => {
				if (!experimentalImageMetadataDefault) {
					return;
				}
				const buildKitOption = (options?.useBuildKit ?? false) ? '' : ' --buildkit=never';
				const res = await shellExec(`${cli} build --workspace-folder ${testFolder} --image-name image-metadata-test${buildKitOption}`);
				const response = JSON.parse(res.stdout);
				assert.strictEqual(response.outcome, 'success');
				const details = JSON.parse((await shellExec(`docker inspect image-metadata-test`)).stdout)[0] as ImageDetails;
				const { config: metadata, raw } = getImageMetadata(details, testSubstitute, true, nullLog);
				assert.strictEqual(metadata.length, 3);
				assert.strictEqual(metadata[0].id, 'baseFeature-substituted');
				assert.strictEqual(metadata[1].id, './localFeatureA-substituted');
				assert.strictEqual(metadata[1].init, true);
				assert.strictEqual(metadata[2].id, './localFeatureB-substituted');
				assert.strictEqual(metadata[2].privileged, true);
				assert.strictEqual(raw.length, 3);
				assert.strictEqual(raw[0].id, 'baseFeature');
				assert.strictEqual(raw[1].id, './localFeatureA');
				assert.ok(raw[1].customizations);
				assert.strictEqual(raw[1].customizations.vscode.extensions.length, 2);
				assert.strictEqual(raw[1].init, true);
				assert.strictEqual(raw[2].id, './localFeatureB');
				assert.strictEqual(raw[2].privileged, true);
			});
		});

		buildKitOptions.forEach(({ text, options }) => {
			it(`should omit appending Feature customizations with --skip-persisting-customizations-from-features [${text}]`, async () => {
				if (!experimentalImageMetadataDefault) {
					return;
				}
				const buildKitOption = (options?.useBuildKit ?? false) ? '' : ' --buildkit=never';
				const res = await shellExec(`${cli} build --skip-persisting-customizations-from-features --workspace-folder ${testFolder} --image-name skip-persisting-test${buildKitOption}`);
				const response = JSON.parse(res.stdout);
				assert.strictEqual(response.outcome, 'success');
				const details = JSON.parse((await shellExec(`docker inspect skip-persisting-test`)).stdout)[0] as ImageDetails;
				const { config: metadata, raw } = getImageMetadata(details, testSubstitute, true, nullLog);
				assert.strictEqual(metadata.length, 3);
				assert.strictEqual(metadata[0].id, 'baseFeature-substituted');
				assert.strictEqual(metadata[1].id, './localFeatureA-substituted');
				assert.strictEqual(metadata[1].init, true);
				assert.strictEqual(metadata[2].id, './localFeatureB-substituted');
				assert.strictEqual(metadata[2].privileged, true);
				assert.strictEqual(raw.length, 3);
				assert.strictEqual(raw[0].id, 'baseFeature');
				assert.strictEqual(raw[1].id, './localFeatureA');
				assert.ok(!raw[1].customizations); // Customizations have not been persisted due to the flag
				assert.strictEqual(raw[1].init, true);
				assert.strictEqual(raw[2].id, './localFeatureB');
				assert.strictEqual(raw[2].privileged, true);
			});

			it(`should omit appending Feature customizations with --skip-persisting-customizations-from-features [${text}]`, async () => {
				if (!experimentalImageMetadataDefault) {
					return;
				}
				const buildKitOption = (options?.useBuildKit ?? false) ? '' : ' --buildkit=never';
				const res = await shellExec(`${cli} build --skip-persisting-customizations-from-features --workspace-folder ${testFolder} --image-name skip-persisting-test${buildKitOption}`);
				const response = JSON.parse(res.stdout);
				assert.strictEqual(response.outcome, 'success');
				const details = JSON.parse((await shellExec(`docker inspect skip-persisting-test`)).stdout)[0] as ImageDetails;
				const { config: metadata, raw } = getImageMetadata(details, testSubstitute, true, nullLog);
				assert.strictEqual(metadata.length, 3);
				assert.strictEqual(metadata[0].id, 'baseFeature-substituted');
				assert.strictEqual(metadata[1].id, './localFeatureA-substituted');
				assert.strictEqual(metadata[1].init, true);
				assert.strictEqual(metadata[2].id, './localFeatureB-substituted');
				assert.strictEqual(metadata[2].privileged, true);
				assert.strictEqual(raw.length, 3);
				assert.strictEqual(raw[0].id, 'baseFeature');
				assert.strictEqual(raw[1].id, './localFeatureA');
				assert.ok(!raw[1].customizations); // Customizations have not been persisted due to the flag
				assert.strictEqual(raw[1].init, true);
				assert.strictEqual(raw[2].id, './localFeatureB');
				assert.strictEqual(raw[2].privileged, true);
			});

			[
				'image',
				'compose-image-without-features-minimal',
			].forEach(testFolderName => {
				const imageTestFolder = `${__dirname}/configs/${testFolderName}`;
			
				it(`build should collect metadata on image label [${testFolderName}, ${text}]`, async () => {
					if (!experimentalImageMetadataDefault) {
						return;
					}
					const imageName = `${testFolderName}${options.useBuildKit ? '' : '-buildkit'}-test`;
					const buildKitOption = (options?.useBuildKit ?? false) ? '' : ' --buildkit=never';
					const res = await shellExec(`${cli} build --workspace-folder ${imageTestFolder} --image-name ${imageName}${buildKitOption}`);
					const response = JSON.parse(res.stdout);
					assert.strictEqual(response.outcome, 'success');
					const details = JSON.parse((await shellExec(`docker inspect ${imageName}`)).stdout)[0] as ImageDetails;
					const baseDetails = JSON.parse((await shellExec(`docker inspect ubuntu:latest`)).stdout)[0] as ImageDetails;
					assert.notStrictEqual(details.Id, baseDetails.Id);
					const metadata = internalGetImageMetadata0(details, true, nullLog);
					assert.strictEqual(metadata.length, 1);
					assert.ok(metadata[0].remoteEnv);
				});
	
				it(`up should avoid new image when possible [${testFolderName}, ${text}]`, async () => {
					if (!experimentalImageMetadataDefault) {
						return;
					}
					const buildKitOption = (options?.useBuildKit ?? false) ? '' : ' --buildkit=never';
					const res = await shellExec(`${cli} up --workspace-folder ${imageTestFolder} --remove-existing-container${buildKitOption}`);
					const response = JSON.parse(res.stdout);
					assert.strictEqual(response.outcome, 'success');
					const details = JSON.parse((await shellExec(`docker inspect ${response.containerId}`)).stdout)[0] as ContainerDetails;
					assert.strictEqual(details.Config.Image, 'ubuntu:latest');
					const metadata = internalGetImageMetadata0(details, true, nullLog);
					assert.strictEqual(metadata.length, 1);
					assert.ok(metadata[0].remoteEnv);
					await shellExec(`docker exec ${response.containerId} test -f /postCreateCommand.txt`);
					await shellExec(`docker rm -f ${response.containerId}`);
				});
			});
		});
	});

	describe('Utils', () => {
		it('should collect metadata from devcontainer.json and features', () => {
			const { config: metadata, raw } = getDevcontainerMetadata(configWithRaw([]), configWithRaw({
				configFilePath: URI.parse('file:///devcontainer.json'),
				image: 'image',
				remoteUser: 'testUser',
			}), getFeaturesConfig([
				{
					id: 'someFeature',
					value: 'someValue',
					included: true,
				}
			]));
			assert.strictEqual(metadata.length, 2);
			assert.strictEqual(metadata[0].id, 'ghcr.io/my-org/my-repo/someFeature:1-substituted');
			assert.strictEqual(metadata[1].remoteUser, 'testUser');
			assert.strictEqual(raw.length, 2);
			assert.strictEqual(raw[0].id, 'ghcr.io/my-org/my-repo/someFeature:1');
			assert.strictEqual(raw[1].remoteUser, 'testUser');
		});

		const testContainerDetails: ContainerDetails = {
			Id: 'testId',
			Created: '2022-10-11T08:31:30.10478055Z',
			Name: 'testName',
			State: {
				Status: 'running',
				StartedAt: '2022-10-11T08:31:30.369653009Z',
				FinishedAt: '0001-01-01T00:00:00Z',
			},
			Config: {
				Image: 'testImage',
				User: 'testContainerUser',
				Env: null,
				Labels: {},
			},
			Mounts: [],
			NetworkSettings: {
				Ports: {},
			},
			Ports: [],
		};
	
		it('should read metadata from existing container', () => {
			const { config: metadata, raw } = getImageMetadataFromContainer({
				...testContainerDetails,
				Config: {
					...testContainerDetails.Config,
					Labels: {
						...testContainerDetails.Config.Labels,
						testIdLabel: 'testIdLabelValue',
						[imageMetadataLabel]: JSON.stringify({
							id: 'testId',
							remoteUser: 'testMetadataUser',
						}),
					},
				},
			}, configWithRaw({
				configFilePath: URI.parse('file:///devcontainer.json'),
				image: 'image',
				remoteUser: 'testConfigUser',
			}), undefined, ['testIdLabel=testIdLabelValue'], true, nullLog);
			assert.strictEqual(metadata.length, 2);
			assert.strictEqual(metadata[0].id, 'testId-substituted');
			assert.strictEqual(metadata[0].remoteUser, 'testMetadataUser');
			assert.strictEqual(metadata[1].remoteUser, 'testConfigUser');
			assert.strictEqual(raw.length, 2);
			assert.strictEqual(raw[0].id, 'testId');
			assert.strictEqual(raw[0].remoteUser, 'testMetadataUser');
			assert.strictEqual(raw[1].remoteUser, 'testConfigUser');
		});
	
		it('should add config for existing container without id labels', () => {
			const { config: metadata, raw } = getImageMetadataFromContainer({
				...testContainerDetails,
				Config: {
					...testContainerDetails.Config,
					Labels: {
						...testContainerDetails.Config.Labels,
						[imageMetadataLabel]: JSON.stringify({
							id: 'testId',
							remoteUser: 'testMetadataUser',
						}),
					},
				},
			}, configWithRaw({
				configFilePath: URI.parse('file:///devcontainer.json'),
				image: 'image',
				remoteUser: 'testConfigUser',
			}), undefined, ['testIdLabel=testIdLabelValue'], true, nullLog);
			assert.strictEqual(metadata.length, 2);
			assert.strictEqual(metadata[0].id, 'testId-substituted');
			assert.strictEqual(metadata[0].remoteUser, 'testMetadataUser');
			assert.strictEqual(metadata[1].remoteUser, 'testConfigUser');
			assert.strictEqual(raw.length, 2);
			assert.strictEqual(raw[0].id, 'testId');
			assert.strictEqual(raw[0].remoteUser, 'testMetadataUser');
			assert.strictEqual(raw[1].remoteUser, 'testConfigUser');
		});
	
		it('should update config for existing container', () => {
			const { config: metadata, raw } = getImageMetadataFromContainer({
				...testContainerDetails,
				Config: {
					...testContainerDetails.Config,
					Labels: {
						...testContainerDetails.Config.Labels,
						testIdLabel: 'testIdLabelValue',
						[imageMetadataLabel]: JSON.stringify({
							remoteEnv: {
								FOO: 'bar',
							},
						}),
					},
				},
			}, configWithRaw({
				configFilePath: URI.parse('file:///devcontainer.json'),
				image: 'image',
				remoteEnv: {
					FOO: 'baz',
					BAR: 'foo',
				},
			}), undefined, ['testIdLabel=testIdLabelValue'], true, nullLog);
			assert.strictEqual(metadata.length, 2);
			assert.deepStrictEqual(metadata[0].remoteEnv, {
				FOO: 'bar',
			});
			assert.deepStrictEqual(metadata[1].remoteEnv, {
				FOO: 'baz',
				BAR: 'foo',
			});
			assert.strictEqual(raw.length, 2);
			assert.deepStrictEqual(raw[0].remoteEnv, {
				FOO: 'bar',
			});
			assert.deepStrictEqual(raw[1].remoteEnv, {
				FOO: 'baz',
				BAR: 'foo',
			});
		});

		it('should fall back to config for existing container without metadata label', () => {
			const { config: metadata, raw } = getImageMetadataFromContainer(testContainerDetails, configWithRaw({
				configFilePath: URI.parse('file:///devcontainer.json'),
				image: 'image',
				remoteUser: 'testConfigUser',
			}), undefined, [], true, nullLog);
			assert.strictEqual(metadata.length, 1);
			assert.strictEqual(metadata[0].id, undefined);
			assert.strictEqual(metadata[0].remoteUser, 'testConfigUser');
			assert.strictEqual(raw.length, 1);
			assert.strictEqual(raw[0].id, undefined);
			assert.strictEqual(raw[0].remoteUser, 'testConfigUser');
		});

		it('should create label for Dockerfile', () => {
			const label = getDevcontainerMetadataLabel(getDevcontainerMetadata(configWithRaw([
				{
					id: 'baseFeature',
				}
			]), configWithRaw({
				configFilePath: URI.parse('file:///devcontainer.json'),
				image: 'image',
				remoteUser: 'testUser',
			}), getFeaturesConfig([
				{
					id: 'someFeature',
					value: 'someValue',
					included: true,
				}
			])), true);
			const expected = [
				{
					id: 'baseFeature',
				},
				{
					id: 'ghcr.io/my-org/my-repo/someFeature:1',
				},
				{
					remoteUser: 'testUser',
				}
			];
			assert.strictEqual(label.replace(/ \\\n/g, ''), `LABEL devcontainer.metadata="${JSON.stringify(expected).replace(/"/g, '\\"')}"`);
		});

		it('should merge metadata from devcontainer.json and features', () => {
			const merged = mergeConfiguration({
				configFilePath: URI.parse('file:///devcontainer.json'),
				image: 'image',
				remoteEnv: {
					ENV1: 'devcontainer.json',
					ENV3: 'devcontainer.json',
				},
			}, [
				{
					remoteEnv: {
						ENV1: 'feature1',
						ENV2: 'feature1',
						ENV3: 'feature1',
						ENV4: 'feature1',
					}
				},
				{
					remoteEnv: {
						ENV1: 'feature2',
						ENV2: 'feature2',
					}
				},
				{
					remoteEnv: {
						ENV1: 'devcontainer.json',
						ENV3: 'devcontainer.json',
					},
				}
			]);
			assert.strictEqual(merged.remoteEnv?.ENV1, 'devcontainer.json');
			assert.strictEqual(merged.remoteEnv?.ENV2, 'feature2');
			assert.strictEqual(merged.remoteEnv?.ENV3, 'devcontainer.json');
			assert.strictEqual(merged.remoteEnv?.ENV4, 'feature1');
		});

		it('should deduplicate mounts', () => {
			const merged = mergeConfiguration({
				configFilePath: URI.parse('file:///devcontainer.json'),
				image: 'image',
			}, [
				{
					mounts: [
						'source=source1,dst=target1,type=volume',
						'source=source2,target=target2,type=volume',
						'source=source3,destination=target3,type=volume',
					],
				},
				{
					mounts: [
						{
							source: 'source4',
							target: 'target1',
							type: 'volume'
						},
					],
				},
				{
					mounts: [
						{
							source: 'source5',
							target: 'target3',
							type: 'volume'
						},
					],
				},
			]);
			assert.strictEqual(merged.mounts?.length, 3);
			assert.strictEqual(typeof merged.mounts?.[0], 'string');
			assert.strictEqual(merged.mounts?.[0], 'source=source2,target=target2,type=volume');
			assert.strictEqual(typeof merged.mounts?.[1], 'object');
			assert.strictEqual((merged.mounts?.[1] as Mount).source, 'source4');
			assert.strictEqual(typeof merged.mounts?.[2], 'object');
			assert.strictEqual((merged.mounts?.[2] as Mount).source, 'source5');
		});
	});

	it('should merge gpu requirements from devcontainer.json and features', () => {
		const merged = mergeConfiguration({
			configFilePath: URI.parse('file:///devcontainer.json'),
			image: 'image',
			hostRequirements: {
				gpu: 'optional'
			}
		}, [
			{
				hostRequirements: {
					gpu: true
				}
			},
			{
				hostRequirements: {
					gpu: {
						cores: 4
					}
				}
			},
			{
				hostRequirements: {
					gpu: {
						memory: '8gb'
					}
				}
			}
		]);
		const gpuRequirement = merged.hostRequirements?.gpu as HostGPURequirements;
		assert.strictEqual(gpuRequirement?.cores, 4);
		assert.strictEqual(gpuRequirement?.memory, '8589934592');
	});
});

function getFeaturesConfig(features: Feature[]): FeaturesConfig {
	return {
		featureSets: features.map((feature): FeatureSet => ({
			features: [feature],
			sourceInformation: {
				type: 'oci',
				userFeatureId: `ghcr.io/my-org/my-repo/${feature.id}:1`,
				userFeatureIdWithoutVersion: `ghcr.io/my-org/my-repo/${feature.id}`,
				featureRef: {
					registry: 'ghcr.io',
					owner: 'my-org',
					namespace: 'my-org/my-repo',
					path: 'my-org/my-repo/test',
					resource: 'ghcr.io/my-org/my-repo/test',
					id: 'test',
					version: '1.2.3',
				},
				manifest: {
					schemaVersion: 1,
					mediaType: '',
					config: {
						digest: '',
						mediaType: '',
						size: 0,
					},
					layers: [],
				}
			}
		}))
	};
}
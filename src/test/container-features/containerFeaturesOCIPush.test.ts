import { assert } from 'chai';
import { DEVCONTAINER_TAR_LAYER_MEDIATYPE, getRef } from '../../spec-configuration/containerCollectionsOCI';
import { fetchOCIFeatureManifestIfExistsFromUserIdentifier } from '../../spec-configuration/containerFeaturesOCI';
import { calculateDataLayer, checkIfBlobExists, calculateManifestAndContentDigest } from '../../spec-configuration/containerCollectionsOCIPush';
import { createPlainLog, LogLevel, makeLog } from '../../spec-utils/log';
import { ExecResult, shellExec } from '../testUtils';
import * as path from 'path';
import * as fs from 'fs';
import { readLocalFile, writeLocalFile } from '../../spec-utils/pfs';
import { Feature } from '../../spec-configuration/containerFeaturesConfiguration';

const pkg = require('../../../package.json');

export const output = makeLog(createPlainLog(text => process.stdout.write(text), () => LogLevel.Trace));
const testAssetsDir = `${__dirname}/assets`;

interface PublishResult {
	publishedTags: string[];
	digest: string;
	version: string;
	publishedLegacyIds?: string[];
}

describe('Test OCI Push against reference registry', async function () {
	this.timeout('240s');

	const tmp = path.relative(process.cwd(), path.join(__dirname, 'tmp', Date.now().toString()));
	const cli = `npx --prefix ${tmp} devcontainer`;

	before('Install CLI and Start reference implementation registry', async () => {
		// Clean up any potential previous runs
		await shellExec(`docker rm registry -f`, {}, false, true);

		// Install CLI
		await shellExec(`rm -rf ${tmp}`);
		await shellExec(`mkdir -p ${tmp}`);
		await shellExec(`npm --prefix ${tmp} install devcontainers-cli-${pkg.version}.tgz`);

		// Copy contents of simple example to tmp
		// Do this so we can make changes to the files on disk to simulate editing/updating Features.
		await shellExec(`cp -r ${__dirname}/example-v2-features-sets/simple ${tmp}/simple-feature-set`);

		// Write htpasswd file to simulate basic auth.
		// Generated from 'htpasswd -cB -b auth.htpasswd myuser mypass'
		writeLocalFile(path.join(tmp, 'auth.htpasswd'), 'myuser:$2y$05$xmGlPoyYqECe3AY8GhO2ve1XvpxbSqe3yvPT2agOClbIeDIRAVPLC');

		const resolvedTmpPath = path.resolve(tmp);
		const startRegistryCmd = `docker run -d -p 5000:5000 \
-v ${resolvedTmpPath}/auth.htpasswd:/etc/docker/registry/auth.htpasswd \
-e REGISTRY_AUTH="{htpasswd: {realm: localhost, path: /etc/docker/registry/auth.htpasswd}}" \
--name registry \
registry`;

		await shellExec(startRegistryCmd, { cwd: tmp });

		// Wait for registry to start
		await shellExec(`docker exec registry sh -c "while ! nc -z localhost 5000; do sleep 3; done"`, { cwd: tmp });
		// Login with basic auth creds
		await shellExec('docker login -u myuser -p mypass localhost:5000');
	});

	it('Publish Features to registry', async () => {
		const collectionFolder = `${tmp}/simple-feature-set`;
		let success = false;

		let publishResult: ExecResult | undefined = undefined;
		let infoTagsResult: ExecResult | undefined = undefined;
		let infoManifestResult: ExecResult | undefined = undefined;
		let secondPublishResult: ExecResult | undefined = undefined;

		try {
			publishResult = await shellExec(`${cli} features publish --log-level trace -r localhost:5000 -n octocat/features ${collectionFolder}/src`, { env: { ...process.env, 'DEVCONTAINERS_OCI_AUTH': 'localhost:5000|myuser|mypass' } });
			success = true;

		} catch (error) {
			assert.fail('features publish sub-command should not throw');
		}

		assert.isTrue(success);
		assert.isDefined(publishResult);


		{
			const result: { [featureId: string]: PublishResult } = JSON.parse(publishResult.stdout);
			assert.equal(Object.keys(result).length, 2);

			const color = result['color'];
			assert.isDefined(color);
			assert.isDefined(color.digest);
			assert.deepEqual(color.publishedTags, [
				'1',
				'1.0',
				'1.0.0',
				'latest',
			]);
			assert.strictEqual(color.version, '1.0.0');
			assert.isUndefined(color.publishedLegacyIds);

			const hello = result['hello'];
			assert.isDefined(hello);
			assert.isDefined(hello.digest);
			assert.deepEqual(hello.publishedTags, [
				'1',
				'1.0',
				'1.0.0',
				'latest',
			]);
			assert.strictEqual(hello.version, '1.0.0');
			assert.isUndefined(hello.publishedLegacyIds);
		}

		// --- See that the Features can be queried from the Dev Container CLI.

		success = false; // Reset success flag.
		try {
			infoTagsResult = await shellExec(`${cli} features info tags localhost:5000/octocat/features/hello --output-format json --log-level trace`, { env: { ...process.env, 'DEVCONTAINERS_OCI_AUTH': 'localhost:5000|myuser|mypass' } });
			success = true;

		} catch (error) {
			assert.fail('features info tags sub-command should not throw');
		}

		assert.isTrue(success);
		assert.isDefined(infoTagsResult);
		const tags = JSON.parse(infoTagsResult.stdout);
		const publishedTags: string[] = tags['publishedTags'];
		assert.equal(publishedTags.length, 4);

		success = false; // Reset success flag.
		try {
			infoManifestResult = await shellExec(`${cli} features info manifest localhost:5000/octocat/features/hello --log-level trace`, { env: { ...process.env, 'DEVCONTAINERS_OCI_AUTH': 'localhost:5000|myuser|mypass' } });
			success = true;

		} catch (error) {
			assert.fail('features info tags sub-command should not throw');
		}

		assert.isTrue(success);
		assert.isDefined(infoManifestResult);
		const manifest = infoManifestResult.stdout;
		const regex = /application\/vnd\.devcontainers\.layer\.v1\+tar/;
		assert.match(manifest, regex);

		success = false; // Reset success flag.

		// -- Increment the version of a single Feature and run publish again

		const featureMetadataFilePath = `${collectionFolder}/src/hello/devcontainer-feature.json`;
		const featureMetadata: Feature = JSON.parse((await readLocalFile(featureMetadataFilePath)).toString());
		featureMetadata.version = '1.0.1';
		await writeLocalFile(featureMetadataFilePath, JSON.stringify(featureMetadata, null, 2));

		try {
			secondPublishResult = await shellExec(`${cli} features publish --log-level trace -r localhost:5000 -n octocat/features ${collectionFolder}/src`, { env: { ...process.env, 'DEVCONTAINERS_OCI_AUTH': 'localhost:5000|myuser|mypass' } });
			success = true;

		} catch (error) {
			assert.fail('features publish sub-command should not throw');
		}

		assert.isTrue(success);
		assert.isDefined(secondPublishResult);

		{

			const result: { [featureId: string]: PublishResult } = JSON.parse(secondPublishResult.stdout);
			assert.equal(Object.keys(result).length, 2);

			// -- Color was not changed, so it should not have been published again.
			const color = result['color'];
			assert.isDefined(color);
			assert.isObject(color);
			// Check that the color object has no properties
			assert.isUndefined(color.digest);
			assert.isUndefined(color.publishedTags);
			assert.isUndefined(color.version);

			// -- The breakfix version of hello was updated, so major and minor should be published again, too.
			const hello = result['hello'];
			assert.isDefined(hello);
			assert.isDefined(hello.digest);
			assert.isArray(hello.publishedTags);
			assert.deepEqual(hello.publishedTags, [
				'1',
				'1.0',
				'1.0.1',
				'latest',
			]);
			assert.strictEqual(hello.version, '1.0.1');
		}
	});

	it('Publish Features to registry with legacyIds', async () => {
		const collectionFolder = `${__dirname}/example-v2-features-sets/renaming-feature`;
		let success = false;

		let publishResult: ExecResult | undefined = undefined;
		let infoTagsResult: ExecResult | undefined = undefined;
		let infoManifestResult: ExecResult | undefined = undefined;
		let infoLegacyManifestResult: ExecResult | undefined = undefined;
		let infoLegacyManifest2Result: ExecResult | undefined = undefined;


		try {
			publishResult = await shellExec(`${cli} features publish --log-level trace -r localhost:5000 -n octocat/features2 ${collectionFolder}/src`, { env: { ...process.env, 'DEVCONTAINERS_OCI_AUTH': 'localhost:5000|myuser|mypass' } });
			success = true;

		} catch (error) {
			assert.fail('features publish sub-command should not throw');
		}

		assert.isTrue(success);
		assert.isDefined(publishResult);

		{
			const result: { [featureId: string]: PublishResult } = JSON.parse(publishResult.stdout);
			assert.equal(Object.keys(result).length, 2);

			const newColor = result['new-color'];
			assert.isDefined(newColor);
			assert.isDefined(newColor.digest);
			assert.deepEqual(newColor.publishedTags, [
				'1',
				'1.0',
				'1.0.1',
				'latest',
			]);
			assert.strictEqual(newColor.version, '1.0.1');
			assert.deepEqual(newColor.publishedLegacyIds, [
				'color',
				'old-color'
			]);

			const hello = result['hello'];
			assert.isDefined(hello);
			assert.isDefined(hello.digest);
			assert.deepEqual(hello.publishedTags, [
				'1',
				'1.0',
				'1.0.0',
				'latest',
			]);
			assert.strictEqual(hello.version, '1.0.0');
			assert.isUndefined(hello.publishedLegacyIds);
		}

		// --- See that the manifest of legacyIds and ID are equal
		success = false; // Reset success flag.
		try {
			infoManifestResult = await shellExec(`${cli} features info manifest localhost:5000/octocat/features2/new-color --log-level trace --output-format json`, { env: { ...process.env, 'DEVCONTAINERS_OCI_AUTH': 'localhost:5000|myuser|mypass' } });
			success = true;

		} catch (error) {
			assert.fail('features info tags sub-command should not throw');
		}

		assert.isTrue(success);
		assert.isDefined(infoManifestResult);
		const manifest = JSON.parse(infoManifestResult.stdout).manifest;

		success = false; // Reset success flag.
		try {
			infoLegacyManifestResult = await shellExec(`${cli} features info manifest localhost:5000/octocat/features2/color --log-level trace --output-format json`, { env: { ...process.env, 'DEVCONTAINERS_OCI_AUTH': 'localhost:5000|myuser|mypass' } });
			success = true;

		} catch (error) {
			assert.fail('features info tags sub-command should not throw');
		}

		assert.isTrue(success);
		assert.isDefined(infoManifestResult);
		const legacyManifest = JSON.parse(infoLegacyManifestResult.stdout).manifest;
		assert.deepEqual(JSON.stringify(manifest), JSON.stringify(legacyManifest));

		success = false; // Reset success flag.
		try {
			infoLegacyManifest2Result = await shellExec(`${cli} features info manifest localhost:5000/octocat/features2/old-color --log-level trace --output-format json`, { env: { ...process.env, 'DEVCONTAINERS_OCI_AUTH': 'localhost:5000|myuser|mypass' } });
			success = true;

		} catch (error) {
			assert.fail('features info tags sub-command should not throw');
		}

		assert.isTrue(success);
		assert.isDefined(infoManifestResult);
		const legacyManifest2 = JSON.parse(infoLegacyManifest2Result.stdout).manifest;
		assert.deepEqual(JSON.stringify(manifest), JSON.stringify(legacyManifest2));

		// --- Simple Feature
		success = false; // Reset success flag.
		try {
			infoTagsResult = await shellExec(`${cli} features info tags localhost:5000/octocat/features2/hello --output-format json --log-level trace`, { env: { ...process.env, 'DEVCONTAINERS_OCI_AUTH': 'localhost:5000|myuser|mypass' } });
			success = true;

		} catch (error) {
			assert.fail('features info tags sub-command should not throw');
		}

		assert.isTrue(success);
		assert.isDefined(infoTagsResult);
		const tags = JSON.parse(infoTagsResult.stdout);
		const publishedTags: string[] = tags['publishedTags'];
		assert.equal(publishedTags.length, 4);
	});
});

//  NOTE: 
//  Test depends on https://github.com/orgs/codspace/packages/container/non-empty-config-layer%2Fcolor/225254837?tag=1.0.0
describe('Test OCI Push Helper Functions', function () {
	this.timeout('10s');
	it('Generates the correct tgz manifest layer', async () => {

		const dataBytes = fs.readFileSync(`${testAssetsDir}/devcontainer-feature-color.tgz`);

		const featureRef = getRef(output, 'ghcr.io/codspace/non-empty-config-layer/color');
		if (!featureRef) {
			assert.fail();
		}

		// Calculate the tgz layer and digest
		const res = await calculateDataLayer(output, dataBytes, 'devcontainer-feature-color.tgz', DEVCONTAINER_TAR_LAYER_MEDIATYPE);
		const expected = {
			digest: 'sha256:0bb92d2da46d760c599d0a41ed88d52521209408b529761417090b62ee16dfd1',
			mediaType: 'application/vnd.devcontainers.layer.v1+tar',
			size: 3584,
			annotations: {
				'org.opencontainers.image.title': 'devcontainer-feature-color.tgz'
			}
		};

		if (!res) {
			assert.fail();
		}
		assert.deepEqual(res, expected);

		// Generate entire manifest to be able to calculate content digest
		const annotations = {
			'dev.containers.metadata': '{\"id\":\"color\",\"version\":\"1.0.0\",\"name\":\"A feature to remind you of your favorite color\",\"options\":{\"favorite\":{\"type\":\"string\",\"enum\":[\"red\",\"gold\",\"green\"],\"default\":\"red\",\"description\":\"Choose your favorite color.\"}}}',
			'com.github.package.type': 'devcontainer_feature'
		};
		const manifestContainer = await calculateManifestAndContentDigest(output, featureRef, res, annotations);
		if (!manifestContainer) {
			assert.fail();
		}
		const { contentDigest, manifestBuffer } = manifestContainer;

		// 'Expected' is taken from intermediate value in oras reference implementation, before hash calculation
		assert.strictEqual('{"schemaVersion":2,"mediaType":"application/vnd.oci.image.manifest.v1+json","config":{"mediaType":"application/vnd.devcontainers","digest":"sha256:44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a","size":2},"layers":[{"mediaType":"application/vnd.devcontainers.layer.v1+tar","digest":"sha256:0bb92d2da46d760c599d0a41ed88d52521209408b529761417090b62ee16dfd1","size":3584,"annotations":{"org.opencontainers.image.title":"devcontainer-feature-color.tgz"}}],"annotations":{"dev.containers.metadata":"{\\"id\\":\\"color\\",\\"version\\":\\"1.0.0\\",\\"name\\":\\"A feature to remind you of your favorite color\\",\\"options\\":{\\"favorite\\":{\\"type\\":\\"string\\",\\"enum\\":[\\"red\\",\\"gold\\",\\"green\\"],\\"default\\":\\"red\\",\\"description\\":\\"Choose your favorite color.\\"}}}","com.github.package.type":"devcontainer_feature"}}', manifestBuffer.toString());

		// This is the canonical digest of the manifest
		assert.strictEqual('sha256:dd328c25cc7382aaf4e9ee10104425d9a2561b47fe238407f6c0f77b3f8409fc', contentDigest);
	});

	it('Can fetch an artifact from a digest reference', async () => {
		const manifest = await fetchOCIFeatureManifestIfExistsFromUserIdentifier({ output, env: process.env }, 'ghcr.io/codspace/non-empty-config-layer/color', 'sha256:dd328c25cc7382aaf4e9ee10104425d9a2561b47fe238407f6c0f77b3f8409fc');
		assert.strictEqual(manifest?.manifestObj.layers[0].annotations['org.opencontainers.image.title'], 'devcontainer-feature-color.tgz');
	});

	it('Can check whether a blob exists', async () => {
		const ociFeatureRef = getRef(output, 'ghcr.io/codspace/non-empty-config-layer/color:1.0.0');
		if (!ociFeatureRef) {
			assert.fail('getRef() for the Feature should not be undefined');
		}


		const tarLayerBlobExists = await checkIfBlobExists({ output, env: process.env }, ociFeatureRef, 'sha256:0bb92d2da46d760c599d0a41ed88d52521209408b529761417090b62ee16dfd1');
		assert.isTrue(tarLayerBlobExists);

		const configLayerBlobExists = await checkIfBlobExists({ output, env: process.env }, ociFeatureRef, 'sha256:44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a');
		assert.isTrue(configLayerBlobExists);

		const randomStringDoesNotExist = await checkIfBlobExists({ output, env: process.env }, ociFeatureRef, 'sha256:41af286dc0b172ed2f1ca934fd2278de4a1192302ffa07087cea2682e7d372e3');
		assert.isFalse(randomStringDoesNotExist);
	});
});
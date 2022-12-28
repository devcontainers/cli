import { assert } from 'chai';
import { fetchAuthorizationHeader, DEVCONTAINER_TAR_LAYER_MEDIATYPE, getRef } from '../../spec-configuration/containerCollectionsOCI';
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
	publishedVersions: string[];
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
			assert.deepEqual(color.publishedVersions, [
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
			assert.deepEqual(hello.publishedVersions, [
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
		const publishedVersions: string[] = tags['publishedVersions'];
		assert.equal(publishedVersions.length, 4);

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
			assert.isUndefined(color.publishedVersions);
			assert.isUndefined(color.version);

			// -- The breakfix version of hello was updated, so major and minor should be published again, too.
			const hello = result['hello'];
			assert.isDefined(hello);
			assert.isDefined(hello.digest);
			assert.isArray(hello.publishedVersions);
			assert.deepEqual(hello.publishedVersions, [
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
			assert.deepEqual(newColor.publishedVersions, [
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
			assert.deepEqual(hello.publishedVersions, [
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
			infoManifestResult = await shellExec(`${cli} features info manifest localhost:5000/octocat/features2/new-color --log-level trace`, { env: { ...process.env, 'DEVCONTAINERS_OCI_AUTH': 'localhost:5000|myuser|mypass' } });
			success = true;

		} catch (error) {
			assert.fail('features info tags sub-command should not throw');
		}

		assert.isTrue(success);
		assert.isDefined(infoManifestResult);
		const manifest = infoManifestResult.stdout;

		success = false; // Reset success flag.
		try {
			infoManifestResult = await shellExec(`${cli} features info manifest localhost:5000/octocat/features2/color --log-level trace`, { env: { ...process.env, 'DEVCONTAINERS_OCI_AUTH': 'localhost:5000|myuser|mypass' } });
			success = true;

		} catch (error) {
			assert.fail('features info tags sub-command should not throw');
		}

		assert.isTrue(success);
		assert.isDefined(infoManifestResult);
		const legacyManifest = infoManifestResult.stdout;
		assert.deepEqual(manifest, legacyManifest);

		success = false; // Reset success flag.
		try {
			infoManifestResult = await shellExec(`${cli} features info manifest localhost:5000/octocat/features2/old-color --log-level trace`, { env: { ...process.env, 'DEVCONTAINERS_OCI_AUTH': 'localhost:5000|myuser|mypass' } });
			success = true;

		} catch (error) {
			assert.fail('features info tags sub-command should not throw');
		}

		assert.isTrue(success);
		assert.isDefined(infoManifestResult);
		const legacyManifest2 = infoManifestResult.stdout;
		assert.deepEqual(manifest, legacyManifest2);

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
		const publishedVersions: string[] = tags['publishedVersions'];
		assert.equal(publishedVersions.length, 4);
	});
});

//  NOTE: 
//  Test depends on https://github.com/codspace/features/pkgs/container/features%2Fgo/29819216?tag=1
describe('Test OCI Push Helper Functions', () => {
	it('Generates the correct tgz manifest layer', async () => {

		const dataBytes = fs.readFileSync(`${testAssetsDir}/go.tgz`);

		// Calculate the tgz layer and digest
		const res = await calculateDataLayer(output, dataBytes, 'go.tgz', DEVCONTAINER_TAR_LAYER_MEDIATYPE);
		const expected = {
			digest: 'sha256:b2006e7647191f7b47222ae48df049c6e21a4c5a04acfad0c4ef614d819de4c5',
			mediaType: 'application/vnd.devcontainers.layer.v1+tar',
			size: 15872,
			annotations: {
				'org.opencontainers.image.title': 'go.tgz'
			}
		};

		if (!res) {
			assert.fail();
		}
		assert.deepEqual(res, expected);

		// Generate entire manifest to be able to calculate content digest
		const digestContainer = await calculateManifestAndContentDigest(output, res, undefined);
		const contentDigest = digestContainer.contentDigest;
		const manifestStr = digestContainer.manifestStr;

		// 'Expected' is taken from intermediate value in oras reference implementation, before hash calculation
		assert.strictEqual('{"schemaVersion":2,"mediaType":"application/vnd.oci.image.manifest.v1+json","config":{"mediaType":"application/vnd.devcontainers","digest":"sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855","size":0},"layers":[{"mediaType":"application/vnd.devcontainers.layer.v1+tar","digest":"sha256:b2006e7647191f7b47222ae48df049c6e21a4c5a04acfad0c4ef614d819de4c5","size":15872,"annotations":{"org.opencontainers.image.title":"go.tgz"}}]}', manifestStr);

		// This is the canonical digest of the manifest
		assert.strictEqual('9726054859c13377c4c3c3c73d15065de59d0c25d61d5652576c0125f2ea8ed3', contentDigest);
	});

	it('Can fetch an artifact from a digest reference', async () => {
		const manifest = await fetchOCIFeatureManifestIfExistsFromUserIdentifier({ output, env: process.env }, 'ghcr.io/codspace/features/go', 'sha256:9726054859c13377c4c3c3c73d15065de59d0c25d61d5652576c0125f2ea8ed3');
		assert.strictEqual(manifest?.layers[0].annotations['org.opencontainers.image.title'], 'go.tgz');
	});

	it('Can check whether a blob exists', async () => {
		const ociFeatureRef = getRef(output, 'ghcr.io/codspace/features/go:1');
		if (!ociFeatureRef) {
			assert.fail('getRef() for the Feature should not be undefined');
		}
		const { registry, resource } = ociFeatureRef;
		const sessionAuth = await fetchAuthorizationHeader({ output, env: process.env }, registry, resource, 'pull');
		if (!sessionAuth) {
			assert.fail('Could not get registry auth token');
		}

		const tarLayerBlobExists = await checkIfBlobExists(output, ociFeatureRef, 'sha256:b2006e7647191f7b47222ae48df049c6e21a4c5a04acfad0c4ef614d819de4c5', sessionAuth);
		assert.isTrue(tarLayerBlobExists);

		const configLayerBlobExists = await checkIfBlobExists(output, ociFeatureRef, 'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', sessionAuth);
		assert.isTrue(configLayerBlobExists);

		const randomStringDoesNotExist = await checkIfBlobExists(output, ociFeatureRef, 'sha256:41af286dc0b172ed2f1ca934fd2278de4a1192302ffa07087cea2682e7d372e3', sessionAuth);
		assert.isFalse(randomStringDoesNotExist);
	});
});
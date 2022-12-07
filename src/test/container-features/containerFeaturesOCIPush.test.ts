import { assert } from 'chai';
import { fetchRegistryAuthToken, DEVCONTAINER_TAR_LAYER_MEDIATYPE, getRef } from '../../spec-configuration/containerCollectionsOCI';
import { fetchOCIFeatureManifestIfExistsFromUserIdentifier } from '../../spec-configuration/containerFeaturesOCI';
import { calculateDataLayer, checkIfBlobExists, calculateManifestAndContentDigest } from '../../spec-configuration/containerCollectionsOCIPush';
import { createPlainLog, LogLevel, makeLog } from '../../spec-utils/log';


export const output = makeLog(createPlainLog(text => process.stdout.write(text), () => LogLevel.Trace));
const testAssetsDir = `${__dirname}/assets`;

//  NOTE: 
//  Test depends on https://github.com/codspace/features/pkgs/container/features%2Fgo/29819216?tag=1
describe('Test OCI Push', () => {
	it('Generates the correct tgz manifest layer', async () => {

		// Calculate the tgz layer and digest
		const res = await calculateDataLayer(output, `${testAssetsDir}/go.tgz`, DEVCONTAINER_TAR_LAYER_MEDIATYPE);
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
		const { manifestStr, digest } = await calculateManifestAndContentDigest(output, res, undefined);

		// 'Expected' is taken from intermediate value in oras reference implementation, before hash calculation
		assert.strictEqual('{"schemaVersion":2,"mediaType":"application/vnd.oci.image.manifest.v1+json","config":{"mediaType":"application/vnd.devcontainers","digest":"sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855","size":0},"layers":[{"mediaType":"application/vnd.devcontainers.layer.v1+tar","digest":"sha256:b2006e7647191f7b47222ae48df049c6e21a4c5a04acfad0c4ef614d819de4c5","size":15872,"annotations":{"org.opencontainers.image.title":"go.tgz"}}]}', manifestStr);

		// This is the canonical digest of the manifest
		assert.strictEqual('9726054859c13377c4c3c3c73d15065de59d0c25d61d5652576c0125f2ea8ed3', digest);
	});

	it('Can fetch an artifact from a digest reference', async () => {
		const manifest = await fetchOCIFeatureManifestIfExistsFromUserIdentifier(output, process.env, 'ghcr.io/codspace/features/go', 'sha256:9726054859c13377c4c3c3c73d15065de59d0c25d61d5652576c0125f2ea8ed3');
		assert.strictEqual(manifest?.layers[0].annotations['org.opencontainers.image.title'], 'go.tgz');
	});

	it('Can check whether a blob exists', async () => {
		const ociFeatureRef = getRef(output, 'ghcr.io/codspace/features/go:1');
		if (!ociFeatureRef) {
			assert.fail('getRef() for the Feature should not be undefined');
		}
		const { registry, resource } = ociFeatureRef;
		const sessionAuth = await fetchRegistryAuthToken(output, registry, resource, process.env, 'pull');
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
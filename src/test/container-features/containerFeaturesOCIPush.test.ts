import { assert } from 'chai';
import { fetchAuthorization, DEVCONTAINER_TAR_LAYER_MEDIATYPE, getRef } from '../../spec-configuration/containerCollectionsOCI';
import { fetchOCIFeatureManifestIfExistsFromUserIdentifier } from '../../spec-configuration/containerFeaturesOCI';
import { calculateDataLayer, checkIfBlobExists, calculateManifestAndContentDigest } from '../../spec-configuration/containerCollectionsOCIPush';
import { createPlainLog, LogLevel, makeLog } from '../../spec-utils/log';
import { ExecResult, shellExec } from '../testUtils';
import * as path from 'path';
import { writeLocalFile } from '../../spec-utils/pfs';

const pkg = require('../../../package.json');

export const output = makeLog(createPlainLog(text => process.stdout.write(text), () => LogLevel.Trace));
const testAssetsDir = `${__dirname}/assets`;

describe('Test OCI Push against reference registry', async function () {
	this.timeout('240s');

	const tmp = path.relative(process.cwd(), path.join(__dirname, 'tmp', Date.now().toString()));
	const cli = `npx --prefix ${tmp} devcontainer`;

	before('Install CLI and Start reference implementation registry', async () => {
		// Clean up any potential previous runs
		await shellExec(`docker rm registry -f`, {}, false, true);

		// Install CLI
		await shellExec(`rm -rf ${tmp}/node_modules`);
		await shellExec(`mkdir -p ${tmp}`);
		await shellExec(`npm --prefix ${tmp} install devcontainers-cli-${pkg.version}.tgz`);

		// Write htpasswd file to simulate basic auth.
		// Generated from 'htpasswd -cB -b auth.htpasswd myuser mypass'
		writeLocalFile(path.join(tmp, 'auth.htpasswd'), 'myuser:$2y$05$xmGlPoyYqECe3AY8GhO2ve1XvpxbSqe3yvPT2agOClbIeDIRAVPLC');

		const resolvedTmpPath = path.resolve(tmp);
		const startRegistryCmd = `docker run -d -p 5000:5000 \
-v ${resolvedTmpPath}/certs:/certs \
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
		const collectionFolder = `${__dirname}/example-v2-features-sets/simple`;
		let success = false;
		let result: ExecResult | undefined = undefined;
		try {
			result = await shellExec(`${cli} features publish --log-level trace -r localhost:5000 -n octocat/features ${collectionFolder}/src`, { env: { ...process.env, 'DEVCONTAINERS_OCI_AUTH': 'localhost:5000|myuser|mypass' } });
			success = true;

		} catch (error) {
			assert.fail('features publish sub-command should not throw');
		}

		assert.isTrue(success);
		assert.isDefined(result);
	});
});

//  NOTE: 
//  Test depends on https://github.com/codspace/features/pkgs/container/features%2Fgo/29819216?tag=1
describe('Test OCI Push Helper Functions', () => {
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
		const sessionAuth = await fetchAuthorization(output, registry, resource, process.env, 'pull');
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
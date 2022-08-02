// import { assert } from 'chai';
// import { getFeatureManifest, getFeatureBlob, getFeatureRef, createManifest } from '../../spec-configuration/containerFeaturesOCI';
import { assert } from 'chai';
import { calculateContentDigest, calculateTgzLayer, getFeatureBlob, getFeatureManifest, getFeatureRef, validateOCIFeature } from '../../spec-configuration/containerFeaturesOCI';
import { createPlainLog, LogLevel, makeLog } from '../../spec-utils/log';

export const output = makeLog(createPlainLog(text => process.stdout.write(text), () => LogLevel.Trace));
const testAssetsDir = `${__dirname}/assets`;

describe('Test OCI Pull', () => {

    it('Parse OCI identifier', async () => {
        const feat = getFeatureRef(output, 'ghcr.io/codspace/features/ruby:1');
        output.write(`feat: ${JSON.stringify(feat)}`);

        assert.equal(feat.id, 'ghcr.io/codspace/features/ruby');
        assert.equal(feat.featureName, 'ruby');
        assert.equal(feat.owner, 'codspace');
        assert.equal(feat.namespace, 'codspace/features');
        assert.equal(feat.registry, 'ghcr.io');
        assert.equal(feat.version, '1');
    });

    it('Get a manifest.', async () => {
        const featureRef = getFeatureRef(output, 'ghcr.io/codspace/features/ruby:1');
        const manifest = await getFeatureManifest(output, process.env, 'https://ghcr.io/v2/codspace/features/ruby/manifests/1', featureRef);
        assert.isNotNull(manifest);
        assert.exists(manifest);

        if (!manifest) {
            return;
        }

        output.write(`mediaType: ${manifest.mediaType}`);
        manifest.layers.forEach(layer => {
            output.write(`Layer mediaType: ${layer.mediaType}`);
            output.write(`Layer digest: ${layer.digest}`);
            output.write(`Layer size: ${layer.size}`);

            output.write(`Layer imageTitle: ${layer.annotations['org.opencontainers.image.title']}`);
        });

        assert.equal(manifest.layers[0].digest, 'sha256:c33008d0dc12d0e631734082401bec692da809eae2ac51e24f58c1cac68fc0c9');
    });

    it('Download a feature', async () => {
        const featureRef = getFeatureRef(output, 'ghcr.io/codspace/features/ruby:1');
        const result = await getFeatureBlob(output, process.env, 'https://ghcr.io/v2/codspace/features/ruby/blobs/sha256:c33008d0dc12d0e631734082401bec692da809eae2ac51e24f58c1cac68fc0c9', '/tmp', '/tmp/featureTest', featureRef);
        assert.isTrue(result);
    });
});

describe('Test Generate Manifests and Digests', () => {
    // Example: 
    //    https://github.com/codspace/features/pkgs/container/features%2Fgo/29819216?tag=1
    //    NOTE: This artifact was originally pushed via the oras reference implementation.
    it('Generates the correct tgz manifest layer', async () => {

        // Calculate the tgz layer
        const res = await calculateTgzLayer(output, `${testAssetsDir}/go.tgz`);
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
        const { manifestStr, hash } = await calculateContentDigest(output, res);

        // 'Expected' is taken from intermediate value in oras reference implementation, before hash calculation
        assert.strictEqual('{"schemaVersion":2,"mediaType":"application/vnd.oci.image.manifest.v1+json","config":{"mediaType":"application/vnd.devcontainers","digest":"sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855","size":0},"layers":[{"mediaType":"application/vnd.devcontainers.layer.v1+tar","digest":"sha256:b2006e7647191f7b47222ae48df049c6e21a4c5a04acfad0c4ef614d819de4c5","size":15872,"annotations":{"org.opencontainers.image.title":"go.tgz"}}]}', manifestStr);

        assert.strictEqual('9726054859c13377c4c3c3c73d15065de59d0c25d61d5652576c0125f2ea8ed3', hash);
    });

    it('Can fetch an artifact from a digest reference', async () => {
        const manifest = await validateOCIFeature(output, process.env, 'ghcr.io/codspace/features/go', 'sha256:9726054859c13377c4c3c3c73d15065de59d0c25d61d5652576c0125f2ea8ed3');
        assert.strictEqual(manifest?.layers[0].annotations['org.opencontainers.image.title'], 'go.tgz');
    });
});
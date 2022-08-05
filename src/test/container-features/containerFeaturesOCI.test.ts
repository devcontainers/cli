import { assert } from 'chai';
import { getFeatureBlob, getFeatureManifest, getFeatureRef } from '../../spec-configuration/containerFeaturesOCI';
import { createPlainLog, LogLevel, makeLog } from '../../spec-utils/log';

export const output = makeLog(createPlainLog(text => process.stdout.write(text), () => LogLevel.Trace));

describe('Test OCI Pull', () => {

    it('Parse OCI identifier', async () => {
        const feat = getFeatureRef(output, 'ghcr.io/codspace/features/ruby:1');
        output.write(`feat: ${JSON.stringify(feat)}`);

        assert.equal(feat.id, 'ruby');
        assert.equal(feat.namespace, 'codspace/features');
        assert.equal(feat.owner, 'codspace');
        assert.equal(feat.registry, 'ghcr.io');
        assert.equal(feat.resource, 'ghcr.io/codspace/features/ruby');
        assert.equal(feat.version, '1');
    });

    it('Get a manifest by tag', async () => {
        const featureRef = getFeatureRef(output, 'ghcr.io/codspace/features/ruby:1.0.14');
        const manifest = await getFeatureManifest(output, process.env, 'https://ghcr.io/v2/codspace/features/ruby/manifests/1.0.14', featureRef);
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
        const featureRef = getFeatureRef(output, 'ghcr.io/codspace/features/ruby:1.0.14');
        const result = await getFeatureBlob(output, process.env, 'https://ghcr.io/v2/codspace/features/ruby/blobs/sha256:c33008d0dc12d0e631734082401bec692da809eae2ac51e24f58c1cac68fc0c9', '/tmp', '/tmp/featureTest', featureRef);
        assert.isTrue(result);
    });
});
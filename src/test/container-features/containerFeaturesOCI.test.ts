import { assert } from 'chai';
import { getRef, getManifest, getBlob } from '../../spec-configuration/containerCollectionsOCI';
import { createPlainLog, LogLevel, makeLog } from '../../spec-utils/log';

export const output = makeLog(createPlainLog(text => process.stdout.write(text), () => LogLevel.Trace));

describe('Test OCI Pull', () => {
    it('Parse OCI identifier', async () => {
        const feat = getRef(output, 'ghcr.io/codspace/features/ruby:1');
        output.write(`feat: ${JSON.stringify(feat)}`);

        assert.equal(feat.id, 'ruby');
        assert.equal(feat.namespace, 'codspace/features');
        assert.equal(feat.owner, 'codspace');
        assert.equal(feat.registry, 'ghcr.io');
        assert.equal(feat.resource, 'ghcr.io/codspace/features/ruby');
        assert.equal(feat.version, '1');
        assert.equal(feat.path, 'codspace/features/ruby');
    });

    it('Get a manifest by tag', async () => {
        const featureRef = getRef(output, 'ghcr.io/codspace/features/ruby:1.0.13');
        const manifest = await getManifest(output, process.env, 'https://ghcr.io/v2/codspace/features/ruby/manifests/1.0.13', featureRef);
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

        assert.equal(manifest.layers[0].digest, 'sha256:8f59630bd1ba6d9e78b485233a0280530b3d0a44338f472206090412ffbd3efb');
    });

    it('Download a feature', async () => {
        const featureRef = getRef(output, 'ghcr.io/codspace/features/ruby:1.0.13');
        const files = await getBlob(output, process.env, 'https://ghcr.io/v2/codspace/features/ruby/blobs/sha256:8f59630bd1ba6d9e78b485233a0280530b3d0a44338f472206090412ffbd3efb', '/tmp', '/tmp/featureTest', featureRef);
        assert.isArray(files);
    });
});
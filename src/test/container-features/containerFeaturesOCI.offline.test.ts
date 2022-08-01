// import { assert } from 'chai';
// import { getFeatureManifest, getFeatureBlob, getFeatureRef, createManifest } from '../../spec-configuration/containerFeaturesOCI';
import { assert } from 'chai';
import { calculateTgzLayer } from '../../spec-configuration/containerFeaturesOCI';
import { createPlainLog, LogLevel, makeLog } from '../../spec-utils/log';

export const output = makeLog(createPlainLog(text => process.stdout.write(text), () => LogLevel.Trace));
const testAssetsDir = `${__dirname}/assets`;

// describe('Test OCI Pull', () => {

//     it('Parse OCI identifier', async () => {
//         const feat = getFeatureRef(output, 'ghcr.io/codspace/features/ruby:1');
//         output.write(`feat: ${JSON.stringify(feat)}`);

//         assert.equal(feat.id, 'ghcr.io/codspace/features/ruby');
//         assert.equal(feat.featureName, 'ruby');
//         assert.equal(feat.owner, 'codspace');
//         assert.equal(feat.namespace, 'codspace/features');
//         assert.equal(feat.registry, 'ghcr.io');
//         assert.equal(feat.version, '1');
//     });

//     it('Get a manifest.', async () => {
//         const featureRef = getFeatureRef(output, 'ghcr.io/codspace/features/ruby:1');
//         const manifest = await getFeatureManifest(output, process.env, 'https://ghcr.io/v2/codspace/features/ruby/manifests/1', featureRef);
//         assert.isNotNull(manifest);
//         assert.exists(manifest);

//         if (!manifest) {
//             return;
//         }

//         output.write(`mediaType: ${manifest.mediaType}`);
//         manifest.layers.forEach(layer => {
//             output.write(`Layer mediaType: ${layer.mediaType}`);
//             output.write(`Layer digest: ${layer.digest}`);
//             output.write(`Layer size: ${layer.size}`);

//             output.write(`Layer imageTitle: ${layer.annotations['org.opencontainers.image.title']}`);
//         });

//         assert.equal(manifest.layers[0].digest, 'sha256:c33008d0dc12d0e631734082401bec692da809eae2ac51e24f58c1cac68fc0c9');
//     });

//     it('Download a feature', async () => {
//         const featureRef = getFeatureRef(output, 'ghcr.io/codspace/features/ruby:1');
//         const result = await getFeatureBlob(output, process.env, 'https://ghcr.io/v2/codspace/features/ruby/blobs/sha256:c33008d0dc12d0e631734082401bec692da809eae2ac51e24f58c1cac68fc0c9', '/tmp', '/tmp/featureTest', featureRef);
//         assert.isTrue(result);
//     });
// });

describe('Test OCI Push', () => {

    it('Generates the correct tgz manifest layer', async () => {
        const res = await calculateTgzLayer(output, `${testAssetsDir}/go.tgz`);
        const expected = {
            digest: 'sha256:b2006e7647191f7b47222ae48df049c6e21a4c5a04acfad0c4ef614d819de4c5',
            mediaType: 'application/octet-stream',
            size: 15872
        };
        assert.deepEqual(res, expected);
    });
});
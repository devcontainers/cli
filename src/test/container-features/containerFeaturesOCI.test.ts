import { assert } from 'chai';
import { getRef, getManifest, getBlob, getCollectionRef } from '../../spec-configuration/containerCollectionsOCI';
import { createPlainLog, LogLevel, makeLog } from '../../spec-utils/log';

export const output = makeLog(createPlainLog(text => process.stdout.write(text), () => LogLevel.Trace));

describe('getCollectionRef()', async function () {
    this.timeout('120s');


    it('valid getCollectionRef()', async () => {
        const collectionRef = getCollectionRef(output, 'ghcr.io', 'devcontainers/templates');
        if (!collectionRef) {
            assert.fail('collectionRef should not be undefined');
        }
        assert.ok(collectionRef);
        assert.equal(collectionRef.registry, 'ghcr.io');
        assert.equal(collectionRef.path, 'devcontainers/templates');
        assert.equal(collectionRef.resource, 'ghcr.io/devcontainers/templates');
        assert.equal(collectionRef.version, 'latest');
    });

    it('valid getCollectionRef() that was originally uppercase', async () => {
        const collectionRef = getCollectionRef(output, 'GHCR.IO', 'DEVCONTAINERS/TEMPLATES');
        if (!collectionRef) {
            assert.fail('collectionRef should not be undefined');
        }
        assert.ok(collectionRef);
        assert.equal(collectionRef.registry, 'ghcr.io');
        assert.equal(collectionRef.path, 'devcontainers/templates');
        assert.equal(collectionRef.resource, 'ghcr.io/devcontainers/templates');
        assert.equal(collectionRef.version, 'latest');
    });

    it('valid getCollectionRef() with port in registry', async () => {
        const collectionRef = getCollectionRef(output, 'ghcr.io:8001', 'devcontainers/templates');
        if (!collectionRef) {
            assert.fail('collectionRef should not be undefined');
        }
        assert.ok(collectionRef);
        assert.equal(collectionRef.registry, 'ghcr.io:8001');
        assert.equal(collectionRef.path, 'devcontainers/templates');
        assert.equal(collectionRef.resource, 'ghcr.io:8001/devcontainers/templates');
        assert.equal(collectionRef.version, 'latest');
    });

    it('invalid getCollectionRef() with an invalid character in path', async () => {
        const collectionRef = getCollectionRef(output, 'ghcr.io', 'devcont%ainers/templates');
        assert.isUndefined(collectionRef);
    });

    it('invalid getCollectionRef() with too many slashes in path', async () => {
        const collectionRef = getCollectionRef(output, 'ghcr.io', 'devcontainers//templates');
        assert.isUndefined(collectionRef);
    });

});

describe('getRef()', async function () {
    this.timeout('120s');

    it('valid getRef() with a tag', async () => {
        const feat = getRef(output, 'ghcr.io/devcontainers/templates/docker-from-docker:latest');
        if (!feat) {
            assert.fail('featureRef should not be undefined');
        }
        assert.ok(feat);
        assert.equal(feat.id, 'docker-from-docker');
        assert.equal(feat.namespace, 'devcontainers/templates');
        assert.equal(feat.owner, 'devcontainers');
        assert.equal(feat.registry, 'ghcr.io');
        assert.equal(feat.resource, 'ghcr.io/devcontainers/templates/docker-from-docker');
        assert.equal(feat.version, 'latest');
        assert.equal(feat.path, 'devcontainers/templates/docker-from-docker');
    });

    it('valid getRef() without a version tag', async () => {
        const feat = getRef(output, 'ghcr.io/devcontainers/templates/docker-from-docker');
        if (!feat) {
            assert.fail('featureRef should not be undefined');
        }
        assert.ok(feat);
        assert.equal(feat.id, 'docker-from-docker');
        assert.equal(feat.namespace, 'devcontainers/templates');
        assert.equal(feat.owner, 'devcontainers');
        assert.equal(feat.registry, 'ghcr.io');
        assert.equal(feat.resource, 'ghcr.io/devcontainers/templates/docker-from-docker');
        assert.equal(feat.path, 'devcontainers/templates/docker-from-docker');
        assert.equal(feat.version, 'latest'); // Defaults to 'latest' if not version supplied. 
    });

    it('valid getRef() automatically downcases', async () => {
        const feat = getRef(output, 'ghcr.io/DeVContainERS/templates/Docker-FROM-Docker');
        if (!feat) {
            assert.fail('featureRef should not be undefined');
        }
        assert.ok(feat);
        assert.equal(feat.id, 'docker-from-docker');
        assert.equal(feat.namespace, 'devcontainers/templates');
        assert.equal(feat.owner, 'devcontainers');
        assert.equal(feat.registry, 'ghcr.io');
        assert.equal(feat.resource, 'ghcr.io/devcontainers/templates/docker-from-docker');
        assert.equal(feat.path, 'devcontainers/templates/docker-from-docker');
        assert.equal(feat.version, 'latest'); // Defaults to 'latest' if not version supplied. 
    });

    it('valid getRef() with a registry that contains a port.', async () => {
        const feat = getRef(output, 'docker.io:8001/devcontainers/templates/docker-from-docker:latest');
        if (!feat) {
            assert.fail('featureRef should not be undefined');
        }
        assert.ok(feat);
        assert.equal(feat.id, 'docker-from-docker');
        assert.equal(feat.namespace, 'devcontainers/templates');
        assert.equal(feat.owner, 'devcontainers');
        assert.equal(feat.registry, 'docker.io:8001');
        assert.equal(feat.resource, 'docker.io:8001/devcontainers/templates/docker-from-docker');
        assert.equal(feat.path, 'devcontainers/templates/docker-from-docker');
        assert.equal(feat.version, 'latest'); // Defaults to 'latest' if not version supplied. 
    });

    it('valid getRef() really short path and no version', async () => {
        const feat = getRef(output, 'docker.io:8001/a/b/c');
        if (!feat) {
            assert.fail('featureRef should not be undefined');
        }
        assert.ok(feat);
        assert.equal(feat.id, 'c');
        assert.equal(feat.namespace, 'a/b');
        assert.equal(feat.owner, 'a');
        assert.equal(feat.registry, 'docker.io:8001');
        assert.equal(feat.resource, 'docker.io:8001/a/b/c');
        assert.equal(feat.path, 'a/b/c');
        assert.equal(feat.version, 'latest'); // Defaults to 'latest' if not version supplied. 
    });

    it('invalid getRef() with duplicate version tags', async () => {
        const feat = getRef(output, 'ghcr.io/devcontainers/templates/docker-from-docker:latest:latest');
        assert.isUndefined(feat);
    });

    it('invalid getRef() with invalid character in namespace', async () => {
        const feat = getRef(output, 'ghcr.io/devco%ntainers/templates/docker-from-docker:latest');
        assert.isUndefined(feat);
    });

    it('invalid getRef() with invalid character in feature name', async () => {
        const feat = getRef(output, 'ghcr.io/devcontainers/templates/docker-from@docker:latest');
        assert.isUndefined(feat);
    });

    it('invalid getRef() with missing path with version tag', async () => {
        const feat = getRef(output, 'ghcr.io/:latest');
        assert.isUndefined(feat);
    });

    it('invalid getRef() with missing path without version tag', async () => {
        const feat = getRef(output, 'ghcr.io');
        assert.isUndefined(feat);
    });

    it('invalid getRef() multiple slashes in sequence', async () => {
        const feat = getRef(output, 'ghcr.io/devcontainers//templates/docker-from-docker:latest');
        assert.isUndefined(feat);
    });

});

describe('Test OCI Pull', () => {
    it('Parse OCI identifier', async () => {
        const feat = getRef(output, 'ghcr.io/codspace/features/ruby:1');
        if (!feat) {
            assert.fail('featureRef should not be undefined');
        }
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
        if (!featureRef) {
            assert.fail('featureRef should not be undefined');
        }
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
        if (!featureRef) {
            assert.fail('featureRef should not be undefined');
        }
        const blobResult = await getBlob(output, process.env, 'https://ghcr.io/v2/codspace/features/ruby/blobs/sha256:8f59630bd1ba6d9e78b485233a0280530b3d0a44338f472206090412ffbd3efb', '/tmp', '/tmp/featureTest', featureRef);
        assert.isDefined(blobResult);
        assert.isArray(blobResult?.files);
    });
});
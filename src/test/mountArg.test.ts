import { assert } from 'chai';
import { parseMountArg } from '../spec-configuration/containerFeaturesConfiguration';

describe('parseMountArg', () => {

    it('parses the bind/volume form into a mount object', () => {
        assert.deepEqual(parseMountArg('type=volume,source=cache,target=/cache,external=true'), {
            type: 'volume',
            source: 'cache',
            target: '/cache',
            external: true,
        });
    });

    it('passes any other mount through to the container runtime unchanged', () => {
        const mount = 'type=image,source=localhost/devtools:latest,target=/nix,subpath=/nix';
        assert.strictEqual(parseMountArg(mount), mount);
    });
});

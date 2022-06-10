import { assert } from 'chai';
import * as yaml from 'js-yaml';
import { getBuildInfoForService } from '../spec-node/dockerCompose';

function loadYamlAndGetBuildInfoForService(input: string) {
    const yamlInput = yaml.load(input);
    return getBuildInfoForService(yamlInput);
}

describe('docker-compose - getBuildInfoForService', () => {

    it('Parses fully specified info', () => {
        const input = `
image: my-image
build:
  context: context-path
  dockerfile: my-dockerfile
  target: a-target
`;
        const info = loadYamlAndGetBuildInfoForService(input);
        assert.deepEqual(info, {
            image: 'my-image',
            build: {
                context: 'context-path',
                dockerfilePath: 'my-dockerfile',
                target: 'a-target'
            }
        });
    });

    it('Parses image-only info', () => {
        const input = `
image: my-image
`;
        const info = loadYamlAndGetBuildInfoForService(input);
        assert.deepEqual(info, {
            image: 'my-image'
        });
    });

    it('Parses string build info', () => {
        const input = `
image: my-image
build: ./a-path
`;
        const info = loadYamlAndGetBuildInfoForService(input);
        assert.deepEqual(info, {
            image: 'my-image',
            build: {
                context: './a-path',
                dockerfilePath: 'Dockerfile'
            }
        });
    });

    it('Supplies defaults dockerFilePath when not set', () => {
        const input = `
build:
  context: ./a-path
`;
        const info = loadYamlAndGetBuildInfoForService(input);
        assert.deepEqual(info, {
            image: undefined,
            build: {
                context: './a-path',
                dockerfilePath: 'Dockerfile',
                target: undefined
            }
        });
    });


});

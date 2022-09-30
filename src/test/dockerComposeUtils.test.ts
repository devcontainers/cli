import { assert } from 'chai';
import * as yaml from 'js-yaml';
import * as path from 'path';
import { getBuildInfoForService } from '../spec-node/dockerCompose';

const testComposeFile = path.join('somepath', 'docker-compose.yml');

function loadYamlAndGetBuildInfoForService(input: string) {
    const yamlInput = yaml.load(input);
    return getBuildInfoForService(yamlInput, path, [testComposeFile]);
}

describe('docker-compose - getBuildInfoForService', () => {

    it('Parses fully specified info', () => {
        const input = `
image: my-image
build:
  context: context-path
  dockerfile: my-dockerfile
  target: a-target
  args:
    arg1: value1
`;
        const info = loadYamlAndGetBuildInfoForService(input);
        assert.deepEqual(info, {
            image: 'my-image',
            build: {
                context: 'context-path',
                dockerfilePath: 'my-dockerfile',
                target: 'a-target',
                args: {
                    arg1: 'value1',
                },
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

    it('Supplies default dockerFilePath when not set', () => {
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
                target: undefined,
                args: undefined,
            }
        });
    });

    it('Supplies default context when not set', () => {
        const input = `
build:
  dockerfile: my-dockerfile
`;
        const info = loadYamlAndGetBuildInfoForService(input);
        assert.deepEqual(info, {
            image: undefined,
            build: {
                context: path.dirname(testComposeFile),
                dockerfilePath: 'my-dockerfile',
                target: undefined,
                args: undefined,
            }
        });
    });


});

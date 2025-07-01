import { assert } from 'chai';
import * as yaml from 'js-yaml';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { getBuildInfoForService, readDockerComposeConfig } from '../spec-node/dockerCompose';
import { DockerCLIParameters, dockerComposeCLI, DockerComposeCLI } from '../spec-shutdown/dockerUtils';
import { nullLog } from '../spec-utils/log';
import { CLIHost, getCLIHost } from '../spec-common/cliHost';
import { mapNodeOSToGOOS, mapNodeArchitectureToGOARCH } from '../spec-configuration/containerCollectionsOCI';

const testComposeFile = path.join('somepath', 'docker-compose.yml');
const testDockerComposeCliDetails: DockerComposeCLI = { version: '2.0.0', cmd: 'docker', args: ['compose'] };

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

describe('docker-compose - readDockerComposeConfig', () => {
	let tmpFolder: string;

	beforeEach(async () => {
		tmpFolder = fs.mkdtempSync(path.join(os.tmpdir(), 'devcontainers-test-'));
	});

	afterEach(() => {
		if (tmpFolder) {
			fs.rmSync(tmpFolder, { recursive: true, force: true });
		}
	});

	function createTestDockerCLIParameters(cliHost: CLIHost, env: NodeJS.ProcessEnv = {}): DockerCLIParameters {
		return {
			cliHost,
			dockerCLI: 'docker',
			dockerComposeCLI: () => Promise.resolve(testDockerComposeCliDetails),
			env,
			output: nullLog,
			platformInfo: {
				os: mapNodeOSToGOOS(cliHost.platform),
				arch: mapNodeArchitectureToGOARCH(cliHost.arch),
			}
		};
	}

	it('should include --profile * when COMPOSE_PROFILE is not set', async () => {
		const dockerFileContent = 'FROM alpine';
		const composeFileContent = `
services:
  test-service:
    build: .
`;
		fs.writeFileSync(path.join(tmpFolder, 'Dockerfile'), dockerFileContent);
		fs.writeFileSync(path.join(tmpFolder, 'docker-compose.yml'), composeFileContent);

		const cliHost = await getCLIHost(tmpFolder, async (imageName: string) => imageName as any, true);
		const params = createTestDockerCLIParameters(cliHost);
		let composeArgs: string[] = [];
		const originalDockerComposeCLI = dockerComposeCLI;
		(dockerComposeCLI as any) = async (_params: DockerCLIParameters, ...args: string[]) => {
			composeArgs = args;
			return originalDockerComposeCLI(_params, ...args);
		};

		try {
			await readDockerComposeConfig(params, [path.join(tmpFolder, 'docker-compose.yml')], undefined);
		} finally {
			(dockerComposeCLI as any) = originalDockerComposeCLI; // Restore original
		}

		assert.include(composeArgs, '--profile');
		assert.include(composeArgs, '*');
	});

	it('should not include --profile * when COMPOSE_PROFILE is set', async () => {
		const dockerFileContent = 'FROM alpine';
		const composeFileContent = `
services:
  test-service:
    build: .
`;
		fs.writeFileSync(path.join(tmpFolder, 'Dockerfile'), dockerFileContent);
		fs.writeFileSync(path.join(tmpFolder, 'docker-compose.yml'), composeFileContent);

		const cliHost = await getCLIHost(tmpFolder, async (imageName: string) => imageName as any, true);
		const params = createTestDockerCLIParameters(cliHost, { COMPOSE_PROFILE: 'my-profile' });
		let composeArgs: string[] = [];
		const originalDockerComposeCLI = dockerComposeCLI;
		(dockerComposeCLI as any) = async (_params: DockerCLIParameters, ...args: string[]) => {
			composeArgs = args;
			return originalDockerComposeCLI(_params, ...args);
		};

		try {
			await readDockerComposeConfig(params, [path.join(tmpFolder, 'docker-compose.yml')], undefined);
		} finally {
			(dockerComposeCLI as any) = originalDockerComposeCLI; // Restore original
		}
		assert.notInclude(composeArgs, '--profile');
		assert.notInclude(composeArgs, '*');
	});
});

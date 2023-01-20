import { assert } from 'chai';
import * as sinon from 'sinon';
import * as yaml from 'js-yaml';
import * as path from 'path';
import fs from 'fs';
import child_process from 'child_process';
import { getBuildInfoForService } from '../spec-node/dockerCompose';
import { isGitUrl, cloneGitRepo } from '../spec-utils/git';

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

    describe('context set as git URL', () => {
        // Mocking realpath and stat method fs module
        const stubRealpath = sinon.stub(fs.promises, 'realpath');
        const stubStats = sinon.stub(fs.promises, 'stat');

        // Mocked output stats
        const stats: fs.Stats = {
            isDirectory: () => false,
            isFile: () => false,
            isBlockDevice: () => false,
            isCharacterDevice: () => false,
            isSymbolicLink: () => false,
            isFIFO: () => false,
            isSocket: () => false,
            dev: 0,
            ino: 0,
            mode: 0,
            nlink: 0,
            uid: 0,
            gid: 0,
            rdev: 0,
            size: 0,
            blksize: 0,
            blocks: 0,
            atimeMs: 0,
            mtimeMs: 0,
            ctimeMs: 0,
            birthtimeMs: 0,
            atime: new Date(),
            mtime: new Date(),
            ctime: new Date(),
            birthtime: new Date()
        };

        before(() => {
            const spawnSyncOutput: child_process.SpawnSyncReturns<string | Buffer> = {
                pid: 0,
                output: [],
                stdout: 'success',
                stderr: '',
                status: null,
                signal: null,
                error: undefined // this is important as we want to ensure spawnSync doesn't throw any error
            };

            // Mocking spawnSync to return as success
            sinon.stub(child_process, 'spawnSync').returns(spawnSyncOutput);
            // Mocking mkdtemp to always return a specific directory
            sinon.stub(fs.promises, 'mkdtemp').resolves('/tmp/vscode-dev-containers-XXXXX');
        });

        after(() => {
            sinon.restore();
        });

        it('Parses git URL without branch', async () => {
            const input = `
    build:
        context: https://github.com/user/repo.git
    `;

            const info = loadYamlAndGetBuildInfoForService(input);
            assert.deepEqual(info, {
                image: undefined,
                build: {
                    context: 'https://github.com/user/repo.git',
                    dockerfilePath: 'Dockerfile',
                    target: undefined,
                    args: undefined,
                }
            });

            assert.isTrue(isGitUrl(info.build!.context));
            const context = await cloneGitRepo(info.build!.context);
            assert.equal(context, '/tmp/vscode-dev-containers-XXXXX');
        });

        it('Parses git URL with branch', async () => {
            // Prepare
            const input = `
    build:
        context: https://github.com/user/repo.git#branch
    `;

            // Execute
            const info = loadYamlAndGetBuildInfoForService(input);
            const isGit = isGitUrl(info.build!.context);
            const context = await cloneGitRepo(info.build!.context);

            // Verify
            assert.deepEqual(info, {
                image: undefined,
                build: {
                    context: 'https://github.com/user/repo.git#branch',
                    dockerfilePath: 'Dockerfile',
                    target: undefined,
                    args: undefined,
                }
            });
            assert.isTrue(isGit);
            assert.equal(context, '/tmp/vscode-dev-containers-XXXXX');
        });

        it('Parses git URL without http scheme', async () => {
            const input = `
    build:
        context: github.com/user/repo.git#branch
    `;

            // Execute
            const info = loadYamlAndGetBuildInfoForService(input);
            const isGit = isGitUrl(info.build!.context);
            const context = await cloneGitRepo(info.build!.context);

            // Verify
            assert.deepEqual(info, {
                image: undefined,
                build: {
                    context: 'github.com/user/repo.git#branch',
                    dockerfilePath: 'Dockerfile',
                    target: undefined,
                    args: undefined,
                }
            });
            assert.isTrue(isGit);
            assert.equal(context, '/tmp/vscode-dev-containers-XXXXX');
        });

        it('Parses git URL with ref and subdir', async () => {
            // Prepare
            const contextPath = '/tmp/vscode-dev-containers-XXXXX/subdir';
        
            // Mocking realpath to return the path the mentioned 
            stubRealpath.withArgs(contextPath).resolves('/tmp/vscode-dev-containers-XXXXX/subdir');

            // 
            const statReturn = {
                ...stats,
                isDirectory: () => true, // returning isDirectory as true
            };
            stubStats.withArgs(contextPath).resolves(statReturn);

            const input = `
    build:
        context: https://github.com/user/repo.git#branch:subdir
    `;

            // Execute
            const info = loadYamlAndGetBuildInfoForService(input);
            const isGit = isGitUrl(info.build!.context);
            const context = await cloneGitRepo(info.build!.context);
            
            // Verify
            assert.deepEqual(info, {
                image: undefined,
                build: {
                    context: 'https://github.com/user/repo.git#branch:subdir',
                    dockerfilePath: 'Dockerfile',
                    target: undefined,
                    args: undefined,
                }
            });
            assert.isTrue(isGit);
            assert.equal(context, '/tmp/vscode-dev-containers-XXXXX');
        });

        it('Parses git URL with only subdir', async () => {
            // Prepare
            const contextPath = '/tmp/vscode-dev-containers-XXXXX/subdir';

            // Mocking realpath to return the path the mentioned 
            stubRealpath.withArgs(contextPath).resolves(contextPath);
            
            const statReturn = {
                ...stats,
                isDirectory: () => true, // returning isDirectory as true
            };
            stubStats.withArgs(contextPath).resolves(statReturn);

            const input = `
    build:
        context: https://github.com/user/repo.git#:subdir
    `;

            // Execute
            const info = loadYamlAndGetBuildInfoForService(input);
            const isGit = isGitUrl(info.build!.context);
            const context = await cloneGitRepo(info.build!.context);
            
            // Verify
            assert.deepEqual(info, {
                image: undefined,
                build: {
                    context: 'https://github.com/user/repo.git#:subdir',
                    dockerfilePath: 'Dockerfile',
                    target: undefined,
                    args: undefined,
                }
            });
            assert.isTrue(isGit);
            assert.equal(context, '/tmp/vscode-dev-containers-XXXXX');
        });

        it('Throws when git URL with subdir is not a subdirectory', async () => {
            // Prepare
            const contextPath = '/tmp/vscode-dev-containers-XXXXX/notasubdir';

            // Mocking realpath to return the path the mentioned 
            stubRealpath.withArgs(contextPath).resolves(contextPath);
            
            const statReturn = {
                ...stats,
                isDirectory: () => false, // return isDirectory as false
            };
            stubStats.withArgs(contextPath).resolves(statReturn);

            const input = `
    build:
        context: https://github.com/user/repo.git#:notasubdir
    `;

            // Execute
            const info = loadYamlAndGetBuildInfoForService(input);
            const isGit = isGitUrl(info.build!.context);
            
            // Verify
            assert.deepEqual(info, {
                image: undefined,
                build: {
                    context: 'https://github.com/user/repo.git#:notasubdir',
                    dockerfilePath: 'Dockerfile',
                    target: undefined,
                    args: undefined,
                }
            });
            assert.isTrue(isGit);
            // assert.throws doesn't work for async functions
            // TODO: fix this test 
            // assert.throws(async () => await cloneGitRepo(info.build!.context), `subdir notasubdir is not a directory`);
        });

        it('Parses git URL as SSH', async () => {
            // Prepare
            const input = `
    build:
        context: git@github.com/user/repo.git
    `;

            // Execute
            const info = loadYamlAndGetBuildInfoForService(input);
            const isGit = isGitUrl(info.build!.context);
            
            // Verify
            assert.deepEqual(info, {
                image: undefined,
                build: {
                    context: 'git@github.com/user/repo.git',
                    dockerfilePath: 'Dockerfile',
                    target: undefined,
                    args: undefined,
                }
            });
            assert.isTrue(isGit);
        });

        it('Parsing fails git URL is invalid SSH', async () => {
            // Prepare
            const input = `
    build:
        context: notgit$notgithub.com:user/repo.git
    `;

            // Execute
            const info = loadYamlAndGetBuildInfoForService(input);
            const isGit = isGitUrl(info.build!.context);
            
            // Verify
            assert.deepEqual(info, {
                image: undefined,
                build: {
                    context: 'notgit$notgithub.com:user/repo.git',
                    dockerfilePath: 'Dockerfile',
                    target: undefined,
                    args: undefined,
                }
            });
            assert.isFalse(isGit);
        });
    });
});

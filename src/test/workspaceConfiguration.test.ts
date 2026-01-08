/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { assert } from 'chai';
import * as path from 'path';
import { getWorkspaceConfiguration } from '../spec-node/utils';
import { CLIHost } from '../spec-common/cliHost';
import { Workspace } from '../spec-utils/workspaces';
import { nullLog } from '../spec-utils/log';

function createMockCLIHost(options: {
	platform: NodeJS.Platform;
	files?: Record<string, string>;
	useFileHost?: boolean; // Use FileHost path in findGitRootFolder (for testing parent folder git root)
}): CLIHost {
	const { platform, files = {}, useFileHost = false } = options;
	const pathModule = platform === 'win32' ? path.win32 : path.posix;
	const baseHost = {
		type: 'local' as const,
		platform,
		arch: 'x64' as const,
		path: pathModule,
		cwd: platform === 'win32' ? 'C:\\' : '/',
		env: {},
		ptyExec: () => { throw new Error('Not implemented'); },
		homedir: async () => platform === 'win32' ? 'C:\\Users\\test' : '/home/test',
		tmpdir: async () => platform === 'win32' ? 'C:\\tmp' : '/tmp',
		isFile: async (filepath: string) => filepath in files,
		isFolder: async () => false,
		readFile: async (filepath: string) => {
			if (filepath in files) {
				return Buffer.from(files[filepath]);
			}
			throw new Error(`File not found: ${filepath}`);
		},
		writeFile: async () => { },
		rename: async () => { },
		mkdirp: async () => { },
		readDir: async () => [],
		getUsername: async () => 'test',
		toCommonURI: async () => undefined,
		connect: () => { throw new Error('Not implemented'); },
	};
	// If useFileHost is true, don't include exec so findGitRootFolder uses the FileHost code path
	if (useFileHost) {
		return baseHost as unknown as CLIHost;
	}
	return {
		...baseHost,
		exec: () => { throw new Error('Not implemented'); },
	} as CLIHost;
}

function createWorkspace(rootFolderPath: string, configFolderPath?: string): Workspace {
	return {
		isWorkspaceFile: false,
		workspaceOrFolderPath: rootFolderPath,
		rootFolderPath,
		configFolderPath: configFolderPath || rootFolderPath,
	};
}

type TestPlatform = 'linux' | 'darwin' | 'win32';
const platforms: TestPlatform[] = ['linux', 'darwin', 'win32'];

describe('getWorkspaceConfiguration', function () {

	for (const platform of platforms) {
		describe(`platform: ${platform}`, function () {

			describe('basic workspace mounting', function () {

				it('should mount workspace at /workspaces/<basename>', async () => {
					const p = {
						linux: { projectPath: '/home/user/project', consistency: '' },
						darwin: { projectPath: '/Users/user/project', consistency: ',consistency=consistent' },
						win32: { projectPath: 'C:\\Users\\user\\project', consistency: ',consistency=consistent' },
					}[platform];

					const cliHost = createMockCLIHost({ platform });
					const workspace = createWorkspace(p.projectPath);

					const result = await getWorkspaceConfiguration(
						cliHost,
						workspace,
						{},
						false,
						false,
						nullLog
					);

					assert.strictEqual(result.workspaceFolder, '/workspaces/project');
					assert.strictEqual(result.workspaceMount, `type=bind,source=${p.projectPath},target=/workspaces/project${p.consistency}`);
					assert.isUndefined(result.additionalMountString);
				});

			});

			describe('git worktree handling', function () {

				it('should not add additional mount when .git is not a file', async () => {
					const p = {
						linux: { projectPath: '/home/user/project' },
						darwin: { projectPath: '/Users/user/project' },
						win32: { projectPath: 'C:\\Users\\user\\project' },
					}[platform];

					const cliHost = createMockCLIHost({
						platform,
						files: {}
					});
					const workspace = createWorkspace(p.projectPath);

					const result = await getWorkspaceConfiguration(
						cliHost,
						workspace,
						{},
						true,
						true,
						nullLog
					);

					assert.isUndefined(result.additionalMountString);
				});

				it('should not add additional mount when gitdir is an absolute path', async () => {
					const p = {
						linux: { projectPath: '/home/user/project', gitFile: '/home/user/project/.git', absoluteGitdir: 'gitdir: /absolute/path/to/.git/worktrees/project' },
						darwin: { projectPath: '/Users/user/project', gitFile: '/Users/user/project/.git', absoluteGitdir: 'gitdir: /absolute/path/to/.git/worktrees/project' },
						win32: { projectPath: 'C:\\Users\\user\\project', gitFile: 'C:\\Users\\user\\project\\.git', absoluteGitdir: 'gitdir: C:/absolute/path/to/.git/worktrees/project' },
					}[platform];

					const cliHost = createMockCLIHost({
						platform,
						files: {
							[p.gitFile]: p.absoluteGitdir
						}
					});
					const workspace = createWorkspace(p.projectPath);

					const result = await getWorkspaceConfiguration(
						cliHost,
						workspace,
						{},
						true,
						true,
						nullLog
					);

					assert.isUndefined(result.additionalMountString);
				});

				it('should not add additional mount when mountGitWorktreeCommonDir is false', async () => {
					const p = {
						linux: { worktreePath: '/home/user/worktrees/feature', gitFile: '/home/user/worktrees/feature/.git', gitdir: 'gitdir: ../../repo/.git/worktrees/feature', consistency: '' },
						darwin: { worktreePath: '/Users/user/worktrees/feature', gitFile: '/Users/user/worktrees/feature/.git', gitdir: 'gitdir: ../../repo/.git/worktrees/feature', consistency: ',consistency=consistent' },
						win32: { worktreePath: 'C:\\Users\\user\\worktrees\\feature', gitFile: 'C:\\Users\\user\\worktrees\\feature\\.git', gitdir: 'gitdir: ../../repo/.git/worktrees/feature', consistency: ',consistency=consistent' },
					}[platform];

					const cliHost = createMockCLIHost({
						platform,
						files: {
							[p.gitFile]: p.gitdir
						}
					});
					const workspace = createWorkspace(p.worktreePath);

					const result = await getWorkspaceConfiguration(
						cliHost,
						workspace,
						{},
						true,
						false,
						nullLog
					);

					assert.strictEqual(result.workspaceFolder, '/workspaces/feature');
					assert.strictEqual(result.workspaceMount, `type=bind,source=${p.worktreePath},target=/workspaces/feature${p.consistency}`);
					assert.isUndefined(result.additionalMountString);
				});

				it('should not add additional mount when mountGitWorktreeCommonDir is false with workspace in subfolder', async () => {
					const p = {
						linux: { worktreePath: '/home/user/worktrees/feature', gitConfigFile: '/home/user/worktrees/feature/.git/config', gitFile: '/home/user/worktrees/feature/.git', gitdir: 'gitdir: ../../repo/.git/worktrees/feature', subfolderPath: '/home/user/worktrees/feature/packages/app', consistency: '' },
						darwin: { worktreePath: '/Users/user/worktrees/feature', gitConfigFile: '/Users/user/worktrees/feature/.git/config', gitFile: '/Users/user/worktrees/feature/.git', gitdir: 'gitdir: ../../repo/.git/worktrees/feature', subfolderPath: '/Users/user/worktrees/feature/packages/app', consistency: ',consistency=consistent' },
						win32: { worktreePath: 'C:\\Users\\user\\worktrees\\feature', gitConfigFile: 'C:\\Users\\user\\worktrees\\feature\\.git\\config', gitFile: 'C:\\Users\\user\\worktrees\\feature\\.git', gitdir: 'gitdir: ../../repo/.git/worktrees/feature', subfolderPath: 'C:\\Users\\user\\worktrees\\feature\\packages\\app', consistency: ',consistency=consistent' },
					}[platform];

					const cliHost = createMockCLIHost({
						platform,
						files: {
							[p.gitConfigFile]: '[core]',
							[p.gitFile]: p.gitdir
						},
						useFileHost: true
					});
					const workspace = createWorkspace(p.subfolderPath);

					const result = await getWorkspaceConfiguration(
						cliHost,
						workspace,
						{},
						true,
						false,
						nullLog
					);

					assert.strictEqual(result.workspaceFolder, '/workspaces/feature/packages/app');
					assert.strictEqual(result.workspaceMount, `type=bind,source=${p.worktreePath},target=/workspaces/feature${p.consistency}`);
					assert.isUndefined(result.additionalMountString);
				});

				it('should add additional mount when gitdir is a relative path', async () => {
					const p = {
						linux: { worktreePath: '/home/user/worktrees/feature', gitFile: '/home/user/worktrees/feature/.git', gitdir: 'gitdir: ../../repo/.git/worktrees/feature', repoGitPath: '/home/user/repo/.git', consistency: '' },
						darwin: { worktreePath: '/Users/user/worktrees/feature', gitFile: '/Users/user/worktrees/feature/.git', gitdir: 'gitdir: ../../repo/.git/worktrees/feature', repoGitPath: '/Users/user/repo/.git', consistency: ',consistency=consistent' },
						win32: { worktreePath: 'C:\\Users\\user\\worktrees\\feature', gitFile: 'C:\\Users\\user\\worktrees\\feature\\.git', gitdir: 'gitdir: ../../repo/.git/worktrees/feature', repoGitPath: 'C:\\Users\\user\\repo\\.git', consistency: ',consistency=consistent' },
					}[platform];

					const cliHost = createMockCLIHost({
						platform,
						files: {
							[p.gitFile]: p.gitdir
						}
					});
					const workspace = createWorkspace(p.worktreePath);

					const result = await getWorkspaceConfiguration(
						cliHost,
						workspace,
						{},
						true,
						true,
						nullLog
					);

					assert.strictEqual(result.workspaceFolder, '/workspaces/worktrees/feature');
					assert.strictEqual(result.workspaceMount, `type=bind,source=${p.worktreePath},target=/workspaces/worktrees/feature${p.consistency}`);
					assert.strictEqual(result.additionalMountString, `type=bind,source=${p.repoGitPath},target=/workspaces/repo/.git${p.consistency}`);
				});

				it('should handle gitdir with single level up', async () => {
					const p = {
						linux: { worktreePath: '/home/user/repo-worktree', gitFile: '/home/user/repo-worktree/.git', gitdir: 'gitdir: ../repo/.git/worktrees/worktree', repoGitPath: '/home/user/repo/.git', consistency: '' },
						darwin: { worktreePath: '/Users/user/repo-worktree', gitFile: '/Users/user/repo-worktree/.git', gitdir: 'gitdir: ../repo/.git/worktrees/worktree', repoGitPath: '/Users/user/repo/.git', consistency: ',consistency=consistent' },
						win32: { worktreePath: 'C:\\Users\\user\\repo-worktree', gitFile: 'C:\\Users\\user\\repo-worktree\\.git', gitdir: 'gitdir: ../repo/.git/worktrees/worktree', repoGitPath: 'C:\\Users\\user\\repo\\.git', consistency: ',consistency=consistent' },
					}[platform];

					const cliHost = createMockCLIHost({
						platform,
						files: {
							[p.gitFile]: p.gitdir
						}
					});
					const workspace = createWorkspace(p.worktreePath);

					const result = await getWorkspaceConfiguration(
						cliHost,
						workspace,
						{},
						true,
						true,
						nullLog
					);

					assert.strictEqual(result.workspaceFolder, '/workspaces/repo-worktree');
					assert.strictEqual(result.additionalMountString, `type=bind,source=${p.repoGitPath},target=/workspaces/repo/.git${p.consistency}`);
				});

				it('should handle worktree two levels deep from common parent with main repo', async () => {
					const p = {
						linux: { worktreePath: '/home/user/projects/worktrees/feature', gitFile: '/home/user/projects/worktrees/feature/.git', gitdir: 'gitdir: ../../repos/main/.git/worktrees/feature', repoGitPath: '/home/user/projects/repos/main/.git', consistency: '' },
						darwin: { worktreePath: '/Users/user/projects/worktrees/feature', gitFile: '/Users/user/projects/worktrees/feature/.git', gitdir: 'gitdir: ../../repos/main/.git/worktrees/feature', repoGitPath: '/Users/user/projects/repos/main/.git', consistency: ',consistency=consistent' },
						win32: { worktreePath: 'C:\\Users\\user\\projects\\worktrees\\feature', gitFile: 'C:\\Users\\user\\projects\\worktrees\\feature\\.git', gitdir: 'gitdir: ../../repos/main/.git/worktrees/feature', repoGitPath: 'C:\\Users\\user\\projects\\repos\\main\\.git', consistency: ',consistency=consistent' },
					}[platform];

					const cliHost = createMockCLIHost({
						platform,
						files: {
							[p.gitFile]: p.gitdir
						}
					});
					const workspace = createWorkspace(p.worktreePath);

					const result = await getWorkspaceConfiguration(
						cliHost,
						workspace,
						{},
						true,
						true,
						nullLog
					);

					assert.strictEqual(result.workspaceFolder, '/workspaces/worktrees/feature');
					assert.strictEqual(result.workspaceMount, `type=bind,source=${p.worktreePath},target=/workspaces/worktrees/feature${p.consistency}`);
					assert.strictEqual(result.additionalMountString, `type=bind,source=${p.repoGitPath},target=/workspaces/repos/main/.git${p.consistency}`);
				});

				it('should handle worktree two levels deep with workspace in subfolder', async () => {
					const p = {
						linux: { worktreePath: '/home/user/projects/worktrees/feature', gitConfigFile: '/home/user/projects/worktrees/feature/.git/config', gitFile: '/home/user/projects/worktrees/feature/.git', gitdir: 'gitdir: ../../repos/main/.git/worktrees/feature', subfolderPath: '/home/user/projects/worktrees/feature/packages/app', repoGitPath: '/home/user/projects/repos/main/.git', consistency: '' },
						darwin: { worktreePath: '/Users/user/projects/worktrees/feature', gitConfigFile: '/Users/user/projects/worktrees/feature/.git/config', gitFile: '/Users/user/projects/worktrees/feature/.git', gitdir: 'gitdir: ../../repos/main/.git/worktrees/feature', subfolderPath: '/Users/user/projects/worktrees/feature/packages/app', repoGitPath: '/Users/user/projects/repos/main/.git', consistency: ',consistency=consistent' },
						win32: { worktreePath: 'C:\\Users\\user\\projects\\worktrees\\feature', gitConfigFile: 'C:\\Users\\user\\projects\\worktrees\\feature\\.git\\config', gitFile: 'C:\\Users\\user\\projects\\worktrees\\feature\\.git', gitdir: 'gitdir: ../../repos/main/.git/worktrees/feature', subfolderPath: 'C:\\Users\\user\\projects\\worktrees\\feature\\packages\\app', repoGitPath: 'C:\\Users\\user\\projects\\repos\\main\\.git', consistency: ',consistency=consistent' },
					}[platform];

					const cliHost = createMockCLIHost({
						platform,
						files: {
							[p.gitConfigFile]: '[core]',
							[p.gitFile]: p.gitdir
						},
						useFileHost: true
					});
					const workspace = createWorkspace(p.subfolderPath);

					const result = await getWorkspaceConfiguration(
						cliHost,
						workspace,
						{},
						true,
						true,
						nullLog
					);

					assert.strictEqual(result.workspaceFolder, '/workspaces/worktrees/feature/packages/app');
					assert.strictEqual(result.workspaceMount, `type=bind,source=${p.worktreePath},target=/workspaces/worktrees/feature${p.consistency}`);
					assert.strictEqual(result.additionalMountString, `type=bind,source=${p.repoGitPath},target=/workspaces/repos/main/.git${p.consistency}`);
				});

			});

			describe('git root in parent folder', function () {

				it('should mount from git root when .git/config is in parent folder', async () => {
					const p = {
						linux: { repoPath: '/home/user/repo', gitConfigFile: '/home/user/repo/.git/config', subfolderPath: '/home/user/repo/packages/frontend', consistency: '' },
						darwin: { repoPath: '/Users/user/repo', gitConfigFile: '/Users/user/repo/.git/config', subfolderPath: '/Users/user/repo/packages/frontend', consistency: ',consistency=consistent' },
						win32: { repoPath: 'C:\\Users\\user\\repo', gitConfigFile: 'C:\\Users\\user\\repo\\.git\\config', subfolderPath: 'C:\\Users\\user\\repo\\packages\\frontend', consistency: ',consistency=consistent' },
					}[platform];

					const cliHost = createMockCLIHost({
						platform,
						files: {
							[p.gitConfigFile]: '[core]'
						},
						useFileHost: true
					});
					const workspace = createWorkspace(p.subfolderPath);

					const result = await getWorkspaceConfiguration(
						cliHost,
						workspace,
						{},
						true,
						true,
						nullLog
					);

					assert.strictEqual(result.workspaceMount, `type=bind,source=${p.repoPath},target=/workspaces/repo${p.consistency}`);
					assert.strictEqual(result.workspaceFolder, '/workspaces/repo/packages/frontend');
					assert.isUndefined(result.additionalMountString);
				});

				it('should mount workspace folder when mountWorkspaceGitRoot is false even with .git in parent', async () => {
					const p = {
						linux: { gitConfigFile: '/home/user/repo/.git/config', subfolderPath: '/home/user/repo/packages/frontend', consistency: '' },
						darwin: { gitConfigFile: '/Users/user/repo/.git/config', subfolderPath: '/Users/user/repo/packages/frontend', consistency: ',consistency=consistent' },
						win32: { gitConfigFile: 'C:\\Users\\user\\repo\\.git\\config', subfolderPath: 'C:\\Users\\user\\repo\\packages\\frontend', consistency: ',consistency=consistent' },
					}[platform];

					const cliHost = createMockCLIHost({
						platform,
						files: {
							[p.gitConfigFile]: '[core]'
						},
						useFileHost: true
					});
					const workspace = createWorkspace(p.subfolderPath);

					const result = await getWorkspaceConfiguration(
						cliHost,
						workspace,
						{},
						false,
						false,
						nullLog
					);

					assert.strictEqual(result.workspaceMount, `type=bind,source=${p.subfolderPath},target=/workspaces/frontend${p.consistency}`);
					assert.strictEqual(result.workspaceFolder, '/workspaces/frontend');
				});

				it('should handle deeply nested workspace in git repo', async () => {
					const p = {
						linux: { monorepoPath: '/home/user/monorepo', gitConfigFile: '/home/user/monorepo/.git/config', subfolderPath: '/home/user/monorepo/packages/apps/web', consistency: '' },
						darwin: { monorepoPath: '/Users/user/monorepo', gitConfigFile: '/Users/user/monorepo/.git/config', subfolderPath: '/Users/user/monorepo/packages/apps/web', consistency: ',consistency=consistent' },
						win32: { monorepoPath: 'C:\\Users\\user\\monorepo', gitConfigFile: 'C:\\Users\\user\\monorepo\\.git\\config', subfolderPath: 'C:\\Users\\user\\monorepo\\packages\\apps\\web', consistency: ',consistency=consistent' },
					}[platform];

					const cliHost = createMockCLIHost({
						platform,
						files: {
							[p.gitConfigFile]: '[core]'
						},
						useFileHost: true
					});
					const workspace = createWorkspace(p.subfolderPath);

					const result = await getWorkspaceConfiguration(
						cliHost,
						workspace,
						{},
						true,
						true,
						nullLog
					);

					assert.strictEqual(result.workspaceMount, `type=bind,source=${p.monorepoPath},target=/workspaces/monorepo${p.consistency}`);
					assert.strictEqual(result.workspaceFolder, '/workspaces/monorepo/packages/apps/web');
				});

				it('should handle worktree with git root in parent folder', async () => {
					const p = {
						linux: { repoPath: '/home/user/repo', gitConfigFile: '/home/user/repo/.git/config', gitFile: '/home/user/repo/.git', gitdir: 'gitdir: ../main-repo/.git/worktrees/repo', mainRepoGitPath: '/home/user/main-repo/.git', subfolderPath: '/home/user/repo/packages/lib', consistency: '' },
						darwin: { repoPath: '/Users/user/repo', gitConfigFile: '/Users/user/repo/.git/config', gitFile: '/Users/user/repo/.git', gitdir: 'gitdir: ../main-repo/.git/worktrees/repo', mainRepoGitPath: '/Users/user/main-repo/.git', subfolderPath: '/Users/user/repo/packages/lib', consistency: ',consistency=consistent' },
						win32: { repoPath: 'C:\\Users\\user\\repo', gitConfigFile: 'C:\\Users\\user\\repo\\.git\\config', gitFile: 'C:\\Users\\user\\repo\\.git', gitdir: 'gitdir: ../main-repo/.git/worktrees/repo', mainRepoGitPath: 'C:\\Users\\user\\main-repo\\.git', subfolderPath: 'C:\\Users\\user\\repo\\packages\\lib', consistency: ',consistency=consistent' },
					}[platform];

					const cliHost = createMockCLIHost({
						platform,
						files: {
							[p.gitConfigFile]: '[core]',
							[p.gitFile]: p.gitdir
						},
						useFileHost: true
					});
					const workspace = createWorkspace(p.subfolderPath);

					const result = await getWorkspaceConfiguration(
						cliHost,
						workspace,
						{},
						true,
						true,
						nullLog
					);

					assert.strictEqual(result.workspaceFolder, '/workspaces/repo/packages/lib');
					assert.strictEqual(result.additionalMountString, `type=bind,source=${p.mainRepoGitPath},target=/workspaces/main-repo/.git${p.consistency}`);
				});

			});

			describe('config overrides', function () {

				it('should use workspaceFolder from config when provided', async () => {
					const p = {
						linux: { projectPath: '/home/user/project' },
						darwin: { projectPath: '/Users/user/project' },
						win32: { projectPath: 'C:\\Users\\user\\project' },
					}[platform];

					const cliHost = createMockCLIHost({ platform });
					const workspace = createWorkspace(p.projectPath);

					const result = await getWorkspaceConfiguration(
						cliHost,
						workspace,
						{ workspaceFolder: '/custom/path' },
						false,
						false,
						nullLog
					);

					assert.strictEqual(result.workspaceFolder, '/custom/path');
				});

				it('should use workspaceMount from config when provided', async () => {
					const p = {
						linux: { projectPath: '/home/user/project' },
						darwin: { projectPath: '/Users/user/project' },
						win32: { projectPath: 'C:\\Users\\user\\project' },
					}[platform];

					const cliHost = createMockCLIHost({ platform });
					const workspace = createWorkspace(p.projectPath);

					const result = await getWorkspaceConfiguration(
						cliHost,
						workspace,
						{ workspaceMount: 'type=bind,source=/custom,target=/workspace' },
						false,
						false,
						nullLog
					);

					assert.strictEqual(result.workspaceMount, 'type=bind,source=/custom,target=/workspace');
				});

			});

		});
	}

});

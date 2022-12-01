import path from 'path';
import { getCLIHost } from '../../spec-common/cliHost';
import { loadNativeModule } from '../../spec-common/commonUtils';
import { readDevContainerConfigFile } from '../../spec-node/configContainer';
import { nullLog } from '../../spec-utils/log';
import { URI } from 'vscode-uri';
import { assert } from 'chai';

describe('readDevContainerConfigFile', async function () {
	it('can read a basic configuration file', async function () {
		const cwd = process.cwd();
		const cliHost = await getCLIHost(cwd, loadNativeModule);
		const workspace = {
			isWorkspaceFile: true,
			workspaceOrFolderPath: '/foo/bar',
			rootFolderPath: '/foo/bar',
			configFolderPath: '/foo/bar',
		};
		const configFile = URI.file(path.resolve('./src/test/configs/example/.devcontainer.json'));

		const configs = await readDevContainerConfigFile(cliHost, workspace, configFile, false, nullLog);
		assert.isNotNull(configs);
		assert.property(configs, 'config');
		assert.isNotNull(configs?.config.config);

		const features = configs?.config.config.features as Record<string, string | boolean | Record<string, string | boolean>>;
		assert.hasAllKeys(features, ['ghcr.io/devcontainers/features/go:1']);
	});

	it('can resolve an "extends" file reference', async function () {
		const cwd = process.cwd();
		const cliHost = await getCLIHost(cwd, loadNativeModule);
		const workspace = {
			isWorkspaceFile: true,
			workspaceOrFolderPath: '/foo/bar',
			rootFolderPath: '/foo/bar',
			configFolderPath: '/foo/bar',
		};
		const configFile = URI.file(path.resolve('./src/test/configs/extends/.devcontainer.json'));

		const configs = await readDevContainerConfigFile(cliHost, workspace, configFile, false, nullLog);
		assert.isNotNull(configs);
		assert.property(configs, 'config');
		assert.isNotNull(configs?.config.config);
		assert.isNotNull(configs?.config.raw);
		const expectedConfig = {
			name: 'Overrides',
			image: 'mcr.microsoft.com/devcontainers/base:latest',
			forwardPorts: [ 80, 443 ],
			features: {
				'ghcr.io/devcontainers/features/docker-in-docker:1': {
					'version': 'latest',
					'moby': true
				},
				'ghcr.io/devcontainers/features/go:1': {
					'version': 'latest'
				}
			}
		};

		assert.deepEqual(configs?.config.raw as any, expectedConfig);
	});
});

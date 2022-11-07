/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';

import { beforeContainerSubstitute, containerSubstitute, substitute } from '../spec-common/variableSubstitution';
import { URI } from 'vscode-uri';

describe('Variable substitution', function () {

	it(`environment variables`, async () => {
		const raw = {
			foo: 'bar${env:baz}bar'
		};
		const result = substitute({
			platform: 'linux',
			localWorkspaceFolder: '/foo/bar',
			containerWorkspaceFolder: '/baz/blue',
			configFile: URI.file('/foo/bar/baz.json'),
			env: {
				baz: 'somevalue'
			},
		}, raw);
		assert.strictEqual(result.foo, 'barsomevaluebar');
	});

	it(`localWorkspaceFolder`, async () => {
		const raw = {
			foo: 'bar${localWorkspaceFolder}bar'
		};
		const result = substitute({
			platform: 'linux',
			localWorkspaceFolder: '/foo/bar',
			containerWorkspaceFolder: '/baz/blue',
			configFile: URI.file('/foo/bar/baz.json'),
			env: {
				baz: 'somevalue'
			},
		}, raw);
		assert.strictEqual(result.foo, 'bar/foo/barbar');
	});

	it(`containerWorkspaceFolder`, async () => {
		const raw = {
			foo: 'bar${containerWorkspaceFolder}bar'
		};
		const result = substitute({
			platform: 'linux',
			localWorkspaceFolder: '/foo/bar',
			containerWorkspaceFolder: '/baz/blue',
			configFile: URI.file('/foo/bar/baz.json'),
			env: {
				baz: 'somevalue'
			},
		}, raw);
		assert.strictEqual(result.foo, 'bar/baz/bluebar');
	});

	it(`localWorkspaceFolderBasename and containerWorkspaceFolder`, async () => {
		const raw = {
			foo: 'bar${containerWorkspaceFolder}bar'
		};
		const result = substitute({
			platform: 'linux',
			localWorkspaceFolder: '/foo/red',
			containerWorkspaceFolder: '/baz/${localWorkspaceFolderBasename}',
			configFile: URI.file('/foo/bar/baz.json'),
			env: {
				baz: 'somevalue'
			},
		}, raw);
		assert.strictEqual(result.foo, 'bar/baz/redbar');
	});

	it(`environment variables with default value if they do not exist`, async () => {
		const raw = {
			foo: 'bar${localEnv:baz:default}bar'
		};
		const result = substitute({
			platform: 'linux',
			localWorkspaceFolder: '/foo/bar',
			containerWorkspaceFolder: '/baz/blue',
			configFile: URI.file('/foo/bar/baz.json'),
			env: {
			},
		}, raw);
		assert.strictEqual(result.foo, 'bardefaultbar');
	});

	it(`environment variables without default value if they do not exist`, async () => {
		const raw = {
			foo: 'bar${localEnv:baz}bar'
		};
		const result = substitute({
			platform: 'linux',
			localWorkspaceFolder: '/foo/bar',
			containerWorkspaceFolder: '/baz/blue',
			configFile: URI.file('/foo/bar/baz.json'),
			env: {
			},
		}, raw);
		assert.strictEqual(result.foo, 'barbar');
	});

	it(`environment variables with default value if they do exist`, async () => {
		const raw = {
			foo: 'bar${localEnv:baz:default}bar'
		};
		const result = substitute({
			platform: 'linux',
			localWorkspaceFolder: '/foo/bar',
			containerWorkspaceFolder: '/baz/blue',
			configFile: URI.file('/foo/bar/baz.json'),
			env: {
				baz: 'somevalue'
			},
		}, raw);
		assert.strictEqual(result.foo, 'barsomevaluebar');
	});

	it(`environment variables with default value if they do not exist`, async () => {
		const raw = {
			foo: 'bar${localEnv:baz:default:a:b:c}bar'
		};
		const result = substitute({
			platform: 'linux',
			localWorkspaceFolder: '/foo/bar',
			containerWorkspaceFolder: '/baz/blue',
			configFile: URI.file('/foo/bar/baz.json'),
			env: {
			},
		}, raw);
		assert.strictEqual(result.foo, 'bardefaultbar');
	});

	it(`container environment variables with default value if they do not exist`, async () => {
		const raw = {
			foo: 'bar${containerEnv:baz:default}bar'
		};
		const result = containerSubstitute('linux', URI.file('/foo/bar/baz.json'), {}, raw);
		assert.strictEqual(result.foo, 'bardefaultbar');
	});

	it(`replaces devcontainerId`, async () => {
		const raw = {
			test: '${devcontainerId}'
		};
		const result = beforeContainerSubstitute({ a: 'b' }, raw);
		assert.ok(/^[0-9a-v]{52}$/.test(result.test), `Got: ${result.test}`);
	});

	it(`replaces devcontainerId and additional id labels matter`, async () => {
		const raw = {
			test: '${devcontainerId}'
		};
		const result1 = beforeContainerSubstitute({ a: 'b' }, raw);
		const result2 = beforeContainerSubstitute({ a: 'b', c: 'd' }, raw);
		assert.notStrictEqual(result1.test, result2.test);
	});

	it(`replaces devcontainerId and label order does not matter`, async () => {
		const raw = {
			test: '${devcontainerId}'
		};
		const result1 = beforeContainerSubstitute({ c: 'd', a: 'b' }, raw);
		const result2 = beforeContainerSubstitute({ a: 'b', c: 'd' }, raw);
		assert.strictEqual(result1.test, result2.test);
	});
});

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as path from 'path';
import { shellExec } from './testUtils';

const pkg = require('../../package.json');

const tmp = path.relative(process.cwd(), path.join(__dirname, 'tmp'));
const cli = `npx --prefix ${tmp} devcontainer`;

async function installCLI() {
	await shellExec(`rm -rf ${tmp}/node_modules`);
	await shellExec(`mkdir -p ${tmp}`);
	await shellExec(`npm --prefix ${tmp} install devcontainers-cli-${pkg.version}.tgz`);
}

// Validation tests — no K8s cluster required.
describe('Dev Containers CLI - Kubernetes flag validation', function () {
	this.timeout('120s');

	before('Install', installCLI);

	it('should reject missing --k8s-namespace', async function () {
		try {
			await shellExec(`${cli} exec --k8s-pod some-pod --k8s-container some-container -- echo test`);
			assert.fail('Should have thrown');
		} catch (err: any) {
			assert.ok(err.stderr.includes('--k8s-namespace is required'), `Expected namespace error, got: ${err.stderr}`);
		}
	});

	it('should reject missing --k8s-container', async function () {
		try {
			await shellExec(`${cli} exec --k8s-pod some-pod --k8s-namespace some-ns -- echo test`);
			assert.fail('Should have thrown');
		} catch (err: any) {
			assert.ok(err.stderr.includes('--k8s-container is required'), `Expected container error, got: ${err.stderr}`);
		}
	});
});

// Integration tests — require a running K8s cluster.
// Set DEVCONTAINER_TEST_K8S_NAMESPACE, DEVCONTAINER_TEST_K8S_POD, and
// DEVCONTAINER_TEST_K8S_CONTAINER environment variables to run these.
describe('Dev Containers CLI - Kubernetes exec', function () {
	this.timeout('120s');

	const k8sNamespace = process.env.DEVCONTAINER_TEST_K8S_NAMESPACE;
	const k8sPod = process.env.DEVCONTAINER_TEST_K8S_POD;
	const k8sContainer = process.env.DEVCONTAINER_TEST_K8S_CONTAINER;

	before('Install and check K8s prerequisites', async function () {
		if (!k8sNamespace || !k8sPod || !k8sContainer) {
			this.skip();
			return;
		}
		await installCLI();
	});

	it('should exec a simple command in a K8s pod', async function () {
		if (!k8sNamespace || !k8sPod || !k8sContainer) {
			this.skip();
			return;
		}
		const res = await shellExec(`${cli} exec --k8s-namespace ${k8sNamespace} --k8s-pod ${k8sPod} --k8s-container ${k8sContainer} -- echo hello`);
		assert.ok(res.stdout.includes('hello'), `Expected "hello" in stdout, got: ${res.stdout}`);
	});

	it('should exec whoami in a K8s pod', async function () {
		if (!k8sNamespace || !k8sPod || !k8sContainer) {
			this.skip();
			return;
		}
		const res = await shellExec(`${cli} exec --k8s-namespace ${k8sNamespace} --k8s-pod ${k8sPod} --k8s-container ${k8sContainer} -- whoami`);
		assert.ok(res.stdout.trim().length > 0, 'Expected non-empty whoami output');
	});

	it('should pass remote-env to K8s exec', async function () {
		if (!k8sNamespace || !k8sPod || !k8sContainer) {
			this.skip();
			return;
		}
		const res = await shellExec(`${cli} exec --k8s-namespace ${k8sNamespace} --k8s-pod ${k8sPod} --k8s-container ${k8sContainer} --remote-env TEST_VAR=hello123 -- sh -c 'echo $TEST_VAR'`);
		assert.ok(res.stdout.includes('hello123'), `Expected "hello123" in stdout, got: ${res.stdout}`);
	});
});

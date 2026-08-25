import { OCICollectionRef } from '../spec-configuration/containerCollectionsOCI';
import { requestEnsureAuthenticated } from '../spec-configuration/httpOCIRegistry';
import { nullLog } from '../spec-utils/log';
import { createTestCommonParams } from './testUtils';

function requiredEnvironmentVariable(name: string) {
	const value = process.env[name];
	if (!value) {
		throw new Error(`Missing ${name}.`);
	}
	return value;
}

const registry = requiredEnvironmentVariable('TEST_REGISTRY');
const tokenPort = requiredEnvironmentVariable('TEST_TOKEN_PORT');
const ociRef: OCICollectionRef = {
	registry,
	path: 'test/features',
	resource: `${registry}/test/features`,
	tag: 'latest',
	version: 'latest',
};

requestEnsureAuthenticated({
	...createTestCommonParams(nullLog, {}),
	allowedCrossOriginAuthHosts: [`${registry}=localhost:${tokenPort}`],
	ociAuthHardening: true,
}, {
	type: 'GET',
	url: `http://${registry}/v2/test/features/manifests/latest`,
	headers: {},
}, ociRef).then(result => {
	process.stdout.write(JSON.stringify({
		statusCode: result?.statusCode,
		ociAuthDiagnostics: result?.ociAuthDiagnostics,
	}));
}, error => {
	console.error(error);
	process.exitCode = 1;
});

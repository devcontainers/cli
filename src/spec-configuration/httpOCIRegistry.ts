import { request, requestResolveHeaders } from '../spec-utils/httpRequest';
import { LogLevel } from '../spec-utils/log';
import { CommonParams, OCICollectionRef, OCIRef } from './containerCollectionsOCI';

export type HEADERS = { 'authorization'?: string; 'user-agent'?: string; 'content-type'?: string; 'accept'?: string; 'content-length'?: string };

// WWW-Authenticate Regex
// realm="https://auth.docker.io/token",service="registry.docker.io",scope="repository:samalba/my-app:pull,push"
// realm="https://ghcr.io/token",service="ghcr.io",scope="repository:devcontainers/features:pull"
const realmRegex = /realm="([^"]+)"/;
const serviceRegex = /service="([^"]+)"/;
const scopeRegex = /scope="([^"]+)"/;


// https://docs.docker.com/registry/spec/auth/token/#how-to-authenticate
export async function requestEnsureAuthenticated(params: CommonParams, httpOptions: { type: string; url: string; headers: HEADERS; data?: Buffer }, ociRef: OCIRef | OCICollectionRef) {
	const { output, cachedAuthHeader } = params;

	// -- Update headers
	httpOptions.headers['user-agent'] = 'devcontainer';
	// If the user has a cached auth token, attempt to use that first.
	if (cachedAuthHeader) {
		output.write('[httpOci] Applying cachedAuthHeader...', LogLevel.Trace);
		httpOptions.headers.authorization = cachedAuthHeader;
	}

	const initialAttemptRes = await requestResolveHeaders(httpOptions, output);

	// For anything except a 401 response
	// Simply return the original response to the caller.
	if (initialAttemptRes.statusCode !== 401) {
		output.write(`[httpOci] [${initialAttemptRes.statusCode} - Cached/NoAuth: ${httpOptions.url}]`, LogLevel.Trace);
		return {
			response: initialAttemptRes,
			authHeader: cachedAuthHeader, // Let caller cache token for use in future requests.
		};
	}

	// -- 'responseAttempt' status code was 401 at this point.

	// Attempt to authenticate via WWW-Authenticate Header.
	const wwwAuthenticate = initialAttemptRes.resHeaders['WWW-Authenticate'] || initialAttemptRes.resHeaders['www-authenticate'];
	if (!wwwAuthenticate) {
		output.write(`[httpOci] ERR: Server did not provide instructions to authentiate! (Required: A 'WWW-Authenticate' Header)`, LogLevel.Error);
		return;
	}

	switch (wwwAuthenticate.split(' ')[0]) {
		// Basic realm="localhost"
		case 'Basic':

			output.write(`[httpOci] Attempting to authenticate via 'Basic' auth.`, LogLevel.Trace);

			const basicAuthCredential = await getBasicAuthCredential(params, ociRef);
			if (!basicAuthCredential) {
				output.write(`[httpOci] ERR: No basic auth credentials to send for registry service '${ociRef.registry}'`, LogLevel.Error);
			}

			httpOptions.headers.authorization = `Basic ${basicAuthCredential}`;
			break;

		// Bearer realm="https://auth.docker.io/token",service="registry.docker.io",scope="repository:samalba/my-app:pull,push"
		case 'Bearer':

			output.write(`[httpOci] Attempting to authenticate via 'Bearer' auth.`, LogLevel.Trace);

			const realmGroup = realmRegex.exec(wwwAuthenticate);
			const serviceGroup = serviceRegex.exec(wwwAuthenticate);
			const scopeGroup = scopeRegex.exec(wwwAuthenticate);

			if (!realmGroup || !serviceGroup || !scopeGroup) {
				output.write(`[httpOci] WWW-Authenticate header is not in expected format. Got:  ${wwwAuthenticate}`, LogLevel.Trace);
				return;
			}

			const wwwAuthenticateData = {
				realm: realmGroup[1],
				service: serviceGroup[1],
				scope: scopeGroup[1],
			};

			const bearerToken = await fetchRegistryBearerToken(params, ociRef, wwwAuthenticateData);
			if (!bearerToken) {
				output.write(`[httpOci] ERR: Failed to fetch Bearer token from registry.`, LogLevel.Error);
				return;
			}

			httpOptions.headers.authorization = `Bearer ${bearerToken}`;
			break;

		default:
			output.write(`[httpOci] ERR: Unsupported authentication mode '${wwwAuthenticate.split(' ')[0]}'`, LogLevel.Error);
			return;
	}

	// Retry the request with the updated authorization header.
	const reattemptRes = await requestResolveHeaders(httpOptions, output);
	output.write(`[httpOci] ${reattemptRes.statusCode} on reattempt after auth: ${httpOptions.url}`, LogLevel.Trace);
	return {
		response: reattemptRes,
		authHeader: reattemptRes.statusCode !== 401 ? httpOptions.headers.authorization : undefined, // Let caller cache token for use in future requests.
	};
}

// Attempts to get the Basic auth credentials for the provided registry.
// These may be programatically crafted via environment variables (GITHUB_TOKEN),
// parsed out of a special DEVCONTAINERS_OCI_AUTH environment variable,
async function getBasicAuthCredential(params: CommonParams, ociRef: OCIRef | OCICollectionRef): Promise<string | undefined> {
	const { output, env } = params;
	const { registry } = ociRef;

	// TODO: Directly read out of the local docker config file/credential helper.

	let userToken: string | undefined = undefined;
	if (!!env['GITHUB_TOKEN'] && registry === 'ghcr.io') {
		output.write('[httpOci] Using environment GITHUB_TOKEN for auth', LogLevel.Trace);
		userToken = `USERNAME:${env['GITHUB_TOKEN']}`;
	} else if (!!env['DEVCONTAINERS_OCI_AUTH']) {
		// eg: DEVCONTAINERS_OCI_AUTH=service1|user1|token1,service2|user2|token2
		const authContexts = env['DEVCONTAINERS_OCI_AUTH'].split(',');
		const authContext = authContexts.find(a => a.split('|')[0] === registry);

		if (authContext) {
			output.write(`[httpOci] Using match from DEVCONTAINERS_OCI_AUTH for registry '${registry}'`, LogLevel.Trace);
			const split = authContext.split('|');
			userToken = `${split[1]}:${split[2]}`;
		}
	}

	if (userToken) {
		return Buffer.from(userToken).toString('base64');
	}

	// Represents anonymous access.
	output.write(`[httpOci] No authentication credentials found for registry='${registry}'.`, LogLevel.Trace);
	return undefined;
}

// https://docs.docker.com/registry/spec/auth/token/#requesting-a-token
async function fetchRegistryBearerToken(params: CommonParams, ociRef: OCIRef | OCICollectionRef, wwwAuthenticateData: { realm: string; service: string; scope: string }): Promise<string | undefined> {
	const { output } = params;
	const { realm, service, scope } = wwwAuthenticateData;

	// TODO: Remove this.
	if (realm.includes('mcr.microsoft.com')) {
		return undefined;
	}

	const headers: HEADERS = {
		'user-agent': 'devcontainer'
	};

	// The token server should first attempt to authenticate the client using any authentication credentials provided with the request.
	// From Docker 1.11 the Docker engine supports both Basic Authentication and OAuth2 for getting tokens. 
	// Docker 1.10 and before, the registry client in the Docker Engine only supports Basic Authentication. 
	// If an attempt to authenticate to the token server fails, the token server should return a 401 Unauthorized response 
	// indicating that the provided credentials are invalid.
	// > https://docs.docker.com/registry/spec/auth/token/#requesting-a-token
	const basicAuthTokenBase64 = await getBasicAuthCredential(params, ociRef);
	if (basicAuthTokenBase64) {
		headers['authorization'] = `Basic ${basicAuthTokenBase64}`;
	}

	// realm="https://auth.docker.io/token"
	// service="registry.docker.io"
	// scope="repository:samalba/my-app:pull,push"
	// Example:
	// https://auth.docker.io/token?service=registry.docker.io&scope=repository:samalba/my-app:pull,push
	const url = `${realm}?service=${service}&scope=${scope}`;
	output.write(`[httpOci] Attempting to fetch bearer token from:  ${url}`, LogLevel.Trace);

	const options = {
		type: 'GET',
		url: url,
		headers: headers
	};

	let authReq: Buffer;
	try {
		authReq = await request(options, output);
	} catch (e: any) {
		// This is ok if the registry is trying to speak Basic Auth with us.
		output.write(`[httpOci] Could not fetch bearer token for '${service}': ${e}`, LogLevel.Error);
		return;
	}

	if (!authReq) {
		output.write(`[httpOci] Did not receive bearer token for '${service}'`, LogLevel.Error);
		return;
	}

	let scopeToken: string | undefined;
	try {
		scopeToken = JSON.parse(authReq.toString())?.token;
	} catch {
		// not JSON
	}
	if (!scopeToken) {
		output.write(`[httpOci] Unexpected bearer token response format for '${service}'`, LogLevel.Error);
		return;
	}

	return scopeToken;
}
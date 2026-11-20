/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export type OCIAuthLookupKind = 'image' | 'feature' | 'template';

// Why OCI auth hardening would block a token realm, checked in this order:
// - httpRealm: The realm does not use HTTPS.
// - differentPort: The realm is on the registry's hostname, but on a different port.
// - parentDomain: The realm is on a parent domain of the registry's hostname (e.g., registry.example.com and example.com).
// - differentHost: The realm is on any other host.
export type OCIAuthLookupBlockedReason = 'httpRealm' | 'differentPort' | 'parentDomain' | 'differentHost';

export interface OCIAuthDiagnostics {
	authLookupWouldBeBlocked: boolean;
	authLookupBlockedKinds: OCIAuthLookupKind[];
	authLookupBlockedReasons: OCIAuthLookupBlockedReason[];
	registryRedirectWouldPreventCredentialForwarding: boolean;
	authServerRedirect: boolean;
}

export function createOCIAuthDiagnostics(): OCIAuthDiagnostics {
	return {
		authLookupWouldBeBlocked: false,
		authLookupBlockedKinds: [],
		authLookupBlockedReasons: [],
		registryRedirectWouldPreventCredentialForwarding: false,
		authServerRedirect: false,
	};
}

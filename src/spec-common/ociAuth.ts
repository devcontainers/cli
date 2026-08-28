/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface OCIAuthDiagnostics {
	authLookupWouldBeBlocked: boolean;
	registryRedirectWouldPreventCredentialForwarding: boolean;
	authServerRedirect: boolean;
}

export function createOCIAuthDiagnostics(): OCIAuthDiagnostics {
	return {
		authLookupWouldBeBlocked: false,
		registryRedirectWouldPreventCredentialForwarding: false,
		authServerRedirect: false,
	};
}

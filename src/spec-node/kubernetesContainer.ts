/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ResolverParameters, getContainerProperties, ContainerProperties } from '../spec-common/injectHeadless';
import { KubeCLIParameters, inspectPod, kubectlExecFunction, kubectlPtyExecFunction } from '../spec-shutdown/kubeUtils';

export function parseContainerUser(containerUser: string): { user: string | undefined; group: string | undefined } {
	const [, user, , group] = /([^:]*)(:(.*))?/.exec(containerUser) as (string | undefined)[];
	return { user: (user === '0' ? 'root' : user) || undefined, group };
}

export async function createK8sContainerProperties(
	params: ResolverParameters,
	kubeParams: KubeCLIParameters,
	remoteWorkspaceFolder: string | undefined,
	remoteUser: string | undefined,
): Promise<ContainerProperties> {
	const inspecting = 'Inspecting pod';
	const start = params.output.start(inspecting);
	const podInfo = await inspectPod(kubeParams);
	params.output.stop(inspecting, start);

	const containerUser = remoteUser || podInfo.containerUser || 'root';
	const { user, group } = parseContainerUser(containerUser);

	// Use parsed user (not raw containerUser) because su only accepts
	// usernames, not the user:group format that Docker's -u flag supports.
	const remoteExec = kubectlExecFunction(kubeParams, user);
	const remotePtyExec = await kubectlPtyExecFunction(kubeParams, user, params.loadNativeModule, params.allowInheritTTY);

	// Only provide remoteExecAsRoot if the container already runs as root.
	// In K8s, switching to root via su/runuser fails when runAsNonRoot is set
	// or the container lacks privilege escalation tools.
	const remoteExecAsRoot = user === 'root'
		? remoteExec
		: undefined;

	return getContainerProperties({
		params,
		createdAt: podInfo.createdAt,
		startedAt: podInfo.startedAt,
		remoteWorkspaceFolder,
		containerUser: user,
		containerGroup: group,
		// We pass an empty env here rather than undefined. The shell server
		// launched by getContainerProperties will probe the actual runtime
		// environment (resolving valueFrom refs) when probeRemoteEnv runs.
		// Passing undefined would also probe env but can cause hangs when
		// the shell server's PATH probe interacts with kubectl exec wrapping.
		containerEnv: {},
		remoteExec,
		remotePtyExec,
		remoteExecAsRoot,
		rootShellServer: undefined,
	});
}

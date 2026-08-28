/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CLIHost, runCommandNoPty, ExecFunction, ExecParameters, Exec, PtyExecFunction, PtyExec, PtyExecParameters, plainExecAsPtyExec } from '../spec-common/commonUtils';
import * as ptyType from 'node-pty';
import { Log, LogEvent, makeLog } from '../spec-utils/log';
import { escapeRegExCharacters } from '../spec-utils/strings';

export interface KubeCLIParameters {
	cliHost: CLIHost;
	kubectlCLI: string;
	context: string | undefined;
	kubeconfig: string | undefined;
	namespace: string;
	pod: string;
	container: string;
	env: NodeJS.ProcessEnv;
	output: Log;
}

export interface PodDetails {
	name: string;
	namespace: string;
	createdAt: string;
	startedAt: string;
	containerUser: string;
}

export async function inspectPod(params: KubeCLIParameters): Promise<PodDetails> {
	const result = await kubectlCLI(params, 'get', 'pod', params.pod,
		'-n', params.namespace,
		'-o', 'json',
	);
	const pod = JSON.parse(result.stdout.toString());
	const containerSpec = pod.spec?.containers?.find((c: { name: string }) => c.name === params.container)
		|| pod.spec?.containers?.[0];
	const containerStatus = pod.status?.containerStatuses?.find((c: { name: string }) => c.name === params.container)
		|| pod.status?.containerStatuses?.[0];

	const securityContext = containerSpec?.securityContext || pod.spec?.securityContext || {};
	const runAsUser = securityContext.runAsUser;
	const containerUser = runAsUser ? String(runAsUser) : 'root';

	// Pod spec env only contains static values — valueFrom refs (ConfigMaps,
	// Secrets, Downward API) are resolved by the kubelet at runtime and aren't
	// visible here. We deliberately omit containerEnv so getContainerProperties
	// probes the actual runtime environment via the shell server.

	return {
		name: pod.metadata.name,
		namespace: pod.metadata.namespace,
		createdAt: pod.metadata.creationTimestamp || '',
		startedAt: containerStatus?.state?.running?.startedAt || pod.metadata.creationTimestamp || '',
		containerUser,
	};
}

/**
 * kubectl exec doesn't support -u (user), -e (env), or -w (cwd) flags
 * like `docker exec` does. When env/cwd/user switching is needed, we wrap
 * the target command in a shell invocation. When none of these are needed,
 * we pass the command through directly to avoid unnecessary shell layers
 * (important for interactive shells used by the shell server).
 *
 * For non-root users, we use `su -s /bin/sh <user> -c` (no login shell,
 * matching Docker's `-u` behaviour).
 */
function buildWrappedCommand(user: string | undefined, params: ExecParameters | PtyExecParameters): { cmd: string; args: string[] } {
	const { env, cwd, cmd, args } = params;

	const hasEnv = env && Object.keys(env).length > 0;
	const hasCwd = !!cwd;
	const needsUserSwitch = !!(user && user !== 'root');

	// Fast path: no wrapping needed when there's nothing to set up.
	if (!hasEnv && !hasCwd && !needsUserSwitch) {
		return { cmd, args: args || [] };
	}

	const parts: string[] = [];

	if (hasEnv) {
		for (const key of Object.keys(env!)) {
			if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(key)) {
				parts.push(`export ${key}=${shellQuote(env![key] ?? '')};`);
			}
		}
	}

	if (hasCwd) {
		parts.push(`cd ${shellQuote(cwd!)};`);
	}

	parts.push(`exec ${shellQuote(cmd)}`);
	if (args) {
		parts.push(...args.map(shellQuote));
	}

	const script = parts.join(' ');

	if (needsUserSwitch) {
		if (!/^[a-zA-Z0-9_][\w.-]*$/.test(user!)) {
			throw new Error(`Invalid container user: ${user}`);
		}
		return { cmd: 'su', args: ['-s', '/bin/sh', user!, '-c', script] };
	}

	return { cmd: '/bin/sh', args: ['-c', script] };
}

function shellQuote(s: string): string {
	const sanitised = s.replace(/\0/g, '');
	if (/^[a-zA-Z0-9_./:=-]+$/.test(sanitised)) {
		return sanitised;
	}
	return `'${sanitised.replace(/'/g, `'\\''`)}'`;
}

function toKubectlExecArgs(params: KubeCLIParameters, user: string | undefined, execParams: ExecParameters | PtyExecParameters, pty: boolean): { argsPrefix: string[]; args: string[] } {
	const kubectlArgs = [...globalKubeArgs(params), 'exec', '-i'];
	if (pty) {
		kubectlArgs.push('-t');
	}
	kubectlArgs.push(params.pod, '-n', params.namespace, '-c', params.container, '--');

	const argsPrefix = kubectlArgs.slice();

	const wrapped = buildWrappedCommand(user, execParams);
	kubectlArgs.push(wrapped.cmd, ...wrapped.args);

	return { argsPrefix, args: kubectlArgs };
}

export function kubectlExecFunction(params: KubeCLIParameters, user: string | undefined, allocatePtyIfPossible = false): ExecFunction {
	return async function (execParams: ExecParameters): Promise<Exec> {
		const canAllocatePty = allocatePtyIfPossible && process.stdin.isTTY && execParams.stdio?.[0] === 'inherit';
		const { argsPrefix, args: execArgs } = toKubectlExecArgs(params, user, execParams, canAllocatePty);
		return params.cliHost.exec({
			cmd: params.kubectlCLI,
			args: execArgs,
			env: params.env,
			stdio: execParams.stdio,
			output: replacingKubectlExecLog(execParams.output, params.kubectlCLI, argsPrefix),
		});
	};
}

export async function kubectlPtyExecFunction(params: KubeCLIParameters, user: string | undefined, loadNativeModule: <T>(moduleName: string) => Promise<T | undefined>, allowInheritTTY: boolean): Promise<PtyExecFunction> {
	const pty = await loadNativeModule<typeof ptyType>('node-pty');
	if (!pty) {
		const plain = kubectlExecFunction(params, user, true);
		return plainExecAsPtyExec(plain, allowInheritTTY);
	}

	return async function (execParams: PtyExecParameters): Promise<PtyExec> {
		const { argsPrefix, args: execArgs } = toKubectlExecArgs(params, user, execParams, true);
		return params.cliHost.ptyExec({
			cmd: params.kubectlCLI,
			args: execArgs,
			env: params.env,
			output: replacingKubectlExecLog(execParams.output, params.kubectlCLI, argsPrefix),
		});
	};
}

function replacingKubectlExecLog(original: Log, cmd: string, args: string[]) {
	const search = `Run: ${cmd} ${(args || []).join(' ').replace(/\n.*/g, '')}`;
	const searchR = new RegExp(escapeRegExCharacters(search), 'g');
	return makeLog({
		...original,
		get dimensions() {
			return original.dimensions;
		},
		event: (e: LogEvent) => original.event('text' in e ? {
			...e,
			text: e.text.replace(searchR, 'Run in container:'),
		} : e),
	});
}

function globalKubeArgs(params: KubeCLIParameters): string[] {
	const args: string[] = [];
	if (params.kubeconfig) {
		args.push('--kubeconfig', params.kubeconfig);
	}
	if (params.context) {
		args.push('--context', params.context);
	}
	return args;
}

async function kubectlCLI(params: KubeCLIParameters, ...args: string[]) {
	return runCommandNoPty({
		exec: params.cliHost.exec,
		cmd: params.kubectlCLI,
		args: [...globalKubeArgs(params), ...args],
		env: params.env,
		output: params.output,
	});
}

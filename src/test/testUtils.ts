/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as cp from 'child_process';
import { getCLIHost, loadNativeModule, plainExec, plainPtyExec, runCommand, runCommandNoPty } from '../spec-common/commonUtils';
import { SubstituteConfig } from '../spec-node/utils';
import { LogLevel, createPlainLog, makeLog, nullLog } from '../spec-utils/log';
import { dockerComposeCLIConfig } from '../spec-node/dockerCompose';
import { DockerCLIParameters } from '../spec-shutdown/dockerUtils';
import { mapNodeArchitectureToGOARCH, mapNodeOSToGOOS } from '../spec-configuration/containerCollectionsOCI';

export interface BuildKitOption {
    text: string;
    options: {
        useBuildKit: boolean;
    };
}

export const nonBuildKitOption: BuildKitOption = { text: 'non-BuildKit', options: { useBuildKit: false }, };
export const buildKitOption: BuildKitOption = { text: 'BuildKit', options: { useBuildKit: true }, };

export const buildKitOptions: ReadonlyArray<BuildKitOption> = [
    nonBuildKitOption,
    buildKitOption,
] as const;

export interface UpResult {
    outcome: string;
    containerId: string;
    composeProjectName: string | undefined;
    stderr: string;
}

export interface ExecResult {
    error: Error | null;
    stdout: string;
    stderr: string;
}

export function shellExec(command: string, options: cp.ExecOptions = {}, suppressOutput: boolean = false, doNotThrow: boolean = false): Promise<ExecResult> {
    return new Promise<ExecResult>((resolve, reject) => {
        cp.exec(command, options, (error, stdout, stderr) => {
            if (!suppressOutput) {
                console.log(stdout);
                console.error(stderr);
            }
            ((error && !doNotThrow) ? reject : resolve)({ error, stdout, stderr });
        });
    });
}

export interface BufferExecResult {
    stdout: Buffer;
    stderr: Buffer;
    message? : string;
    code?: number | null;
    signal?: string | null;
}

export async function shellBufferExec(command: string, options: { stdin?: Buffer } = {}): Promise<BufferExecResult> {
    const exec = await plainExec(undefined);
    return runCommandNoPty({
        exec,
        cmd: '/bin/sh',
        args: ['-c', command],
        stdin: options.stdin,
        output: nullLog,
    }).then(res => ({ code: 0, ...res }), error => error);
}

export interface ExecPtyResult {
    cmdOutput: string;
    message? : string;
    code?: number;
    signal?: number;
}

export async function shellPtyExec(command: string, options: { stdin?: string } = {}): Promise<ExecPtyResult> {
    const ptyExec = await plainPtyExec(undefined, loadNativeModule, true);
    return runCommand({
        ptyExec,
        cmd: '/bin/sh',
        args: ['-c', command],
        stdin: options.stdin,
        output: nullLog,
    }).then(res => ({ code: 0, ...res }), error => error);
}

export async function devContainerUp(cli: string, workspaceFolder: string, options?: { cwd?: string; useBuildKit?: boolean; userDataFolder?: string; logLevel?: string; extraArgs?: string; prefix?: string; env?: NodeJS.ProcessEnv }): Promise<UpResult> {
    const buildkitOption = (options?.useBuildKit ?? false) ? '' : ' --buildkit=never';
    const userDataFolderOption = (options?.userDataFolder ?? false) ? ` --user-data-folder=${options?.userDataFolder}` : '';
    const logLevelOption = (options?.logLevel ?? false) ? ` --log-level ${options?.logLevel}` : '';
    const extraArgs = (options?.extraArgs ?? false) ? ` ${options?.extraArgs}` : '';
    const prefix = (options?.prefix ?? false) ? `${options?.prefix} ` : '';
    const shellExecOptions = { cwd: options?.cwd, env: options?.env };
    const res = await shellExec(`${prefix}${cli} up --workspace-folder ${workspaceFolder}${buildkitOption}${userDataFolderOption}${extraArgs} ${logLevelOption}`, shellExecOptions);
    const response = JSON.parse(res.stdout);
    assert.equal(response.outcome, 'success');
    const { outcome, containerId, composeProjectName } = response as UpResult;
    assert.ok(containerId, 'Container id not found.');
    return { outcome, containerId, composeProjectName, stderr: res.stderr };
}
export async function devContainerDown(options: { containerId?: string | null; composeProjectName?: string | null; doNotThrow?: boolean }) {
    if (options.containerId) {
        await shellExec(`docker rm -f ${options.containerId}`, undefined, undefined, options.doNotThrow);
    }
    if (options.composeProjectName) {
        await shellExec(`docker compose --project-name ${options.composeProjectName} down`, undefined, undefined, options.doNotThrow);
    }
}
export async function devContainerStop(options: { containerId?: string | null; composeProjectName?: string | null }) {
    if (options.containerId) {
        await shellExec(`docker stop ${options.containerId}`);
    }
    if (options.composeProjectName) {
        await shellExec(`docker compose --project-name ${options.composeProjectName} stop`);
    }
}
export async function pathExists(cli: string, workspaceFolder: string, location: string) {
    try {
        await shellExec(`${cli} exec --workspace-folder ${workspaceFolder} test -e ${location}`);
        return true;
    } catch (err) {
        return false;
    }
}
export async function commandMarkerTests(cli: string, workspaceFolder: string, expected: { postCreate: boolean; postStart: boolean; postAttach: boolean }, message: string) {
    const actual = {
        postCreate: await pathExists(cli, workspaceFolder, '/tmp/postCreateCommand.testmarker'),
        postStart: await pathExists(cli, workspaceFolder, '/tmp/postStartCommand.testmarker'),
        postAttach: await pathExists(cli, workspaceFolder, '/tmp/postAttachCommand.testmarker'),
    };
    assert.deepStrictEqual(actual, expected, message);
}

export const testSubstitute: SubstituteConfig = value => {
	if ('id' in value) {
		return {
			...value,
			id: (value as any).id + '-substituted'
		};
	}
	return value;
};

export const output = makeLog(createPlainLog(text => process.stdout.write(text), () => LogLevel.Trace));

export async function createCLIParams(hostPath: string) {
	const cliHost = await getCLIHost(hostPath, loadNativeModule, true);
	const dockerComposeCLI = dockerComposeCLIConfig({
		exec: cliHost.exec,
		env: cliHost.env,
		output,
	}, 'docker', 'docker-compose');
	const cliParams: DockerCLIParameters = {
		cliHost,
		dockerCLI: 'docker',
		dockerComposeCLI,
		env: {},
		output,
		platformInfo: {
			os: mapNodeOSToGOOS(cliHost.platform),
			arch: mapNodeArchitectureToGOARCH(cliHost.arch),
		}
};
	return cliParams;
}

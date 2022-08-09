import * as assert from 'assert';
import * as cp from 'child_process';

export const buildKitOptions = [
    { text: 'non-BuildKit', options: { useBuildKit: false }, },
    { text: 'BuildKit', options: { useBuildKit: true }, },
] as const;

export interface UpResult {
    outcome: string;
    containerId: string;
    composeProjectName: string | undefined;
}

interface ExecResult {
    error: Error | null;
    stdout: string;
    stderr: string;
}

export function shellExec(command: string, options: cp.ExecOptions = {}, suppressOutput: boolean = false) {
    return new Promise<ExecResult>((resolve, reject) => {
        cp.exec(command, options, (error, stdout, stderr) => {
            if (!suppressOutput) {
                console.log(stdout);
                console.error(stderr);
            }
            (error ? reject : resolve)({ error, stdout, stderr });
        });
    });
}

export async function devContainerUp(cli: string, workspaceFolder: string, options?: { cwd?: string; useBuildKit?: boolean; userDataFolder?: string; logLevel?: string }): Promise<UpResult> {
    const buildkitOption = (options?.useBuildKit ?? false) ? '' : ' --buildkit=never';
    const userDataFolderOption = (options?.userDataFolder ?? false) ? ` --user-data-folder=${options?.userDataFolder}` : '';
    const logLevelOption = (options?.logLevel ?? false) ? ` --log-level ${options?.logLevel}` : '';
    const shellExecOptions = { cwd: options?.cwd };
    const res = await shellExec(`${cli} up --workspace-folder ${workspaceFolder}${buildkitOption}${userDataFolderOption} ${logLevelOption}`, shellExecOptions);
    const response = JSON.parse(res.stdout);
    assert.equal(response.outcome, 'success');
    const { outcome, containerId, composeProjectName } = response as UpResult;
    assert.ok(containerId, 'Container id not found.');
    return { outcome, containerId, composeProjectName };
}
export async function devContainerDown(options: { containerId?: string | null; composeProjectName?: string | null }) {
    if (options.containerId) {
        await shellExec(`docker rm -f ${options.containerId}`);
    }
    if (options.composeProjectName) {
        await shellExec(`docker compose --project-name ${options.composeProjectName} down`);
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
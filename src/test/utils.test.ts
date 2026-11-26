/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { PassThrough } from 'stream';

import { delay } from '../spec-common/async';
import { CLIHost, Exec, ExecFunction, ExecParameters } from '../spec-common/commonUtils';
import { DockerResolverParameters, isBuildxCacheToInline, startEventSeen } from '../spec-node/utils';
import { CLIVariant } from '../spec-shutdown/dockerUtils';
import { nullLog } from '../spec-utils/log';

describe('Utils', function () {
	describe('isBuildxCacheToInline', function () {
		it('returns false for undefined or empty', () => {
			assert.strictEqual(isBuildxCacheToInline(undefined), false);
			assert.strictEqual(isBuildxCacheToInline(''), false);
		});

		it('returns true for inline cache type', () => {
			assert.strictEqual(isBuildxCacheToInline('type=inline'), true);
			assert.strictEqual(isBuildxCacheToInline('type = inline'), true);
			assert.strictEqual(isBuildxCacheToInline('type=INLINE'), true);
			assert.strictEqual(isBuildxCacheToInline('mode=max,type=inline,compression=zstd'), true);
		});

		it('returns false for non-inline cache type', () => {
			assert.strictEqual(isBuildxCacheToInline('type=registry'), false);
			assert.strictEqual(isBuildxCacheToInline('type=local'), false);
			assert.strictEqual(isBuildxCacheToInline('inline'), false);
		});
	});
});

describe('startEventSeen', function () {
	this.timeout(20 * 1000);

	const labels = { 'devcontainer.local_folder': '/workspaces/demo' };
	const eventsArgs = ['events', '--format', '{{json .}}', '--filter', 'event=start'];
	const psArgs = ['ps', '-q', '--filter', 'label=devcontainer.local_folder=/workspaces/demo'];
	const psAllArgs = ['ps', '-q', '-a', '--filter', 'label=devcontainer.local_folder=/workspaces/demo'];

	// Stands in for the container runtime: `events` only reports what a test writes to its stdout, `ps` lists `running()`,
	// and `ps -a` also `stopped`.
	function runtime(cliVariant: CLIVariant, running: () => string[], stopped: string[] = []) {
		const calls: ExecParameters[] = [];
		const eventStdout: PassThrough[] = [];
		const terminated: string[] = [];
		const exec: ExecFunction = async params => {
			calls.push(params);
			const isEvents = params.args?.[0] === 'events';
			const stdout = new PassThrough();
			const stderr = new PassThrough();
			let exitWith!: (code: number | null, signal: string | null) => void;
			const proc: Exec = {
				stdin: new PassThrough(), stdout, stderr,
				exit: new Promise(resolve => { exitWith = (code, signal) => resolve({ code, signal }); }),
				async terminate() {
					terminated.push(params.args![0]);
					stdout.end();
					stderr.end();
					exitWith(null, 'SIGKILL');
				},
			};
			if (isEvents) {
				eventStdout.push(stdout);
			} else {
				setImmediate(() => {
					const all = params.args!.includes('-a');
					stdout.end(Buffer.from([...running(), ...(all ? stopped : [])].join('\n')));
					stderr.end();
					exitWith(0, null);
				});
			}
			return proc;
		};
		const params = {
			dockerCLI: 'docker', cliVariant, dockerEnv: {},
			dockerComposeCLI: async () => ({ version: '2.0.0', cmd: 'docker', args: [] }),
			common: { cliHost: { exec } as CLIHost, output: nullLog },
		} as unknown as DockerResolverParameters;
		return { params, eventStdout, terminated, commands: () => calls.map(call => call.args) };
	}

	// The callers reject `canceled` when starting the container fails (for `docker run`, once it exits).
	function cancelable() {
		let cancel!: (reason: unknown) => void;
		const canceled = new Promise<void>((_, reject) => { cancel = reject; });
		return { canceled, cancel };
	}

	it('resolves on the start event without polling', async () => {
		const { params, eventStdout, terminated, commands } = runtime(CLIVariant.Docker, () => []);
		const { started } = await startEventSeen(params, labels, cancelable().canceled, nullLog, false);
		eventStdout[0].write(`${JSON.stringify({ status: 'start', Actor: { Attributes: labels } })}\n`);
		await started;
		assert.deepStrictEqual(terminated, ['events']);
		// Polling is held back to give the event time to arrive.
		await delay(4000);
		assert.deepStrictEqual(commands(), [eventsArgs]);
	});

	it('resolves on the running container when the start event is never delivered', async () => {
		const { params, terminated, commands } = runtime(CLIVariant.Docker, () => ['container']);
		const { started } = await startEventSeen(params, labels, cancelable().canceled, nullLog, false);
		await started;
		assert.deepStrictEqual(terminated, ['events']);
		assert.deepStrictEqual(commands(), [eventsArgs, psArgs]);
	});

	it('rejects when canceled without polling', async () => {
		const { params, terminated, commands } = runtime(CLIVariant.Docker, () => ['container']);
		const { canceled, cancel } = cancelable();
		const { started } = await startEventSeen(params, labels, canceled, nullLog, false);
		const reason = new Error('docker run exited');
		cancel(reason);
		await assert.rejects(started, (err: unknown) => err === reason);
		assert.deepStrictEqual(terminated, ['events']);
		// Polling is held back to give the event time to arrive.
		await delay(4000);
		assert.deepStrictEqual(commands(), [eventsArgs]);
	});

	it('polls right away for wslc, which has no `events` command', async () => {
		const { params, commands } = runtime(CLIVariant.Wslc, () => ['container']);
		const { started } = await startEventSeen(params, labels, cancelable().canceled, nullLog, false);
		await Promise.race([started, delay(2000).then(() => { throw new Error('Polling did not start right away.'); })]);
		assert.deepStrictEqual(commands(), [psArgs]);
	});

	it('stops polling when canceled', async () => {
		const { params, commands } = runtime(CLIVariant.Wslc, () => []);
		const { canceled, cancel } = cancelable();
		const { started } = await startEventSeen(params, labels, canceled, nullLog, false);
		while (commands().length < 2) {
			await delay(50);
		}
		const reason = new Error('wslc run exited');
		cancel(reason);
		await assert.rejects(started, (err: unknown) => err === reason);
		// Several polling intervals.
		await delay(1500);
		assert.deepStrictEqual(commands(), [psArgs, psArgs]);
	});

	it('resolves on a stopped container once the command finished', async () => {
		const { params, commands } = runtime(CLIVariant.Docker, () => [], ['container']);
		let finishCommand!: () => void;
		const commandFinished = new Promise<void>(resolve => { finishCommand = resolve; });
		const { started } = await startEventSeen(params, labels, cancelable().canceled, nullLog, false, Promise.resolve(), commandFinished);
		// Only running containers count while the command runs.
		while (commands().length < 2) {
			await delay(50);
		}
		finishCommand();
		await started;
		assert.deepStrictEqual(commands(), [eventsArgs, psArgs, psAllArgs]);
	});

	it('does not poll before the command that starts the container was issued', async () => {
		const { params, commands } = runtime(CLIVariant.Docker, () => ['container']);
		let issueCommand!: () => void;
		const commandStarted = new Promise<void>(resolve => { issueCommand = resolve; });
		const { started } = await startEventSeen(params, labels, cancelable().canceled, nullLog, false, commandStarted);
		// Longer than the interval the event gets: polling would have started if it did not wait for the command.
		await delay(4000);
		assert.deepStrictEqual(commands(), [eventsArgs]);
		issueCommand();
		// The event now gets its time to arrive.
		await delay(1500);
		assert.deepStrictEqual(commands(), [eventsArgs]);
		await started;
		assert.deepStrictEqual(commands(), [eventsArgs, psArgs]);
	});
});

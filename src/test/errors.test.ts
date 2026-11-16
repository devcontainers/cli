/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { PassThrough } from 'stream';
import { ContainerError, getErrorOutput } from '../spec-common/errors';
import { runCommand, runCommandNoPty } from '../spec-common/commonUtils';
import { nullLog } from '../spec-utils/log';

describe('getErrorOutput', () => {

	function failPty(output: string) {
		return runCommand({
			ptyExec: async () => ({
				onData: (cb: (data: string) => void) => {
					cb(output);
					return { dispose() { } };
				},
				resize() { },
				exit: Promise.resolve({ code: 125, signal: undefined }),
				terminate: async () => { },
			}),
			cmd: 'docker',
			args: ['run', 'image'],
			output: nullLog,
			print: 'off',
		}).then(() => assert.fail('Expected the command to fail.'), err => err);
	}

	function fail(stdout: string, stderr: string) {
		return runCommandNoPty({
			exec: async () => {
				const stdoutStream = new PassThrough();
				const stderrStream = new PassThrough();
				return {
					stdin: new PassThrough(), stdout: stdoutStream, stderr: stderrStream,
					exit: new Promise(resolve => setImmediate(() => {
						stdoutStream.end(stdout);
						stderrStream.end(stderr);
						resolve({ code: 1, signal: null });
					})),
					terminate: async () => { },
				};
			},
			cmd: 'docker',
			args: ['compose', 'up'],
			output: nullLog,
		}).then(() => assert.fail('Expected the command to fail.'), err => err);
	}

	it('returns the end of the output of the failed command', async () => {
		const lines = Array.from({ length: 18 }, (_, i) => `line ${i}`);
		const ptyErr = await failPty(`${lines.join('\r\n')}\r\nPulling 10%\rPulling 100%\r\n\r\n\x1b[31mdocker: Error response from daemon: invalid mount config.\x1b[0m\r\n\x1b]0;title\x07Run 'docker run --help' for more information\r\n`);
		const err = await fail('stdout', 'Error response from daemon: Conflict.\n');
		const long = getErrorOutput(await fail('', `${'x'.repeat(3000)}END`));
		assert.deepStrictEqual({
			pty: getErrorOutput(new ContainerError({ description: 'An error occurred setting up the container.', originalError: ptyErr })),
			noPty: getErrorOutput(new ContainerError({ description: 'An error occurred starting Docker Compose up.', originalError: err })),
			long: long && { length: long.length, end: long.slice(-5) },
			noOutput: getErrorOutput(new ContainerError({ description: 'The expected container does not exist.' })),
		}, {
			pty: [...lines.slice(1), 'Pulling 100%', 'docker: Error response from daemon: invalid mount config.', `Run 'docker run --help' for more information`].join('\n'),
			noPty: 'Error response from daemon: Conflict.',
			long: { length: 2000, end: 'xxEND' },
			noOutput: undefined,
		});
	});
});

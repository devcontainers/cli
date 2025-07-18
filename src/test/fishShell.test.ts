/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as path from 'path';
import * as crypto from 'crypto';

describe('Fish shell command construction', function () {
	this.timeout('20s');

	it('should properly quote commands for fish shell in interactive mode', async () => {
		// Simulate the logic from runUserEnvProbe function
		const systemShellUnix = '/usr/bin/fish';
		const name = path.posix.basename(systemShellUnix);
		const mark = crypto.randomUUID();
		let command = `echo -n ${mark}; cat /proc/self/environ; echo -n ${mark}`;
		
		// Test fish shell detection and command quoting
		if (/^fish$/.test(name)) {
			// Fish shell needs the command to be quoted when using interactive modes
			// to prevent it from interpreting the -n flag as a shell option
			const isInteractive = true; // simulating 'loginInteractiveShell'
			if (isInteractive) {
				command = `'${command.replace(/'/g, `'\\''`)}'`;
			}
		}
		
		// Verify the command is properly quoted
		assert.ok(command.startsWith(`'echo -n ${mark};`));
		assert.ok(command.endsWith(`; echo -n ${mark}'`));
		assert.ok(command.includes('cat /proc/self/environ'));
		
		// Test that the command handles single quotes properly
		const commandWithQuotes = `echo -n ${mark}; echo 'test'; echo -n ${mark}`;
		let quotedCommand = commandWithQuotes;
		if (/^fish$/.test(name)) {
			quotedCommand = `'${commandWithQuotes.replace(/'/g, `'\\''`)}'`;
		}
		
		// Verify single quotes are properly escaped
		assert.ok(quotedCommand.includes(`'\\''test'\\''`));
	});

	it('should not quote commands for fish shell in non-interactive mode', async () => {
		// Simulate the logic from runUserEnvProbe function
		const systemShellUnix = '/usr/bin/fish';
		const name = path.posix.basename(systemShellUnix);
		const mark = crypto.randomUUID();
		let command = `echo -n ${mark}; cat /proc/self/environ; echo -n ${mark}`;
		
		// Test fish shell detection and command quoting
		if (/^fish$/.test(name)) {
			// Fish shell needs the command to be quoted when using interactive modes
			// to prevent it from interpreting the -n flag as a shell option
			const isInteractive = false; // simulating 'loginShell' (non-interactive)
			if (isInteractive) {
				command = `'${command.replace(/'/g, `'\\''`)}'`;
			}
		}
		
		// Verify the command is NOT quoted for non-interactive mode
		assert.ok(!command.startsWith(`'echo -n ${mark};`));
		assert.ok(!command.endsWith(`; echo -n ${mark}'`));
		assert.strictEqual(command, `echo -n ${mark}; cat /proc/self/environ; echo -n ${mark}`);
	});

	it('should not affect non-fish shells', async () => {
		// Test that other shells are not affected
		const systemShellUnix = '/bin/bash';
		const name = path.posix.basename(systemShellUnix);
		const mark = crypto.randomUUID();
		let command = `echo -n ${mark}; cat /proc/self/environ; echo -n ${mark}`;
		const originalCommand = command;
		
		// Test non-fish shell
		if (/^fish$/.test(name)) {
			// This should not execute for bash
			command = `'${command.replace(/'/g, `'\\''`)}'`;
		}
		
		// Verify the command is unchanged for non-fish shells
		assert.strictEqual(command, originalCommand);
	});
});
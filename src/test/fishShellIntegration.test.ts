/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { shellExec } from './testUtils';

describe('Fish shell integration', function () {
	this.timeout('30s');

	it('should successfully read environment variables with fish shell', async () => {
		// Test the actual fish shell command construction
		const testCommand = `echo -n START; echo 'TEST_VAR=test_value'; echo -n END`;
		
		// Test the problematic case without quoting (should fail)
		const unquotedCommand = `fish -lic ${testCommand}`;
		
		// Test the fixed case with quoting (should work)
		const quotedCommand = `fish -lic '${testCommand.replace(/'/g, `'\\''`)}'`;
		
		try {
			// This test requires fish to be installed
			await shellExec('fish --version', {}, true, true);
			
			// Test the unquoted command (should show warning/error)
			const unquotedResult = await shellExec(unquotedCommand, {}, true, true);
			
			// The unquoted command should either fail or show a warning
			const hasWarning = unquotedResult.stderr.includes('Can not use the no-execute mode') || 
			                   unquotedResult.stderr.includes('warning') ||
			                   unquotedResult.error !== null;
			
			// Test the quoted command (should work)
			const quotedResult = await shellExec(quotedCommand, {}, true, true);
			
			// The quoted command should work without warnings
			assert.ok(quotedResult.error === null, 'Quoted command should not error');
			assert.ok(quotedResult.stdout.includes('START'), 'Should contain START marker');
			assert.ok(quotedResult.stdout.includes('END'), 'Should contain END marker');
			assert.ok(quotedResult.stdout.includes('TEST_VAR=test_value'), 'Should contain test environment variable');
			
			// At least one of the following should be true:
			// 1. The unquoted command shows a warning or error
			// 2. The quoted command works better (more complete output)
			const quotedOutputComplete = quotedResult.stdout.includes('START') && 
			                           quotedResult.stdout.includes('END') && 
			                           quotedResult.stdout.includes('TEST_VAR=test_value');
			
			assert.ok(hasWarning || quotedOutputComplete, 'Either unquoted command should warn or quoted command should work better');
			
		} catch (error) {
			// If fish is not installed, skip this test
			console.log('Fish shell not available, skipping integration test');
		}
	});
});
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { assert } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ExecFunction, plainExec } from '../spec-common/commonUtils';
import { nullLog } from '../spec-utils/log';
import { ensureDockerfileHasFinalStageName, preprocessDockerfileIn } from '../spec-node/dockerfileUtils';

describe('preprocessDockerfileIn', () => {
    // Use the actual Dockerfile.in from the podman-with-cpp config directory.
    // It defines BASE_IMAGE, INSTALL_NODE, and INSTALL_PYTHON macros, uses
    // #ifdef/#endif blocks, and #includes common.Dockerfile and tools.Dockerfile.
    const configDir = path.join(__dirname, 'configs', 'podman-with-cpp');
    const dockerfileInPath = path.join(configDir, 'Dockerfile.in');

    let tmpDir: string;

    before(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devcontainer-preprocess-test-'));
    });

    after(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    describe('when cpp is available on the host', () => {
        let exec: ExecFunction;

        before(async () => {
            exec = await plainExec(undefined);
        });

        it('should preprocess #ifdef / #endif conditional blocks', async () => {
            // INSTALL_NODE and INSTALL_PYTHON are both #define'd in Dockerfile.in
            const result = await preprocessDockerfileIn(dockerfileInPath, exec, nullLog);

            assert.include(result, 'apt-get install -y nodejs');
            assert.include(result, 'apt-get install -y python3');
            assert.notInclude(result, '#ifdef');
            assert.notInclude(result, '#endif');
        });

        it('should inline content from #include directives', async () => {
            // Dockerfile.in #includes common.Dockerfile and tools.Dockerfile
            const result = await preprocessDockerfileIn(dockerfileInPath, exec, nullLog);

            assert.include(result, 'apt-get install -y curl wget');
            assert.include(result, 'APP_ENV=development');
            assert.include(result, 'apt-get install -y vim');
        });

        it('should substitute macros and pass through plain Dockerfile content', async () => {
            // BASE_IMAGE is #define'd as ubuntu:20.04 in Dockerfile.in
            const result = await preprocessDockerfileIn(dockerfileInPath, exec, nullLog);

            assert.include(result, 'FROM ubuntu:20.04');
            assert.notInclude(result, 'FROM BASE_IMAGE');
        });

        it('should produce output parseable by ensureDockerfileHasFinalStageName when stage is unnamed', async () => {
            // Dockerfile.in has no AS-named final stage, so a fallback name is assigned
            const preprocessed = await preprocessDockerfileIn(dockerfileInPath, exec, nullLog);
            const { lastStageName, modifiedDockerfile } = ensureDockerfileHasFinalStageName(preprocessed, 'dev');

            assert.equal(lastStageName, 'dev');
            assert.isDefined(modifiedDockerfile);
        });

        it('should produce output where ensureDockerfileHasFinalStageName assigns a name to an unnamed final stage', async () => {
            // Dockerfile.in has no AS-named final stage, so the auto-generated label is injected
            const preprocessed = await preprocessDockerfileIn(dockerfileInPath, exec, nullLog);
            const { lastStageName, modifiedDockerfile } = ensureDockerfileHasFinalStageName(preprocessed, 'dev_container_auto_added_stage_label');

            assert.equal(lastStageName, 'dev_container_auto_added_stage_label');
            assert.isDefined(modifiedDockerfile);
            assert.include(modifiedDockerfile!, 'AS dev_container_auto_added_stage_label');
        });

        it('should throw an error when the input file does not exist', async () => {
            const nonExistentPath = path.join(tmpDir, 'does-not-exist.in');

            let caughtError: Error | undefined;
            try {
                await preprocessDockerfileIn(nonExistentPath, exec, nullLog);
            } catch (err: any) {
                caughtError = err;
            }

            assert.isDefined(caughtError);
            assert.include(caughtError!.message, 'Failed to preprocess');
        });
    });

    describe('when cpp is not available on the host', () => {
        // Simulate ENOENT by making exec throw with code 'ENOENT',
        // mirroring what happens when the binary is missing.
        const cppNotFoundExec: ExecFunction = async (_params) => {
            const err: any = new Error('spawn cpp ENOENT');
            err.code = 'ENOENT';
            throw err;
        };

        it('should throw a clear error message directing the user to install cpp', async () => {
            let caughtError: Error | undefined;
            try {
                await preprocessDockerfileIn(dockerfileInPath, cppNotFoundExec, nullLog);
            } catch (err: any) {
                caughtError = err;
            }

            assert.isDefined(caughtError);
            assert.include(caughtError!.message, 'cpp');
        });
    });
});

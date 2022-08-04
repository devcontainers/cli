/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as path from 'path';
import { devContainerDown, devContainerUp, shellExec } from '../testUtils';

const pkg = require('../../../package.json');

describe('Dev Container Features E2E', function () {
    this.timeout('120s');

    const tmp = path.relative(process.cwd(), path.join(__dirname, 'tmp'));
    const cli = `npx --prefix ${tmp} devcontainer`;

    before('Install', async () => {
        await shellExec(`rm -rf ${tmp}/node_modules`);
        await shellExec(`mkdir -p ${tmp}`);
        await shellExec(`npm --prefix ${tmp} install devcontainers-cli-${pkg.version}.tgz`);
    });

    describe('Configs with invalid features should fail', () => {
        it('should fail when a non-existent v1 feature is in the config', async () => {
            const testFolder = `${__dirname}/configs/invalid-configs/invalid-v1-features`;
            let success = false;
            try {
                await shellExec(`${cli} build --workspace-folder ${testFolder} --log-level trace`);
                success = true;
            } catch (error) {
                assert.equal(error.error.code, 1, 'Should fail with exit code 1');
                const res = JSON.parse(error.stdout);
                assert.equal(res.outcome, 'error');
                assert.ok(res.message.indexOf('Failed to fetch tarball') > -1, `Actual error msg:  ${res.message}`);
            }
            assert.equal(success, false, 'expect non-successful call');
        });

        it('should fail when a non-existent v2 feature is in the config', async () => {
            const testFolder = `${__dirname}/configs/invalid-configs/invalid-v2-features`;
            let success = false;
            try {
                await shellExec(`${cli} build --workspace-folder ${testFolder} --log-level trace`);
                success = true;
            } catch (error) {
                assert.equal(error.error.code, 1, 'Should fail with exit code 1');
                const res = JSON.parse(error.stdout);
                assert.equal(res.outcome, 'error');
                assert.ok(res.message.indexOf('Failed to process feature') > -1, `Actual error msg:  ${res.message}`);
            }
            assert.equal(success, false, 'expect non-successful call');
        });
    });


    describe('v2 - Dockerfile feature Configs', () => {

        //TODO UNCOMMENT
        // describe(`dockerfile-with-v2-oci-features`, () => {
        //     let containerId: string | null = null;
        //     const testFolder = `${__dirname}/configs/dockerfile-with-v2-oci-features`;
        //     beforeEach(async () => containerId = (await devContainerUp(cli, testFolder, { 'logLevel': 'trace' })).containerId);
        //     afterEach(async () => await devContainerDown({ containerId }));
        //     it('should detect docker installed (--privileged flag implicitly passed)', async () => {
        //         // NOTE: Doing a docker ps will ensure that the --privileged flag was set by the feature
        //         const res = await shellExec(`${cli} exec --workspace-folder ${testFolder} docker ps`);
        //         const response = JSON.parse(res.stdout);
        //         console.log(res.stderr);
        //         assert.equal(response.outcome, 'success');
        //         assert.match(res.stderr, /CONTAINER ID/);
        //     });
        // });

        describe(`dockerfile-with-v2-local-features`, () => {
            let containerId: string | null = null;
            const testFolder = `${__dirname}/configs/dockerfile-with-v2-local-features`;
            beforeEach(async () => containerId = (await devContainerUp(cli, testFolder, { 'logLevel': 'trace' })).containerId);
            afterEach(async () => await devContainerDown({ containerId }));

            it('should exec the color commmand', async () => {
                const res = await shellExec(`${cli} exec --workspace-folder ${testFolder} color`);
                const response = JSON.parse(res.stdout);
                console.log(res.stderr);
                assert.equal(response.outcome, 'success');
                assert.match(res.stderr, /my favorite color is gold/);
            });

            it('should exec the hellworld commmand', async () => {
                const res = await shellExec(`${cli} exec --workspace-folder ${testFolder} hello`);
                const response = JSON.parse(res.stdout);
                console.log(res.stderr);
                assert.equal(response.outcome, 'success');
                assert.match(res.stderr, /buongiorno, root!/);
            });
        });
    });





});
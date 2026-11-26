/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

// Stands in for the Docker CLI (used with `--docker-path <node> --docker-arg=<this file>`): every command but `events`
// is passed on to Docker, while `events` never reports anything, as happens when Podman loses an event in a log rotation.
const cp = require('child_process');

const [command, ...args] = process.argv.slice(2);
if (command !== 'events') {
	process.exit(cp.spawnSync('docker', [command, ...args], { stdio: 'inherit' }).status ?? 1);
}
setInterval(() => {}, 60000);

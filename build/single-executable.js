/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

"use strict";

const fs = require("fs");
const cp = require("child_process");

/**
 * Create a single executable file for the devcontainer CLI.
 * https://nodejs.org/api/single-executable-applications.html
 */

process.chdir("dist/spec-node");

const name = "devcontainer";
const binary = `${name}${process.platform === "win32" ? ".exe" : ""}`;

fs.copyFileSync(process.execPath, binary);

const config = {
	main: "devContainersSpecCLI.js",
	output: `prepared.blob`,
};

fs.writeFileSync("config.json", JSON.stringify(config));

cp.spawnSync(process.execPath, ["--experimental-sea-config", "config.json"], {
	stdio: "inherit",
});

cp.spawnSync(
	"npx",
	[
		"--yes",
		"postject",
		binary,
		"NODE_SEA_BLOB",
		config.output,
		"--sentinel-fuse",
		"NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2",
		...(process.platform === "darwin"
			? ["--macho-segment-name", "NODE_SEA"]
			: []),
	],
	{ stdio: "inherit" }
);

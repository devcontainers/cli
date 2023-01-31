# Applying a Dev Container Template to a folder with the CLI

## Summary

The CLI can be used to apply (download) a [Dev Container Template](https://containers.dev/implementors/templates) to a provided folder.  

Templates can be published via the `templates publish` command - see [the template-starter repo](https://github.com/devcontainers/template-starter) for more information.

To see all the available options, run `devcontainers templates apply --help`.

## Example

To apply the [debian template](https://github.com/devcontainers/templates/tree/main/src/debian) to a local folder with the CLI, execute the following steps.

```
[/tmp]$ mkdir my-project

[/tmp]$ devcontainer templates apply \
                 -t 'ghcr.io/devcontainers/templates/debian' \
                 -a '{"imageVariant": "buster"}' \
                 -w ./my-project

[0 ms] @devcontainers/cli 0.28.0. Node.js v19.3.0. darwin 21.6.0 arm64.
{"files":["./.devcontainer/devcontainer.json"]}

[/tmp]$ tree -a my-project

my-project
└── .devcontainer
    └── devcontainer.json

1 directory, 1 file

[/tmp]$ cat my-project/.devcontainer/devcontainer.json

{
	"name": "Debian",
	// Or use a Dockerfile or Docker Compose file. More info: https://containers.dev/guide/dockerfile
	"image": "mcr.microsoft.com/devcontainers/base:buster"

	// Features to add to the dev container. More info: https://containers.dev/features.
	// "features": {},

	// Use 'forwardPorts' to make a list of ports inside the container available locally.
	// "forwardPorts": [],

	// Configure tool-specific properties.
	// "customizations": {},

	// Uncomment to connect as root instead. More info: https://aka.ms/dev-containers-non-root.
	// "remoteUser": "root"
}
```

Any omitted `templateArgs` will be substituted with the `default` value declared in the Template's `devcontainer-template.json`.

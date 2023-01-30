# Applying a Dev Container Template to a folder with the CLI

## Summary

The CLI can be used to apply (download) a [Dev Container Template](https://containers.dev/implementors/templates) to a provided folder.  

Templates can be published via the `templates publish` command - see [the template-starter repo](https://github.com/devcontainers/template-starter) for more information.

To see all the available options, run `devcontainers templates apply --help`.

## Example

To apply the [debian template](https://github.com/devcontainers/templates/tree/main/src/debian) to a local folder with the CLI, execute the following steps.

![example](https://user-images.githubusercontent.com/23246594/215609996-c1109c72-1a05-410e-83a6-86a782cce929.png)

Any omitted `templateArgs` will be substituted with the `default` value declared in the Template's `devcontainer-template.json`.

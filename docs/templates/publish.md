# Publishing Dev Container Templates

> NOTE: You may want to first check out our [templates-starter](https://github.com/devcontainers/template-starter), which includes an example [actions workflow](https://github.com/devcontainers/action) for publishing directly out of your GitHub repo!

## Summary

The CLI can be used to publish [Dev Container Template](https://containers.dev/implementors/templates/) artifacts to an OCI registry (that supports the [artifacts specification](https://oras.land/implementors/)).

To see all the available options, run `devcontainers templates publish --help`.

## Example

Given a directory that is organized according to the [Templates distribution specification](https://containers.dev/implementors/templates-distribution/) - for example:

```
├── src
│   ├── color
│   │   ├── devcontainer-template.json
│   │   └──| .devcontainer
│   │      └── devcontainer.json
│   ├── hello
│   │   ├── devcontainer-template.json
│   │   └──| .devcontainer
│   │      ├── devcontainer.json
│   │      └── Dockerfile
|   ├── ...
│   │   ├── devcontainer-template.json
│   │   └──| .devcontainer
│   │      └── devcontainer.json
├── test
│   ├── color
│   │   └── test.sh
│   ├── hello
│   │   └── test.sh
│   └──test-utils
│      └── test-utils.sh
...
```

The following command will publish each Template above (`color,hello`) to the registry `ghcr.io` with the following namespace (prefix) `devcontainers/templates`.

```
[/tmp]$  GITHUB_TOKEN="$CR_PAT" devcontainer templates publish -r ghcr.io -n devcontainers/templates ./src
```

To later apply a published Template (in the example below, the `color` template) with the CLI, the following [apply](../apply) command would be used:

```
[/tmp]$  devcontainer templates apply \
                 -t 'ghcr.io/devcontainers/templates/color' \
                 -a '{"favorite": "red"}'
```

### Authentication Methods

> NOTE: OS-specific docker credential helpers (Docker Desktop credential helper) are not currently recognized by the CLI.  

- Adding a $HOME/.docker/config.json with your credentials following [this commonly defined format](https://www.systutorials.com/docs/linux/man/5-docker-config-json/).
   - Your `docker login` command may write this file for you depending on your operating system.
- Using our custom env variable DEVCONTAINERS_OCI_AUTH
    - eg: `DEVCONTAINERS_OCI_AUTH=service1|user1|token1,service2|user2|token2`
    
For publishing to `ghcr.io`
- Using the `devcontainers/action` GitHub action to handle the `GITHUB_TOKEN` credential for you.
- Providing a GITHUB_TOKEN with permission to `write:packages`.

# Contributing

We're excited for your contributions to the development container CLI! This document outlines how you can get involved. 

## Contribution approaches

- Propose the change via an issue in the [specification repository](https://github.com/microsoft/dev-container-spec/issues). Try to get early feedback before spending too much effort formalizing it.
- More formally document the proposed change in terms of properties and their semantics. Look to format your proposal like our [devcontainer.json reference](https://aka.ms/devcontainer.json), which is a JSON with Comments (jsonc) format.

Here is a sample:

| Property | Type | Description |
|----------|------|-------------|
| `image` | string | **Required** when [using an image](/docs/remote/create-dev-container.md#using-an-image-or-dockerfile). The name of an image in a container registry ([DockerHub](https://hub.docker.com), [GitHub Container Registry](https://docs.github.com/packages/guides/about-github-container-registry), [Azure Container Registry](https://azure.microsoft.com/services/container-registry/)) that VS Code and other `devcontainer.json` supporting services / tools should use to create the dev container. |

- You may open a PR, i.e code or shell scripts demonstrating approaches for implementation.
- Once there is discussion on your proposal, please also open and link a PR to update the [devcontainer.json reference doc](https://aka.ms/devcontainer.json). When your proposal is merged, the docs will be kept up-to-date with the latest spec.

## Review process

The specification repo uses the following [labels](https://github.com/microsoft/dev-container-spec/labels):

- `proposal`: Issues under discussion, still collecting feedback.
- `finalization`: Proposals we intend to make part of the spec.

[Milestones](https://github.com/microsoft/dev-container-spec/milestones) use a "month year" pattern (i.e. January 2022). If a finalized proposal is added to a milestone, it is intended to be merged during that milestone.

## Release CLI package

- Create a PR:
	- Updating the package version in the `package.json`.
	- List notable changes in the `CHANGELOG.md`.
	- Update ThirdPartyNotices.txt with any new dependencies.
- After the PR is merged to `main` wait for the CI workflow to succeed (this builds the artifact that will be published). (TBD: Let the `publish-dev-containers` workflow wait for the CI workflow.)
- Push a new tag, e.g., v0.10.0:
	- `git tag v0.10.0`
	- `git push origin v0.10.0`
- Pushing of a tag will trigger the `publish-dev-containers` workflow which will publish the new version to npm: https://www.npmjs.com/package/@devcontainers/cli

## Miscellaneous

This project has adopted the [Microsoft Open Source Code of Conduct](https://opensource.microsoft.com/codeofconduct/).
For more information see the [Code of Conduct FAQ](https://opensource.microsoft.com/codeofconduct/faq/) or
contact [opencode@microsoft.com](mailto:opencode@microsoft.com) with any additional questions or comments.

This project is under an [MIT license](LICENSE.txt).

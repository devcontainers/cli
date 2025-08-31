#  Copyright (c) Microsoft Corporation. All rights reserved.
#  Licensed under the MIT License. See License.txt in the project root for license information.
ARG TARGETARCH

FROM mcr.microsoft.com/devcontainers/typescript-node:1-16-bullseye AS base-1

FROM mcr.microsoft.com/devcontainers/typescript-node:1-18-bookworm AS base-2

FROM --platform=amd64 base-1 AS amd64-base
LABEL Architecture="amd64"

FROM --platform=arm64 base-2 AS arm64-base
LABEL Architecture="arm64"

FROM ${TARGETARCH}-base AS final

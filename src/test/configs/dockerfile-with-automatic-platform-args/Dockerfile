#  Copyright (c) Microsoft Corporation. All rights reserved.
#  Licensed under the MIT License. See License.txt in the project root for license information.
ARG VARIANT="16-bullseye"
ARG TARGETPLATFORM
ARG TARGETOS
ARG TARGETARCH
ARG TARGETVARIANT

FROM mcr.microsoft.com/devcontainers/typescript-node:1-${VARIANT} AS base

FROM --platform=amd64 base AS amd64-base
LABEL Architecture="amd64"

FROM --platform=arm64 base AS arm64-base
LABEL Architecture="arm64"

FROM ${TARGETARCH}-base AS final
ARG TARGETPLATFORM
ARG TARGETOS
ARG TARGETARCH
ARG TARGETVARIANT

LABEL TargetPlatform="${TARGETPLATFORM}" 
LABEL TargetOS="${TARGETOS}"
LABEL TargetArch="${TARGETARCH}"
LABEL TargetVariant="${TARGETVARIANT}"
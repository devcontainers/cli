#  Copyright (c) Microsoft Corporation. All rights reserved.
#  Licensed under the MIT License. See License.txt in the project root for license information.
ARG VARIANT="16-bullseye"

# Target should skip this layer
FROM alpine as false-start 

FROM mcr.microsoft.com/devcontainers/typescript-node:1-${VARIANT} as desired-image

RUN echo "||test-content||" | sudo tee /var/test-marker

# Target should skip this layer
FROM alpine as false-finish 

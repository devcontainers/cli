cmake_minimum_required(VERSION 3.16)
project(GenerateDockerfile NONE)

set(BASE_IMAGE "node:22-bookworm")
set(APP_PORT "3000")

configure_file(
  ${CMAKE_CURRENT_SOURCE_DIR}/Dockerfile.in
  ${CMAKE_CURRENT_BINARY_DIR}/Dockerfile
  @ONLY
)
FROM debian:trixie-slim
RUN --mount=type=secret,id=compose_file cat /run/secrets/compose_file > /secret_test_output_dockerfile.txt

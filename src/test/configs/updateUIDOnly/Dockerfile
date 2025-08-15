FROM debian:latest

ARG LOCAL_GID
RUN groupadd -g $LOCAL_GID bar || true

RUN groupadd -g 4321 foo
RUN useradd -m -u 1234 -g 4321 foo

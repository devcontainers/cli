FROM debian:latest

ARG LOCAL_GID
RUN addgroup --gid $LOCAL_GID bar || true

RUN addgroup --gid 4321 foo
RUN adduser --uid 1234 --gid 4321 foo

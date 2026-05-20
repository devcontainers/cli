FROM ubuntu:20.04
RUN apt-get update && apt-get install -y nodejs
RUN apt-get update && apt-get install -y python3
RUN apt-get update && apt-get install -y curl wget
ENV APP_ENV=development
ENV APP_DEBUG=true
RUN apt-get update && apt-get install -y vim
COPY ./test.sh /usr/local/bin/test.sh

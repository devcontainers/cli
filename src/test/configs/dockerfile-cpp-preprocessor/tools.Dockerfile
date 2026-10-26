RUN apt-get update && apt-get install -y vim
COPY ./test.sh /usr/local/bin/test.sh
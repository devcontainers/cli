RUN apt-get update && apt-get install -y vim
COPY ./bootstrap.sh /usr/local/bin/bootstrap.sh

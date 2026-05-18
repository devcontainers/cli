RUN apt-get update && apt-get install -y curl wget

ENV APP_ENV=development
ENV APP_DEBUG=true
# Use a basic image
FROM ubuntu:20.04

# Install required utilities
RUN apt-get update && apt-get install -y curl

# Use the secret and set the environment variable
RUN --mount=type=secret,id=some-secret \
    echo "The secret is $SOME_SECRET" > /output.txt
RUN export SOME_SECRET=$(cat /secret.txt) && \
    echo "The secret is $SOME_SECRET" > /output.txt && \
    echo "SOME_SECRET=$SOME_SECRET" >> /etc/environment

	# Copy the rest of the application
COPY . /app

# Set the working directory
WORKDIR /app

# Expose port for application
EXPOSE 80

# Start the application (e.g., a simple HTTP server)
CMD ["python3", "-m", "http.server", "80"]

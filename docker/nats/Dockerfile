FROM nats:2.11.0-alpine

RUN apk add --no-cache curl

# Copy custom config
COPY nats-server.conf /etc/nats/nats-server.conf

# Expose the default ports
EXPOSE 4222 8222 6222

# Run NATS with JetStream using custom config
CMD ["-c", "/etc/nats/nats-server.conf"]

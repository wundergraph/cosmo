FROM nats:2.11.0-alpine

RUN apk add --no-cache curl

# Copy custom config

COPY nats-entrypoint.sh /bin/nats-entrypoint.sh
COPY nats-server.conf /etc/nats/nats-server.conf
COPY auth/ /etc/nats/auth

# Expose the default ports
EXPOSE 4222 8222 6222

# Run NATS with JetStream using custom config
ENTRYPOINT [ "/bin/sh", "/bin/nats-entrypoint.sh" ]
CMD []

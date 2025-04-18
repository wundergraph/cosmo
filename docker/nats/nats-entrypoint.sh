#!/bin/sh

conf_file="auth/${NATS_AUTH}.conf"
if [ -f "/etc/nats/$conf_file" ]; then
    echo "include $conf_file" >> /etc/nats/nats-server.conf;
fi

exec nats-server -c /etc/nats/nats-server.conf

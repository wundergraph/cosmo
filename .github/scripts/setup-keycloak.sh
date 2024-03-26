#!/bin/bash

export KC_VERSION=22.0.4
curl -LO  https://github.com/keycloak/keycloak/releases/download/"${KC_VERSION}"/keycloak-"${KC_VERSION}".zip

unzip keycloak-${KC_VERSION}.zip

cd keycloak-${KC_VERSION}

KEYCLOAK_ADMIN=admin KEYCLOAK_ADMIN_PASSWORD=admin ./bin/kc.sh start-dev

export KCADM="./bin/kcadm.sh"
export HOST_FOR_KCADM=localhost

$KCADM config credentials --server http://$HOST_FOR_KCADM:8080 --user admin --password admin --realm master

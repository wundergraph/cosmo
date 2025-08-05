#!/bin/bash

export KC_VERSION=26.2.5
curl -LO  https://github.com/keycloak/keycloak/releases/download/"${KC_VERSION}"/keycloak-"${KC_VERSION}".zip

unzip -q keycloak-${KC_VERSION}.zip

cd keycloak-${KC_VERSION}

KEYCLOAK_ADMIN=admin KEYCLOAK_ADMIN_PASSWORD=changeme ./bin/kc.sh start-dev
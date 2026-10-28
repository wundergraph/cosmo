ARG KEYCLOAK_VERSION=26.7.5

FROM --platform=${BUILDPLATFORM} node:22.23.4-bookworm AS themebuilder

RUN apt-get update && apt-get install -y --no-install-recommends openjdk-17-jdk-headless maven && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY ./theme/package*.json .

RUN npm ci

COPY ./theme .

RUN ./build.sh

FROM quay.io/keycloak/keycloak:${KEYCLOAK_VERSION} AS builder

ENV KC_DB=postgres
ENV KC_METRICS_ENABLED=true
ENV KC_HEALTH_ENABLED=true
ENV KC_HTTP_RELATIVE_PATH="/"

WORKDIR /opt/keycloak

COPY --from=themebuilder /app/target/*.jar /opt/keycloak/providers/

# Prebuild keycloak for using with postgres for faster startup
# The features needs to be kept in sync with the keycloak features in helm chart and docker compose
# Needs to be done after copying the providers
RUN /opt/keycloak/bin/kc.sh build

FROM quay.io/keycloak/keycloak:${KEYCLOAK_VERSION}

COPY --from=builder /opt/keycloak/ /opt/keycloak/

EXPOSE 8080
EXPOSE 8443

ENV KC_DB=postgres
ENV KC_METRICS_ENABLED=true
ENV KC_HEALTH_ENABLED=true
ENV KC_HTTP_RELATIVE_PATH="/"

ENTRYPOINT ["/opt/keycloak/bin/kc.sh"]

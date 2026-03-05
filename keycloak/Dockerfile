ARG KEYCLOAK_VERSION=26.2.5

FROM --platform=${BUILDPLATFORM} timbru31/java-node:17-jdk-22 AS themebuilder

WORKDIR /app

COPY ./theme/package*.json .

RUN npm ci

RUN apt-get update && apt-get install -y maven && apt-get clean

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

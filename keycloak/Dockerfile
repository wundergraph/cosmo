LABEL org.opencontainers.image.source="https://github.com/wundergraph/cosmo"
LABEL org.opencontainers.image.description="Cosmo Keycloak Distribution"
LABEL org.opencontainers.image.licenses="Apache-2.0"

FROM --platform=${BUILDPLATFORM} timbru31/java-node:11-jdk-18

WORKDIR /app

COPY ./theme/package*.json .

RUN npm ci

RUN apt-get update && apt-get install -y maven && apt-get clean

COPY ./theme .

RUN ./build.sh

FROM --platform=${BUILDPLATFORM} bitnami/keycloak:22.0.5

COPY --from=0 /app/target/*.jar /opt/bitnami/keycloak/providers/

EXPOSE 8080
EXPOSE 8443
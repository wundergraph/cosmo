FROM --platform=${BUILDPLATFORM} timbru31/java-node:11-jdk-18

WORKDIR /app

COPY ./theme/package*.json .

RUN npm ci

RUN apt-get update && apt-get install -y maven && apt-get clean

COPY ./theme .

RUN ./build.sh

FROM --platform=${BUILDPLATFORM} bitnamilegacy/keycloak:25.0.2

COPY --from=0 /app/target/*.jar /opt/bitnami/keycloak/providers/

# Prebuild keycloak for using with postgres for faster startup
# The features needs to be kept in sync with the keycloak features in helm chart and docker compose
# Needs to be done after copying the providers
RUN /opt/bitnami/keycloak/bin/kc.sh build --db=postgres --metrics-enabled true --health-enabled true --http-relative-path "/"

EXPOSE 8080
EXPOSE 8443
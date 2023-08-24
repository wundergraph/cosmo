FROM timbru31/java-node:11-jdk-18

WORKDIR /app

COPY ./theme/package*.json .

RUN npm ci

RUN apt-get update && apt-get install -y maven && apt-get clean

COPY ./theme .

RUN ./build.sh

FROM quay.io/keycloak/keycloak:22.0

COPY --from=0 /app/target/*.jar /opt/keycloak/providers/

EXPOSE 8080
EXPOSE 8443

ENTRYPOINT ["/opt/keycloak/bin/kc.sh"]
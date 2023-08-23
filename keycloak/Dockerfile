FROM quay.io/keycloak/keycloak:22.0

COPY ./theme/target/*.jar /opt/keycloak/providers/

EXPOSE 8080
EXPOSE 8443

ENTRYPOINT ["/opt/keycloak/bin/kc.sh"]
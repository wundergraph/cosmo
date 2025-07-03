#!/bin/bash

# https://stackoverflow.com/a/14203146
for i in "$@"; do
  case $1 in
    --realm=*)
      export KC_REALM="${i#*=}"
      shift
      ;;
    --login-realm=*)
      export KC_LOGIN_REALM="${i#*=}"
      shift
      ;;
    --admin-user=*)
      export KC_ADMIN_USER="${i#*=}"
      shift
      ;;
    --admin-pass=*)
      export KC_ADMIN_PASSWORD="${i#*=}"
      shift
      ;;
    --api-url=*)
      export KC_API_URL="${i#*=}"
      shift
      ;;
    --db-url=*)
      export DB_URL="${i#*=}"
      shift
      ;;
    --db-tls-ca=*)
      export TLS_CA="${i#*=}"
      shift
      ;;
    --db-tls-cert=*)
      export DB_TLS_CERT="${i#*=}"
      shift
      ;;
    --db-tls-key=*)
      export DB_TLS_KEY="${i#*=}"
      shift
      ;;
    -*|--*)
      shift
      ;;
    *)
      ;;
  esac
done

cd ../../../controlplane
pnpm tsx src/bin/migrate-groups.ts
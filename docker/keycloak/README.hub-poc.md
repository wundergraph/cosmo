# Shared sign-in for Cosmo and Hub (POC realm)

`realm.hub-poc.json` is `realm.json` with the changes that let one `wgc auth login` sign into both Cosmo and Hub. `realm.json` and the default dev setup stay as they are.

The POC realm differs from `realm.json` in four ways:

- It adds a confidential `hub` client for Hub's web app and backend. Its secret comes from `HUB_KEYCLOAK_CLIENT_SECRET` and its redirect URL from `HUB_WEB_URL`.
- An audience mapper on `cosmo-cli` and `hub` puts `hub` in the access token's `aud`, so Hub accepts the token `wgc` gets. Cosmo's control plane checks tokens through Keycloak's userinfo endpoint, which ignores `aud`, so Cosmo keeps accepting it.
- It adds a Google identity provider restricted to the `wundergraph.com` hosted domain. Its client id and secret come from `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.
- Registration, password reset and password login are off. The browser flows send every sign-in to Google, and `cosmo-cli` and `studio` no longer allow the password grant.

Seeded users with passwords can no longer sign in.

Generate the file again after `realm.json` changes:

```bash
node docker/keycloak/build-hub-poc-realm.mjs
```

## Docker Compose

Create a Google OAuth client (Web application) with the redirect URL `http://localhost:8080/realms/cosmo/broker/google/endpoint`, then start Keycloak with the POC realm:

```bash
export GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=...
docker compose -f docker-compose.yml -f docker-compose.hub-poc.yml --profile dev up -d keycloak
```

Keycloak imports a realm only when it does not exist yet. If the `cosmo` realm is already in the Keycloak database, delete it in the admin console (or drop the database volume) before starting.

## Helm

`helm/values-hub-poc.yaml` mounts the POC realm from a ConfigMap and passes the Google credentials from a secret. The commands are at the top of that file.

## Using it

Point Hub at the same realm (`KEYCLOAK_REALM=cosmo`, `KEYCLOAK_CLIENT_ID=hub`, `KEYCLOAK_CLIENT_SECRET=$HUB_KEYCLOAK_CLIENT_SECRET`), then sign in once:

```bash
KC_API_URL=http://localhost:8080 HUB_URL=http://localhost:4000 wgc auth login
wgc auth whoami
```

`wgc auth login` ends with a `Hub (...)` line that says whether the token's audience is accepted by Hub. `wgc auth whoami` prints the same check as `Hub Audience`.

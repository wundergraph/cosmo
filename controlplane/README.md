# Controlplane

The control plane is the central component of the cosmo platform. It consists of an admin API and an node API. The admin API is used by the cosmo CLI tool and the `Studio` to manage the platform. The node API is used by the `Router` nodes to register themselves and to receive config updates. It also manage the ingestion of metrics and tracing data.

# Getting started

Run the command below and replace all values in `.env` with the correct values.

```bash
mv .env.example .env
```

# Development

Run the controlplane in watch mode:

```shell
pnpm dev
```

# ESM

We use Node.js in ESM mode. This means that we can use `import` instead of `require` at runtime. However, it also means that we have to use `.js` as file extension to import files.
For more information, see [ESM Node.js](https://www.typescriptlang.org/docs/handbook/esm-node.html).

# Migrations

Migrations are run automatically on start.

# Stack

We use [Connect](https://connect.build/) to build the APIs of the Controlplane. Connect is framework build on top of [gRPC](https://grpc.io/) and simplify code-generation and reuse between `Studio` -> `Controlplane` <- `Router`.

## Example

```bash
curl \
    --header 'Content-Type: application/json' \
    --data '{"sentence": "I feel happy."}' \
    http://localhost:3001/wg.cosmo.controlplane.admin.v1.ElizaService/Say

{"sentence":"You said: I feel happy."}
```

# Seed first organization

At `make infra-up` we will import the `cosmo` realm. Unfortunately, we can't import users. Therefore, we have to run the following command to create a user:

```bash
# Run the controlplane and trigger migrations
pnpm dev
# Seed the first organization
pnpm seed
```

This will create a user with the following credentials:

- Email: `foo@wundergraph.com`
- Password: `bar`

# Keycloak configuration

- `SSO Session Idle / SSO Session Max` Set to 1 day.
- `Access Token Lifespan` Set to 8 hours.

## Session management

A user session "cookie" is valid for 1 day. The refresh token has the same lifespan of 1 day. The access token is valid for 8 hours.
That implies that the user can interact with the app for 1 day until the refresh token is expired. The user can renew the session by calling the session endpoint `/v1/auth/session`.
The session endpoint will refresh the access and refresh token and update the session cookie. The user can interact with the app for another day.

__Summary: If the frontend ensure that the session endpoint `/v1/auth/session` is called on focus and load. The user might never be logged out again.__
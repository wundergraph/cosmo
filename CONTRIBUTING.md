# Contributing to the WunderGraph Cosmo Repository

Before contributing to the WunderGraph Cosmo repository, please open an issue to discuss the changes you would like to make. Alternatively, you can also open a discussion in the [WunderGraph Discussions](https://github.com/wundergraph/cosmo/discussions).
We are open to all kinds of contributions, including bug fixes, new features, and documentation improvements.

The following sections provide a guide on how to contribute to the WunderGraph Cosmo repository.

## Prerequisites

This guide assumes you have already installed the following software:

- make (should be installed on all Linux / MacOS systems)
- [golang](https://go.dev/dl/) `>= 1.25`
- [pnpm](https://pnpm.io/installation) >= 9
- Node.js [LTS](https://nodejs.org/en/about/releases/). You can also pnpm to [install](https://pnpm.io/cli/env) Node.js.
- [docker desktop](https://docs.docker.com/desktop/) (includes: engine, buildkit & compose) **or**:
- [docker engine](https://docs.docker.com/engine/) with:
  - [docker buildkit](https://docs.docker.com/build/buildkit/), with optionally: [docker buildx plugin](https://docs.docker.com/build/install-buildx/)
  - [docker compose plugin](https://docs.docker.com/compose/install/#scenario-two-install-the-compose-plugin)

## Monorepo

NPM packages are managed as a [pnpm workspace](https://pnpm.io/workspaces). This means during development all dependencies are linked.
The root [`package.json`](package.json) provides all scripts you need to orchestrate the development workflow.

### Bootstrap the development environment

Most of the project have a `.env.example` file. Replace `.env.example` with `.env` and fill in the required values.

### Bootstrap the repository

You can bootstrap the repository with the following command:

```bash
make
```

Ready! You can now start contributing to the WunderGraph Cosmo repository. Feel free to open an issue or pull request to add a new feature or fix a bug.

## Go workspace

According to best practices, we don't commit the `go.work` or `go.work.sum` files. Those files are personal to each developer. As a result, we use the `go.mod` file to manage the dependencies and overwrites. You can still create `go.work` file in the root of the repository if you are feeling more comfortable with it or to improve tooling support.

### Example

```
go 1.25

use (
	./demo
	./router
	./router-tests
)

// Here you can add custom replacements
```

## Conventional Commit Standard

We use [conventionalcommits](https://www.conventionalcommits.org/en/v1.0.0-beta.2/#why-use-conventional-commits) for changelog generation and more structured commit messages.

In order to enforce this standard we use a linter on pre-commit hook. This functionality is provided by [husky](https://typicode.github.io/husky/#/).
In some setup, you have to tell husky where to find your package manager or binaries. Here is the file `.huskyrc` you have to put in your user home directory.

```bash
export NVM_DIR=/home/starptech/.nvm
[ -s /home/starptech/.nvm/nvm.sh ] && \. /home/starptech/.nvm/nvm.sh  # This loads nvm

# golang
export PATH=$PATH:/usr/local/go/bin
export PATH="$PATH:$(go env GOPATH)/bin"
```

### For JetBrains users

[This](https://plugins.jetbrains.com/plugin/13389-conventional-commit) plugins simplifies the commit message creation process.

### Pull Requests Conventions

We merge all pull requests in `squash merge` mode. You're not enforced to use [conventional commit standard](https://www.conventionalcommits.org/en/v1.0.0-beta.2/#why-use-conventional-commits) across all your commits, but it's a good practice and increase transparency. At the end it's important that the squashed commit message follow the standard.

## Local Development

### Prerequisites

- [Docker](https://docs.docker.com/get-docker/)
- [Docker Compose V2](https://docs.docker.com/compose/install/)
- [NodeJS LTS](https://nodejs.org/en/download/)
- [PNPM 9+](https://pnpm.io/installation)
- [Go 1.25+](https://golang.org/doc/install)
- [wgc](https://www.npmjs.com/package/wgc)
- .env/.env.local (see below)

All services work with environment variables. You can find the default values in the `.env.example` file.
Please copy the variables to `.env` (the same for studio but with `.env.local`) and adjust the values to your needs.

```shell
# In the root directory (cosmo/)
# Copy controlplane environment file
cp controlplane/.env.example controlplane/.env

# Copy studio environment file
cp studio/.env.local.example studio/.env.local

# Copy cli environment file
cp cli/.env.example cli/.env

# Copy router environment file
cp router/.env.example router/.env
```

Bootstrapping Cosmo for local development is easy. Just run the following commands in order:

```shell
# In the root directory (cosmo/)
# 1️⃣ Setup the repository, build libraries and start all services (Wait a few seconds until Keycloak is ready)
# You can check whether Keycloak is running by going to localhost:8080. It should show sign-in page
make

# 2️⃣ Run migrations and seed the database
make migrate && make seed

# 3️⃣ Start the control plane
make start-cp

# 4️⃣ Create the demo and copy the JWT printed at the bottom
make create-demo

# 5️⃣ Start the subgraphs
OTEL_AUTH_TOKEN=<jwt-token> make dc-subgraphs-demo

# 6️⃣ Put the JWT from the previous step into the router/.env as GRAPH_API_TOKEN and start the router
make start-router

# ✨ Finally, Start the studio (http://localhost:3000) and explore the Cosmo platform
make start-studio
```

Navigate to [http://localhost:3000/](http://localhost:3000/) and login with the default credentials:

```
Username: foo@wundergraph.com
Password: wunder@123
```

Navigate to the cli directory and replace `.env.example` with `.env`. After that you can run commands against your local Cosmo instance.

```shell
cd cli && pnpm wgc -h
```

_Clean up all containers and volumes by running `make infra-down-v`. You can repeat the steps above to bootstrap the platform again._

### Docker Compose

We manage multiple compose files:

- `docker-compose.yml`: The default compose file. It contains all services that are required to run the platform for development.
- `docker-compose.full.yml`: This compose file contains the full Cosmo platform. It is used for demo and testing.
- `docker-compose.cosmo.yml`: This compose file allows to build all Cosmo components and manage them in a single compose file. It is used for testing and releasing.

**Clean up a compose stack before starting another one!**

### Compose Profiles Overview

#### `dev` Profile

The `dev` profile is the primary profile used to set up the required infrastructure containers for the local demo environment. The setup and teardown processes are managed through the following Make targets:

- **`infra-up`**: Starts the infrastructure containers.
- **`infra-down`**: Stops and removes the infrastructure containers.
- **`infra-down-v`**: Stops and removes the infrastructure containers and volumes.

#### `debug` Profile

The `debug` profile provides additional containers to facilitate local debugging, particularly when working with the Cosmo Router. These containers include tools such as:

- **Prometheus**
- **Jaeger**
- **Grafana**

The setup and teardown of the debug-specific services are handled through the following Make targets:

- **`infra-debug-up`**: Starts the debugging containers.
- **`infra-debug-down`**: Stops and removes the debugging containers.
- **`infra-debug-down-v`**: Stops and removes the debugging containers and volumes.

#### Usage

1. Use the `dev` profile to set up the core infrastructure required for the local demo.
2. Optionally, use the `debug` profile to enable additional debugging tools.

These profiles can be managed independently or in conjunction, depending on your local development and debugging requirements.
**NOTE:** The `debug` profile is not required for the core functionality of the Cosmo platform, but you need to have the infrastructure containers running to use the debugging tools.

### Grafana

Grafana is available at [http://localhost:9300](http://localhost:9300) with the default credentials:

```
Username: admin
Password: admin
```

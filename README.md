<p align="center">
<img width="350" src="./docs/assets/logo.png"/>
</p>

<div align="center">
<h5>WunderGraph Cosmo - The GraphQL federation platform</h5>
<h6><i>Reach for the stars, ignite your cosmo!</i></h6>
<img alt="CLI CI" src="https://github.com/wundergraph/cosmo/actions/workflows/cli-ci.yaml/badge.svg">
<img alt="Controlplane CI" src="https://github.com/wundergraph/cosmo/actions/workflows/controlplane-ci.yaml/badge.svg">
<img alt="Studio CI" src="https://github.com/wundergraph/cosmo/actions/workflows/studio-ci.yaml/badge.svg">
<img alt="Router CI" src="https://github.com/wundergraph/cosmo/actions/workflows/router-ci.yaml/badge.svg"/>
<hr />
</div>

<br/>

WunderGraph Cosmo is the On-Premise Platform for building, maintaining, and collaborating on GraphQL Federation. A drop-in replacement for Apollo GraphOS.
The repository consists of the following components:

- [CLI](./cli): The cosmo CLI tool `wgc`. Used to manage the cosmo platform e.g. pushing schema, check schemas, creating new projects, managing users, etc. It interacts with the control plane.
- [Control-Plane](./control-plane): The control plane is the central component of the cosmo platform. It consists of a platform API and a node API. The platform API is used by the cosmo `CLI` tool and the `Studio` to manage the platform.
- [Router](./router): The router is the component that understands the GraphQL Federation protocol. It is responsible for routing requests to the correct service and for aggregating the responses. It is in connection with the control plane to register itself for advanced fleet management.
- [Studio](./studio): The studio is the web interface for the cosmo platform. It is used to manage the platform and to collaborate on GraphQL Federation. It is in connection with the control plane through the Platform API to manage the platform.

## Getting Started

### Prerequisites

- [Docker](https://docs.docker.com/get-docker/)
- [Docker Compose](https://docs.docker.com/compose/install/)

Running cosmo is as easy as running a single command:

```shell
make full-demo-up
```

It can take a few seconds (~30s) until all services are up and running. A seed container will create a default user for you.

2. Now, you can create a small demo project and start the router and subgraphs:

```shell
# Create the demo project
make create-docker-demo

# Copy the Router token from the previous log output
export ROUTER_TOKEN=...

# Start the subgraphs + router
make dc-federation-demo
```

3. Navigate to the [Studio explorer](http://localhost:3001/wundergraph/graph/production/explorer) and query the router. Login with the default credentials:

```
Username: foo@wundergraph.com
Password: bar
```

_Clean up all containers and volumes by running `make full-demo-down`._

## Development

### Prerequisites

- [Docker](https://docs.docker.com/get-docker/)
- [Docker Compose](https://docs.docker.com/compose/install/)
- [NodeJS 18+](https://nodejs.org/en/download/)
- [PNPM 8+](https://pnpm.io/installation)
- [Go 1.20+](https://golang.org/doc/install)

Bootstrapping your development environment is easy. Just run the following commands in order:

```shell
# 1️⃣ Setup the repository and start all services (docker-compose)
make

# 2️⃣ Start the control plane (Will run any pending migrations)
make start-cp

# 3️⃣ Seed the database with the default user (Wait a few seconds until Keycloak is ready)
make seed

# 4️⃣ Create the demo and copy the JWT printed at the bottom
make create-demo

# 5️⃣ Start the subgraphs
OTEL_AUTH_TOKEN=<jwt-token> make dc-subgraphs-demo

# 6️⃣ Put the JWT from the previous step into the router/.env as GRAPH_API_TOKEN and start the router
make start-router

# 7️⃣ Start the studio (http://localhost:3000)
make start-studio
```

Navigate to [http://localhost:3000/](http://localhost:3000/) and login with the default credentials:

```
Username: foo@wundergraph.com
Password: bar
```

Your API key to access the platform is: `cosmo_669b576aaadc10ee1ae81d9193425705`. Set the following environment variable to use it with the CLI:

```shell
export COSMO_API_KEY=cosmo_669b576aaadc10ee1ae81d9193425705
export COSMO_API_URL=http://localhost:3001

cd cli && pnpm wgc -h
```

All services work with environment variables. You can find the default values in the `.env.example` file. Please copy it to `.env`  (Except studio which works with `.env.local`) and adjust the values to your needs.

_Clean up all containers and volumes by running `make infra-down-v`._

### Docker Compose

We manage multiple compose files:

- `docker-compose.yml`: The default compose file. It contains all services that are required to run the platform for development.
- `docker-compose.full.yml`: This compose file contains the full Cosmo platform. It is used for demo and testing.
- `docker-compose.cosmo.yml`: This compose file allows to build all cosmo components and manage them in a single compose file. It is used for testing and releasing.

## On-Premise

Cosmo was designed to be deployed on-premise e.g. Kubernetes. We provide a helm chart to deploy the platform on any Kubernetes like AKS, GKE, AKS or Minikube. You can find the helm chart in the [helm](./helm) directory.
If you need help with the deployment, please contact us at [Sales](https://wundergraph.com/contact/sales).

## Managed Service

If you don't want to manage the platform yourself, you can use our managed service [WunderGraph Cosmo Cloud](https://cosmo.wundergraph.com). It is a fully managed platform that don't make you worry about infrastructure, so you can focus on building.
The managed service is currently in private beta. If you want to participate, please contact us at [Sales](https://wundergraph.com/contact/sales).
After contacting us, we will hook you up with a free trial and help you to get started.

## License

Cosmo is licensed under the [Apache License, Version 2.0](LICENSE).

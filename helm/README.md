# Cosmo Helm Chart

[![Helm Deployment](https://github.com/wundergraph/cosmo/actions/workflows/helm-deployment.yaml/badge.svg)](https://github.com/wundergraph/cosmo/actions/workflows/helm-deployment.yaml)

> [!TIP]
> As part of an enterprise subscription, we provide exclusive documentation on how to effectively operate and run WunderGraph Cosmo on all common container platforms such as EKS, GKE, AKS, Fargate, and Google Cloud Run. This includes migration support and configuration guidance. Don't spend time tinkering with its internals; let us do the heavy lifting for you.
> [Contact us](https://wundergraph.com/contact/sales) for more information.

## Getting started for local development

### Prerequisites

- A running Kubernetes cluster, with PV provisioner support + ingress controller
  - [Minikube](https://minikube.sigs.k8s.io/docs/start/)
    - Requires enabling `minikube addons enable ingress`
- [Helm 3.2.0+](https://helm.sh/docs/intro/install/) installed locally
- [Kapp](https://carvel.dev/kapp/docs/latest/install/) installed locally
- [Kubectl](https://kubernetes.io/docs/tasks/tools/) installed locally

### Install helm dependencies

```shell
# Add bitnami repo to install dependencies like postgresql, keycloak and clickhouse
helm repo add bitnami https://charts.bitnami.com/bitnami
# Install the helm dependencies (Only needed once)
helm repo add bitnami https://charts.bitnami.com/bitnami && \
helm dependency build ./cosmo
```

### Install the Helm chart locally

Ensure you have selected the right Kubernetes cluster with:

```shell
kubectl cluster-info
```

#### 1. Create cluster

```shell
minikube start
```

#### 2. Enable ingress addon

```shell
minikube addons enable ingress
```

#### 3. Getting container images built

For local development we're assuming you are building the container images locally rather than consuming the released versions from the container repository.

If you are running the kubernetes instances locally:

```shell
make docker-build-minikube # If you're running k8s on the same CPU architecture as locally
                           # If your cluster runs on a linux/amd64 architecture please update the Makefile accordingly
```

**Important**: You have to set `image.version` in `values.yaml` for each service to use the locally built images. By default, a chart always tries to pin to the latest compatible version of the image.

#### 4. Install the Helm chart

For development, we recommend installing the Helm chart with Kapp the following command:

```shell
make deploy
```

The provisioning will take a few seconds to bootstrap the whole cluster and seed the database with a default user and organization.

#### Migrations

We run several Kubernetes jobs to run migrations. While we provide Helm hook support to run migrations, we recommend to use Kapp because it is more powerful in coordinating the deployment.

#### 3. Make ingress available locally

##### Linux

Minikube will automatically expose the ingress controller on your local machine. You can get the IP with `minikube ip`.
Now, add the following entries to your `/etc/hosts` file and replace the IP with the IP you get from the previous step.

```
192.168.49.2 studio.wundergraph.local
192.168.49.2 controlplane.wundergraph.local
192.168.49.2 router.wundergraph.local
192.168.49.2 keycloak.wundergraph.local
192.168.49.2 otelcollector.wundergraph.local
192.168.49.2 graphqlmetrics.wundergraph.local
192.168.49.2 cdn.wundergraph.local
```

##### macOS

Minikube needs to set up a tunnel to expose the ingress controller in your local machine. Add the following
entries to `/etc/hosts`:

```
127.0.0.1 studio.wundergraph.local
127.0.0.1 controlplane.wundergraph.local
127.0.0.1 router.wundergraph.local
127.0.0.1 keycloak.wundergraph.local
127.0.0.1 otelcollector.wundergraph.local
127.0.0.1 graphqlmetrics.wundergraph.local
127.0.0.1 cdn.wundergraph.local
```

Then start `minikube tunnel` and leave it running. It might ask for your root password in order to open
the tunnel on privileged ports.

#### 4. Access the Cosmo Studio

Open [http://studio.wundergraph.local](http://studio.wundergraph.local) in your browser and login with the default credentials:

```
Username: foo@wundergraph.com
Password: wunder@123
```

#### 6. Use the Cosmo CLI

In the `global.seed.apiKey` of your `values.yaml` we defined your API key. You can use this API key to authenticate with the Cosmo CLI.

```sh
export COSMO_API_KEY="cosmo_669b576aaadc10ee1ae81d9193425705"
export COSMO_API_URL="http://controlplane.wundergraph.local"
npx wgc -h
```

## Minikube

Enable ingress addon before deploying the Helm chart:

```shell
minikube addons enable ingress
```

## Update the auto-generated documentation

```shell
make docs
```

# Cosmo Helm Chart

## Getting started for local development

### Prerequisites
- A running Kubernetes cluster, with PV provisioner support + ingress controller
    - [Minikube](https://minikube.sigs.k8s.io/docs/start/)
      - Requires enabling `minikube addons enable ingress`
- [Helm 3.2.0+](https://helm.sh/docs/intro/install/) installed locally
- [Kapp](https://get-kapp.io/) installed locally
- [Kubectl](https://kubernetes.io/docs/tasks/tools/) installed locally

### Install helm dependencies

```shell
# Install the helm dependencies (Only needed once)
helm dependency build ./cosmo
```

### Install the Helm chart locally

Ensure you have selected the right Kubernetes cluster with:

```shell
kubectl cluster-info
```

#### 1. Getting container images built
For local development we're assuming you are building the container images locally rather than consuming the released versions from the container repository.

If you are running the kubernetes instances locally:
```shell
make docker-build-minikube # If you're running k8s on the same CPU architecture as locally
                           # If your cluster runs on a linux/amd64 architecture please update the Makefile accordingly
```

#### 2. Install the Helm chart

For development, we recommend installing the Helm chart with Kapp the following command:

```shell
make dev
```

The provisioning will take a few seconds to bootstrap the whole cluster and seed the database with a default user and organization.

#### Migrations

We run several Kubernetes jobs to run migrations. While we provide Helm hook support to run migrations, we recommend to use Kapp because it is more powerful in coordinating the deployment.

#### 3. Make ingress available locally

Minikube will automatically expose the ingress controller on your local machine. You can get the IP with `minikube ip`.
Now, add the following entries to your `/etc/hosts` file and replace the IP with the IP you get from the previous step.

```
192.168.49.2 studio.wundergraph.local
192.168.49.2 controlplane.wundergraph.local
192.168.49.2 router.wundergraph.local
192.168.49.2 keycloak.wundergraph.local
192.168.49.2 otelcollector.wundergraph.local
192.168.49.2 graphqlmetrics.wundergraph.local
```

#### 4. Access the Cosmo Studio

Open [http://studio.local](http://studio.local) in your browser and login with the default credentials:

```
Username: foo@wundergraph.com
Password: bar
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
# Cosmo Helm Chart

Navigating the stars with the Cosmo Helm Chart. This chart is a collection of subcharts that make up the Cosmo stack.
You can use it to deploy a fully functional Cosmo stack for development or production use.

> [!TIP]
> As part of an enterprise subscription, we provide exclusive documentation on how to effectively operate and run WunderGraph Cosmo on all common container platforms such as EKS, GKE, AKS, Fargate, and Google Cloud Run. This includes migration support and configuration guidance. Don't spend time tinkering with its internals; let us do the heavy lifting for you.
> [Contact us](https://wundergraph.com/contact/sales) for more information.

## Getting started

### Prerequisites

- A running Kubernetes cluster, with support for:
  - PersistentVolume (only development)
  - Ingress Controller
- [Helm 3.2.0+](https://helm.sh/docs/intro/install/) installed locally

### Configuring the stack

The Cosmo Helm chart gives you a lot of freedom to configure the stack to suit your needs.
Helm offers two primary ways to configure your stack, statically by passing a `values.yaml` file or dynamically by offering input via the CLI.

For your convenience, we provide a working configuration preset [`values.yaml`](values.yaml). It includes all subcharts, including Clickhouse, PostgreSQL and Keycloak. Intended for development use only. Before you deploy the stack to production, you should create your own secrets.

To create a release, run:

```shell
# Add bitnami repo to install dependencies like postgresql, keycloak and clickhouse
helm repo add bitnami https://charts.bitnami.com/bitnami
# Install the helm dependencies
helm dependency build
# Install the helm chart with the release name "cosmo" in the default namespace, the name is important it used to reference services in values file.
# --atomic ensures that the release is rolled back if it fails to install
helm install cosmo --atomic -f values.yaml .
```

### Run Helm Tests

The Helm chart comes with a set of tests that you can run to ensure that the stack is working as expected.
Modify the `values.yaml` file to enable the tests:

```yaml
global:
  helmTests:
    enabled: true
```

and run:

```shell
helm test cosmo
```

you should see the following output after a few seconds:

```shell
❯ helm test cosmo
NAME: cosmo cosmo
LAST DEPLOYED: Tue Nov 21 22:50:40 2023
NAMESPACE: default
STATUS: deployed
REVISION: 2
TEST SUITE:     cosmo-controlplane-test-connection
Last Started:   Tue Nov 21 22:51:07 2023
Last Completed: Tue Nov 21 22:51:10 2023
Phase:          Succeeded
TEST SUITE:     cosmo-graphqlmetrics-test-connection
Last Started:   Tue Nov 21 22:51:10 2023
Last Completed: Tue Nov 21 22:51:14 2023
Phase:          Succeeded
TEST SUITE:     cosmo-otelcollector-test-connection
Last Started:   Tue Nov 21 22:51:14 2023
Last Completed: Tue Nov 21 22:51:18 2023
Phase:          Succeeded
TEST SUITE:     cosmo-studio-test-connection
Last Started:   Tue Nov 21 22:51:18 2023
Last Completed: Tue Nov 21 22:51:22 2023
Phase:          Succeeded
```

### Removing stack after use

In order to prevent any costs, you can remove the stack after use with:

```shell
helm uninstall cosmo
```

> [!CAUTION]
> Volumes might not be automatically removed, so you may need to manually remove them with `kubectl delete pvc -l release=my-release`

## Production use

We **_strongly recommend_** that if you want to ship this helm chart to production you either:

- Use a hosted version of Clickhouse ([Clickhouse Cloud](https://clickhouse.com/)), PostgreSQL ([Aiven.io](https://aiven.io/postgresql)), Redis ([Aiven.io](https://aiven.io/redis)), Keycloak ([Cloud-IAM](https://www.cloud-iam.com/)), Minio ([Minio Cloud](https://min.io/)) or any other S3 compatible storage provider.
- Use a dedicated [Clickhouse](https://github.com/Altinity/clickhouse-operator), [Postgres](https://github.com/zalando/postgres-operator),[Redis](https://artifacthub.io/packages/helm/bitnami/redis), [Keycloak](https://www.keycloak.org/operator/installation), [Minio](https://github.com/minio/operator) Kubernetes operator of your choice.
- Use [WunderGraph Cosmo Cloud](https://cosmo.wundergraph.com/login) ✨

## Configuration and installation details

By default, the chart deploys a ready to use Cosmo stack with a development configuration of Clickhouse, PostgreSQL, Redis, Keycloak and Minio.
The studio, controlplane, router and collectors are exposed via ingress. Don't forget to update the public URL in the `values.yaml` file as well.
All secrets are stored in the `values.yaml` file. You should replace them with your own secrets before deploying the stack to your cluster.

## Seed your organization and account

The seed is a special component that is used to seed your organization and admin account. It is only needed once and can be disabled after the initial setup. This user allows you to invite people or configure SSO. Ensure that your postgres and keycloak are running before you enable the seed to avoid any issues.
Update the `global.seed` values in the `values.yaml` file accordingly and run:

```shell
helm upgrade cosmo ./cosmo \
  --set global.seed.enabled=true
```

### Enable S3 storage

The default preset [`values.yaml`](values.yaml) comes with a Minio instance that is used to store your persistent operations and router state. For production use, we recommend using a hosted version of Minio or any other S3 compatible storage provider.
You need to update the `values.yaml` file accordingly:

```yaml
controlplane:
  configuration:
    s3StorageUrl: 'http://minio:changeme@cosmo-minio:9000/cosmo'
```

### CLI Key

In the `global.seed.apiKey` of your `values.yaml` we defined your API key. You can use this API key to authenticate with the Cosmo CLI.

```sh
export COSMO_API_KEY="cosmo_669b576aaadc10ee1ae81d9193425705"
export COSMO_API_URL="http://<your-public-controlplane-url>"
npx wgc -h
```

### Router

The router is not enabled by default because it requires an API token to be set and a published federated graph. After you have created an API token with the Cosmo CLI `wgc router token create <token-name> -g <graph-name> -n <namespace>`, set the right configurations in the `values.yaml` file.

```yaml
router:
  configuration:
    graphApiToken: '<changeme>'
```

Run `helm upgrade cosmo -f values.yaml .` to apply the changes.

## Kapp support

The Helm chart is also compatible with [Kapp](https://get-kapp.io/). Kapp is an alternative way to manage Kubernetes resources. We make use of [Versioned Resources](https://carvel.dev/kapp/docs/v0.58.x/diff/#versioned-resources) to ensure that your Pod is restarted when your config changes.
We also make use of [Apply Ordering](https://carvel.dev/kapp/docs/v0.58.x/apply-ordering/) to avoid unnecessary restarts of your Pods when the dependencies are not ready yet.

You can render the Helm chart and manage the stack with Kapp with the following command:

```shell
kapp -y deploy -a cosmo -f <(helm template cosmo ./cosmo \
	  --set global.seed.enabled=true
```

Delete the stack with:

```shell
kapp delete -a cosmo
```

### Tips

It is strongly recommended to use immutable tags in a production environment. This ensures your deployment does not change automatically if the same tag is updated with a different image.
You can use a tool like [kbld](https://get-kbld.io/) to make sure your images are resolved to immutable tags.
WunderGraph will release a new chart updating its containers if a new version of the main container, significant changes, or critical vulnerabilities exist.

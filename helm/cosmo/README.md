# Cosmo Helm Chart

Navigating the stars with the Cosmo Helm Chart. This chart is a collection of subcharts that make up the Cosmo stack.
You can use it to deploy a fully functional Cosmo stack for development or production use.

## Getting started

### Prerequisites

- A running Kubernetes cluster, with support for:
    - PersistentVolume (only development)
    - Ingress Controller
- [Helm 3.2.0+](https://helm.sh/docs/intro/install/) installed locally

### Configuring the stack

The Cosmo Helm chart gives you a lot of freedom to configure the stack to suit your needs.
Helm offers two primary ways to configure your stack, statically by passing a `values.yaml` file or dynamically by offering input via the CLI.

For your convenience, we included two different value presets:

1. [`values.full.yaml`](values.full.yaml) - Ready to deploy configuration. Include all subcharts, including Clickhouse, PostgreSQL and Keycloak. Intended for development use only.
2. [`values.yaml`](values.yaml). - Only includes the Cosmo Core components. You need to provide your own Clickhouse, PostgreSQL, Keycloak and update the configuration accordingly. See [`values.full.yaml`](values.full.yaml) for an example.

To apply the changes, run:

```shell
# Add bitnami repo to install dependencies like postgresql, keycloak and clickhouse
helm repo add bitnami https://charts.bitnami.com/bitnami
# Install the helm dependencies
helm dependency build
# Install the helm chart with the release name "cosmo" the name is important it used to reference services in values file.
# --atomic ensures that the release is rolled back if it fails to install
helm install cosmo --atomic -f values.full.yaml .
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

**Volumes might not be automatically removed, so you may need to manually remove them with `kubectl delete pvc -l release=my-release`.**

## Production use

We ***strongly recommend*** that if you want to ship this helm chart to production you either:
- Use a hosted version of Clickhouse ([Clickhouse Cloud](https://clickhouse.com/)), PostgreSQL ([Aiven.io](https://aiven.io/postgresql)), Keycloak ([Cloud-IAM](https://www.cloud-iam.com/))
- Use a dedicated [Clickhouse](https://github.com/Altinity/clickhouse-operator), [Postgres](https://github.com/zalando/postgres-operator), [Keycloak](https://www.keycloak.org/operator/installation) Kubernetes operator of your choice.
- Use [WunderGraph Cosmo Cloud](https://cosmo.wundergraph.com/login) ✨

## Configuration and installation details

By default, the chart deploys a production-grade Cosmo stack **without** Clickhouse, PostgreSQL and Keycloak.
After you have provisioned the databases, you can set the right configuration in the `values.yaml` file and do a `helm upgrade` to apply the changes.
The studio, controlplane, router and collectors are exposed via ingress. Don't forget to update the public URL in the `values.yaml` file as well.

## Seed your organization and account

The seed is a special component that is used to seed your organization and admin account. It is only needed once and can be disabled after the initial setup. This user allows you to invite people or configure SSO. Ensure that your postgres and keycloak are running before you enable the seed to avoid any issues.
Update the `global.seed` values in the `values.yaml` file accordingly and run:

```shell
helm upgrade cosmo ./cosmo \
  --set global.seed.enabled=true
```

### CLI Key

In the `global.seed.apiKey` of your `values.yaml` we defined your API key. You can use this API key to authenticate with the Cosmo CLI.

```sh
export COSMO_API_KEY="cosmo_669b576aaadc10ee1ae81d9193425705"
export COSMO_API_URL="http://<your-public-controlplane-url>"
npx wgc -h
```

### Router
The router is not enabled by default because it requires an API token to be set and a published federated graph. After you have created an API token with the Cosmo CLI `wgc federated-graph create-token <graph-name>`, set the right configurations in the `values.yaml` file.

```yaml
router:
  configuration:
    federatedGraphName: "<graph_name>"
    graphApiToken: "<changeme>"
```

Run `helm install cosmo` to apply the changes.

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
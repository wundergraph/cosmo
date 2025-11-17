# Full Cosmo Helm

This example demonstrates how to run the entire Cosmo platform on Kubernetes with our official Helm chart. For demonstration purposes, we will use Minikube.

### Prerequisites

- A running Kubernetes cluster, with PV provisioner support + ingress controller
    - [Minikube](https://minikube.sigs.k8s.io/docs/start/)
        - Requires enabling `minikube addons enable ingress`
- [Helm 3.2.0+](https://helm.sh/docs/intro/install/) installed locally
- [Kubectl](https://kubernetes.io/docs/tasks/tools/) installed locally

## Getting started

### 1. Install the helm chart with the following command:

```shell
helm install cosmo oci://ghcr.io/wundergraph/cosmo/helm-charts/cosmo --version 0.13.0
```

_Check [Releases](https://github.com/wundergraph/cosmo/releases?q=helm-cosmo&expanded=true) for the latest release of the Cosmo Chart._

### 2. Make the Ingress controller accessible from your local machine.

The following steps depend on your operating system:

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

### 3. Create Federated Graph Demo and Deploy the Router

The following command will create a federated graph consisting of multiple subgraphs and deploy the router to the minikube cluster.

```bash
./create_demo.sh
```

Finally 🚀, navigate to the [Studio Playground](http://studio.wundergraph.local/wundergraph/development/graph/mygraph/playground) and query the router.

Login with the default credentials:

```
Username: foo@wundergraph.com
Password: wunder@123
```

**NOTE**: With recent browsers enforcing [secure contexts](https://w3c.github.io/webappsec-secure-contexts/), Keycloak may not set its session cookie when TLS is disabled (SameSite=None cookies require the `Secure` attribute).
As a local‑dev workaround in Chrome, add `http://keycloak.wundergraph.local,http://studio.wundergraph.local` to `chrome://flags/#unsafely-treat-insecure-origin-as-secure` so these origins are treated as secure contexts over HTTP.
Use this only for local development and remove the flag after testing. Prefer enabling TLS locally (e.g., self‑signed cert via mkcert and an Ingress TLS secret).

### 4. Clean up

After you are done, you can clean up the demo by running:

```bash
helm uninstall cosmo
```

> [!CAUTION]
> Volumes might not be automatically removed, so you may need to manually remove them with `kubectl delete pvc -l app.kubernetes.io/instance=cosmo`
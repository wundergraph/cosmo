# WunderGraph Cosmo CLI (`wgc`)

**The all-in-one CLI for managing federated GraphQL APIs with [WunderGraph Cosmo](https://cosmo-docs.wundergraph.com/).**

![npm](https://img.shields.io/npm/v/wgc) ![License](https://img.shields.io/npm/l/wgc) ![Downloads](https://img.shields.io/npm/dw/wgc)

---

## 🚀 What is `wgc`?

`wgc` is the official CLI for [WunderGraph Cosmo](https://cosmo-docs.wundergraph.com/), an open-source, full-lifecycle GraphQL API management platform.

With `wgc`, you can:

* Create and manage **federated GraphQL APIs** and **subgraphs**
* Perform **schema checks** and **composition validations**
* Generate and deploy **router configurations**
* Integrate with **CI/CD pipelines** for automated workflows
* Manage **namespaces**, **API keys**, and more

Whether you're building monolithic or federated GraphQL architectures, `wgc` provides the tools to manage your development and deployment processes.

---

## 🧰 Cosmo Features

* **Federation Support**: Compatible with GraphQL Federation v1 and v2
* **Schema Registry**: Centralized management of your GraphQL schemas with versioning and change tracking
* **Composition Checks**: Automated validation to ensure subgraphs compose correctly without breaking changes
* **Router Configuration**: Generate and manage router configurations for efficient query planning and execution
* **Observability**: Integrated with OpenTelemetry and Prometheus for metrics, tracing, and monitoring
* **Access Control**: Fine-grained access controls with support for OIDC, RBAC, and SCIM

---

## 📦 Installation

### Prerequisites

* [Node.js](https://nodejs.org/) v20 LTS or higher

### Install via npm

```bash
npm install -g wgc@latest
```

Or use `npx`:

```bash
npx -y wgc@latest
```

---

## 🛠️ Getting Started

### 1. Clone the Example Project

Start with the [Cosmo Demo](https://github.com/wundergraph/cosmo-demo), which includes two subgraphs (`posts` and `users`) and a router configuration.

```bash
git clone https://github.com/wundergraph/cosmo-demo.git
cd cosmo-demo
```

### 2. Install `wgc`

Ensure you have `wgc` installed globally:

```bash
npm install -g wgc@latest
```

### 3. Start Subgraphs

Make the startup script executable and run it:

```bash
chmod +x start-subgraphs.sh
./start-subgraphs.sh
```

Verify the subgraphs are running:

* [Posts Subgraph](http://localhost:4001/graphql)
* [Users Subgraph](http://localhost:4002/graphql)

### 4. Generate Router Configuration

Navigate to the `router` directory and compose the router configuration:

```bash
cd router
wgc router compose --input graph.localhost.yaml --out config.json
```

### 5. Run the Router

Start the router using Docker:

```bash
docker run \
  --name cosmo-router \
  --rm \
  -p 3002:3002 \
  --add-host=host.docker.internal:host-gateway \
  --platform=linux/amd64 \
  -e pull=always \
  -e DEV_MODE=true \
  -e LISTEN_ADDR=0.0.0.0:3002 \
  -e EXECUTION_CONFIG_FILE_PATH="/config/config.json" \
  -v "$(pwd)/config.json:/config/config.json" \
  ghcr.io/wundergraph/cosmo/router:latest
```

### 6. Query the Federated Graph

Access the federated GraphQL API at [http://localhost:3002](http://localhost:3002).

Example query:

```graphql
query {
  posts {
    id
    content
    author {
      id
      name
    }
  }
}
```

---

## 📚 Documentation

* **CLI Reference**: [https://cosmo-docs.wundergraph.com/cli](https://cosmo-docs.wundergraph.com/cli)
* **Zero to Federation Tutorial**: [https://cosmo-docs.wundergraph.com/tutorial/from-zero-to-federation-in-5-steps-using-cosmo](https://cosmo-docs.wundergraph.com/tutorial/from-zero-to-federation-in-5-steps-using-cosmo)
* **Full Documentation**: [https://cosmo-docs.wundergraph.com/](https://cosmo-docs.wundergraph.com/)

---

## 🌐 About WunderGraph Cosmo

WunderGraph Cosmo is a comprehensive, open-source platform for managing GraphQL APIs at scale. It offers:

* **Schema Registry**: Centralized schema management with versioning and validation
* **Cosmo Studio**: A web interface for exploring schemas, monitoring performance, and managing access
* **Cosmo Router**: A high-performance, Go-based router supporting federation, subscriptions, and more
* **Observability**: Built-in support for OpenTelemetry and Prometheus
* **Security**: Fine-grained access controls with OIDC, RBAC, and SCIM support

Cosmo can be deployed on-premises, in the cloud, or used as a managed service.

---

## 🧪 Example Commands

* **Create Namespace**:

```bash
npx wgc namespace create production
```

* **Create Federated Graph**:

```bash
npx wgc federated-graph create main -r http://router.example.com/graphql -n production
```

* **Create Subgraph**:

```bash
npx wgc subgraph create products --routing-url http://localhost:4001/graphql
```

* **Check Subgraph Schema Changes**:

```bash
npx wgc subgraph check products -n production --schema ./schemas/products.graphql
```

* **Generate Router Configuration locally**:

Composition Configuration (graph.yaml):

```yaml
version: 1
subgraphs:
  - name: products
    routing_url: http://localhost:4001/graphql
    schema:
      file: ./schemas/products.graphql
```

Generate CMD:

```bash
npx wgc router compose -i graph.yaml -o config.json
```

* **Run Router**:

```bash
docker run \
  --name cosmo-router \
  --rm \
  -p 3002:3002 \
  --add-host=host.docker.internal:host-gateway \
  --platform=linux/amd64 \
  -e pull=always \
  -e DEV_MODE=true \
  -e LISTEN_ADDR=0.0.0.0:3002 \
  -e EXECUTION_CONFIG_FILE_PATH="/config/config.json" \
  -v "$(pwd)/config.json:/config/config.json" \
  ghcr.io/wundergraph/cosmo/router:latest
```

---

## 🔗 Related Projects

* **Cosmo Demo**: [https://github.com/wundergraph/cosmo-demo](https://github.com/wundergraph/cosmo-demo)
* **Cosmo GitHub Repository**: [https://github.com/wundergraph/cosmo](https://github.com/wundergraph/cosmo)
* **WunderGraph Website**: [https://wundergraph.com](https://wundergraph.com)

---

## 🔗 From the WunderGraph Blog

Here's a selection of blog posts that focus on the technical aspects of Cosmo:

- [**How we scaled Cosmo Router for the SuperBowl**](https://wundergraph.com/blog/scaling-graphql-federation-for-the-superbowl)
- [**The Architecture of our Observability Stack**](https://wundergraph.com/blog/scaling_graphql_observability)
- [**How Normalization affects Query Planning**](https://wundergraph.com/blog/normalization_query_planning_graphql_federation)
- [**Zero cost abstraction for the @skip and @include Directives**](https://wundergraph.com/blog/zero_cost_abstraction_for_skip_include_in_federated_graphql)
- [**Algorithm to minify GraphQL ASTs by up to 99%**](https://wundergraph.com/blog/graphql_query_ast_minification)
- [**Federated GraphQL Subscriptions with NATS and Event Driven Architecture**](https://wundergraph.com/blog/distributed_graphql_subscriptions_with_nats_and_event_driven_architecture)
- [**Implementing the viewer pattern in GraphQL Federation**](https://wundergraph.com/blog/graphql_federation_viewer_pattern)
- [**How we're using Epoll/Kqueue to scale GraphQL Subscriptions**](https://wundergraph.com/blog/edfs_scaling_graphql_subscriptions_in_go)
- [**ASTJSON - A fast way to merge JSON objects**](https://wundergraph.com/blog/astjson_high_performance_json_transformations_in_golang)
- [**Dataloader 3.0, an efficient algorithm for Federation data loading**](https://wundergraph.com/blog/dataloader_3_0_breadth_first_data_loading)

---

## Telemetry

The CLI tool collects usage data to help us improve the tool and understand how users interact with it.
You can disable telemetry in one of the following ways:

```shell
export COSMO_TELEMETRY_DISABLED=true
```

or

```shell
export DO_NOT_TRACK=1
```

---

## 📄 License

This project is licensed under the [Apache 2.0 License](https://github.com/wundergraph/cosmo/blob/main/LICENSE).

---

## 📬 Support & Community

* **Discord**: Join our [Discord community](https://wundergraph.com/discord) for support and discussions
* **GitHub Issues**: Report issues or request features on our [GitHub repository](https://github.com/wundergraph/cosmo/issues)

---

Empower your GraphQL Federation development with `wgc` and WunderGraph Cosmo!

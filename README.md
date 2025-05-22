<p align="center">
<img width="350" src="./docs/assets/logo.png"/>
</p>

<div align="center">
<h5>WunderGraph Cosmo - The GraphQL Federation Platform</h5>
<h6><i>Reach for the stars, ignite your cosmo!</i></h6>
</div>

<p align="center">
  <a href="https://cosmo-docs.wundergraph.com/getting-started/cosmo-cloud-onboarding"><strong>Quickstart</strong></a> ·
  <a href="/examples"><strong>Examples</strong></a> ·
  <a href="https://cosmo-docs.wundergraph.com"><strong>Docs</strong></a> ·
  <a href="https://cosmo-docs.wundergraph.com/cli"><strong>CLI</strong></a> ·
  <a href="https://wundergraph.com/discord"><strong>Community</strong></a> ·
  <a href="https://github.com/wundergraph/cosmo/releases"><strong>Changelog</strong></a> ·
  <a href="https://wundergraph.com/jobs"><strong>Hiring</strong></a>
</p>

## Overview

WunderGraph Cosmo is a comprehensive Lifecycle API Management platform tailored for Federated GraphQL. It encompasses everything from Schema Registry, composition checks, and analytics, to metrics, tracing, and routing. Whether you’re looking to deploy 100% on-prem or prefer a [Managed Service](https://cosmo.wundergraph.com/login), Cosmo offers flexibility without vendor lock-in, all under the Apache 2.0 license.

## The State of GraphQL Federation 2024

Get insights from industry experts and Federation practicioners across all industries and learn how companies are using GraphQL Federation.
Head over to the [State of GraphQL Federation 2024](https://wundergraph.com/state-of-graphql-federation/2024) page and download the full **48 page PDF report** for free!

### Why Federated GraphQL?

GraphQL Federation empowers organizations to break down their GraphQL schema into multiple smaller, manageable schemas, each maintained by different teams or services. These individual schemas are then combined into a single, unified graph, ensuring that all teams have consistent access to the data they need. In today's data-driven world, where information is often referred to as the new oil, building a unified API that can be consumed by both internal and external teams is more crucial than ever.

Not all companies start with a federated architecture, Cosmo supports both monolithic and federated architectures.

## Getting Started

To get started with WunderGraph Cosmo, follow these steps:

1. **Clone the Repository**: `git clone https://github.com/wundergraph/cosmo.git`
2. **Choose your Example**: Select the example that best fits your role and use case from the [Try Cosmo Now](#try-cosmo-now) section and follow the instructions.
3. **Explore Further**: Check out the [Docs](https://cosmo-docs.wundergraph.com) for more information on Cosmo's features and capabilities.

## Try Cosmo Now! :rocket:

Get started with Cosmo by choosing the example that best fits your role and use case:

- [**Developer**](examples/router-simple/README.md): Quickly start with Cosmo by composing a federated GraphQL schema locally from multiple services and running the Cosmo Router.
- [**Architect**](./examples/full-cosmo-docker/README.md): Evaluate the entire Cosmo Platform for your organization by running it locally with Docker Compose.
- [**Platform Engineer**](examples/full-cosmo-helm/README.md): Deploy the entire Cosmo Platform to Kubernetes through our official Helm Chart.
- [**Decision Maker (e.g. Engineering Manager, CTO)**](https://wundergraph.com/contact/sales): Get in touch with the founders to discuss how Cosmo can help your organization.

## Local Development

To contribute to this repo and get the local environment up and running, please refer to [**CONTRIBUTING.md**](./CONTRIBUTING.md#local-development)

_For any questions, feedback, or support, please [contact](https://wundergraph.com/contact/sales) us._

<br>
<p align="center">
<a href="https://cosmo.wundergraph.com">
<img width="250" src="./docs/assets/cta_readme.png"/>
</a>
</p>

## From the WunderGraph Blog

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

## Contributing

We welcome contributions from the community! Whether it's fixing a bug, adding new features, or improving documentation, your help is greatly appreciated. Please take a look in our [Contributing Guide](CONTRIBUTING.md) to get started.

## License

Cosmo is licensed under the [Apache License, Version 2.0](LICENSE).

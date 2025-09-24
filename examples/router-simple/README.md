# Router Simple

This example demonstrates how to compose a federated GraphQL schema from multiple remote services and run the Cosmo Router locally.

### Prerequisites

- [NodeJs & NPM (LTS)](https://nodejs.org/en/download/)

## Getting started

The following commands will install all dependencies, compose the federated schema, and start the Cosmo Router.

```bash
./start.sh
```

Finally, open the GraphQL Playground at [http://localhost:3002](http://localhost:3002) and run the following query:

```graphql
query MyEmployees {
  employees {
    details {
      forename
    }
    currentMood
    derivedMood
    isAvailable
    notes
    products
  }
}
```

## Advanced Request Tracing (ART)

Click on "Trace" in the right corner of the Playground to see the tracing feature in action. [Advanced Request Tracing (ART)](https://cosmo-docs.wundergraph.com/router/advanced-request-tracing-art) give you the ability to understand the operation execution in detail. Identify bottlenecks and optimize your queries without leaving the Playground.


## Modifying the schema

In the [graph.yaml](graph.yaml) file, you can see the subgraphs that make up the federated schema. We download the schemas through their introspection endpoint and compose them into a federated schema.
You can also reference a local schema file. For more information, see the [wgc router compose](https://cosmo-docs.wundergraph.com/cli/router/compose).

For demonstration purposes, all subgraphs are running on a severless environment. The Cosmo Router is running locally and proxies the requests to the remote services. It might take a few seconds for the serverless functions to start up.

# Full Cosmo Docker

This example demonstrates how to run the entire Cosmo platform locally with Docker Compose.

### Prerequisites
- make
- [Docker](https://docs.docker.com/get-docker/)
- [Docker Compose](https://docs.docker.com/compose/install/) (version 2+ only)
- [NPM](https://nodejs.org/en/download/) (for the Cosmo CLI)

## Getting started

> [!WARNING]  
> Please give Docker Desktop enough resources (CPU, Memory) to run the platform. We recommend at least 4 CPUs and 8GB of memory.

1. Start the platform:

```shell
./start.sh
```

2. Navigate to the [Studio Playground](http://localhost:3000/wundergraph/default/graph/mygraph/playground) and login before with the default credentials:

```
Username: foo@wundergraph.com
Password: wunder@123
```

Finally :rocket:, run the query in the Playground:

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

After you are done, you can clean up the demo by running `./destroy.sh`.

# Example Implementation of the Admission Server

The Admission Server is an optional component of the Cosmo Platform to validate the deployment of the Router configuration before it is applied to the Router.

This example implementation is a simple web server that implemented the `/validate-config` hook to sign and validates the Router configuration. The server is implemented in TypeScript and uses the Hono web framework.

```bash
pnpm install
pnpm run dev
```

Open the browser and navigate to the following URL:
```
open http://localhost:3009
```

# Demo

1. Create a graph with an admission webhook url:

```bash
wgc federated-graph create mygraph -r http://127.0.0.1:3001/graphql --admission-webhook-url http://localhost:3009 --label-matcher=team=A,team=B
```

2. Publish a subgraph
```bash
wgc subgraph publish employees --schema ../demo/pkg/subgraphs/employees/subgraph/schema.graphqls --labels team=A
```

3. Start the router with the same signing key as the admission server
```yaml
version: '1'

graph: 
  sign_key: 'sign_key'
```

4. Wait for the log line that says "Config signature is valid"
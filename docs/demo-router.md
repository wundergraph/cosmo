# Demo Router

For demo purposes, we have created a router that can be used to test all Router features. The service is deployed to fly.io and can be accessed at [https://demo-router.fly.dev](https://demo-router.fly.dev).

## Deploying the Demo Router

The command has to be run from the root of the repository.

```bash
fly deploy -a demo-router -c demo-router.fly.toml --image ghcr.io/wundergraph/cosmo/router:0.46.1
```

## Access Prometheus Metrics

Navigate to the Fly.io [wundergraph-demos](https://fly.io/dashboard/wundergraph-demos) dashboard and click on [`"Need more metrics?" Open`](https://fly-metrics.net/d/fly-app/fly-app?orgId=65007) button.
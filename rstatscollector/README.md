# RstatsCollector

The Resolver-Stats-Collector is a service that allows to receive, process and export GraphQL metrics from resolvers, ingested by the Cosmo Router.
It provides the foundation to collect and compute schema coverage and performance metrics on field level.

## Example

```bash
curl \
    --header "Content-Type: application/json" \
    --data '{}' \
    http://localhost:4005/wg.cosmo.coverage.v1.CoverageService/PublishOperationCoverageReport
```

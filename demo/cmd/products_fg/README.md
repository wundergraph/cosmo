# Products Feature Graph Service

This directory contains a feature-graph that replaces the `products` service in the Cosmo demo.
It provides the same functionality as the original service, but it implements the `productCount` field on the employee type.

## OpenTelemetry

To configure OpenTelemtry, the following environment variables are available:

- `OTEL_HTTP_ENDPOINT`: Sets the endpoint for the OTEL collector. If empty, it defaults to `localhost:4318`.
- `OTEL_AUTH_TOKEN`: Sets the token used to authenticate with the OTEL collector.

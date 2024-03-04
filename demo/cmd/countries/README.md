# Cosmo demo service

This directory contains a service used for cosmo demos.

## OpenTelemetry

To configure OpenTelemtry, the following environment variables are available:

- `OTEL_HTTP_ENDPOINT`: Sets the endpoint for the OTEL collector. If empty, it defaults to `localhost:4318`.
- `OTEL_AUTH_TOKEN`: Sets the token used to authenticate with the OTEL collector.

# Cosmo Router on AWS Fargate

Terraform module for deploying the [Cosmo Router](https://cosmo-docs.wundergraph.com/router/intro) on [AWS Fargate](https://aws.amazon.com/fargate)

## Features

- 🎮 Apply & Go Setup: Simple configuration and a `terraform apply` is everything you need.
- 🚀 High Availability: The module deploys the Cosmo Router in a highly available fashion by default (you can still configure it to just run one instance).

## Prerequisites

The only requirement is that you have to create one secret manually via the [AWS Secret Manager](https://aws.amazon.com/secrets-manager). This secret should contain one key named `GRAPH_API_TOKEN` which holds the token required for communicating with the WunderGraph Cloud. You can find more information on how to create such a token in [our docs](https://cosmo-docs.wundergraph.com/getting-started/cosmo-cloud-onboarding#create-a-router-token).

## Usage

The module can be used in two different modes: HTTP and HTTPS (TLS) mode, whereas the latter is recommended for production scenarios.

### HTTP Mode

```ts
module "cosmo" {
  source = "git::https://github.com/wundergraph/cosmo.git//infrastructure/router/modules/aws-fargate?ref=router@0.72.0"

  name = "cosmo-router"
  release = "0.72.0"
  config_file_path = "${path.module}/config.yaml"

  secret_arn = "<the-arn-to-your-secret>"
}
```

This will deploy a highly available Cosmo Router on AWS Fargate across three availability zones of your default AWS region.

### HTTPS Mode

For production use cases, it is highly recommended to deploy the Cosmo Router with TLS. In this case you need a domain name managed via [Route53](https://aws.amazon.com/route53), so that the module can issue a certificate respectively.

The configuration looks like:

```ts
module "cosmo" {
  source = "git::https://github.com/wundergraph/cosmo.git//infrastructure/router/modules/aws-fargate"

  name = "cosmo-router"
  config_file_path = "${path.module}/config.yaml"

  enable_tls = true
  subdomain = "router"
  hosted_zone_name = "your-domain.com"

  secret_arn = "<the-arn-to-your-secret>"
}
```

Please note that the `hosted_zone_name` must match the name configured in Route53. Otherwise, issuing the certificate would fail.

### Router Configuration

In the previous usage example you might noticed that we pass the path to the Cosmo Router config to the module. The module will read that file and mount it into the container.

Please make sure to create the file before performing a `terraform apply`. The configuration options for the router are described in [our docs](https://cosmo-docs.wundergraph.com/router/configuration) as well.

**Important:** As described before, the actual `GRAPH_API_TOKEN` value needs to be defined in the secret. This value gets injected when the container of the Cosmo Router starts. Please make sure that you add the following lines to your `config.yaml`. Otherwise, the Router wouldn't be able to communicate with the Cosmo Control Plane.

```yaml
graph:
  # Leave this definition as is. The variable will be substituted when the container starts.
  token: ${GRAPH_API_TOKEN}
```

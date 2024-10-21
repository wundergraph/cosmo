# Cosmo Router on Google Cloud run

Terraform module for deploying the [Cosmo Router](https://cosmo-docs.wundergraph.com/router/intro) on [Google Cloud Run ](https://cloud.google.com/run?hl=en)

## Features

- Apply & Go Setup: Simple configuration and a `terraform apply` is everything you need.

## Prerequisites
1. This module requires the following gcp APIs to be enabled(cloudrun, iam, secretmanager)
2. We also require you to create one secret manually via the [Google cloud Manager](https://cloud.google.com/security/products/secret-manager). This secret should contain one key named `GRAPH_API_TOKEN` which holds the token required for communicating with the WunderGraph Cloud. You can find more information on how to create such a token in [our docs](https://cosmo-docs.wundergraph.com/getting-started/cosmo-cloud-onboarding#create-a-router-token).


## Usage

Basic usage of the module is as follows

```ts
module "cosmo" {
  source = "git::https://github.com/wundergraph/cosmo.git//infrastructure/router/modules/google-cloudrun?ref=router@<release>"
  name             = "<name>"
  config_file_path = "${path.module}/config.yaml"
  region           = "<gcp-region>"
  secret_name      = "<secret name created above>"
  project          = "<project_id of the gcp project>"

}
```

### Router Configuration

In the previous usage example you might noticed that we pass the path to the Cosmo Router config to the module. The module will read that file and mount it into the container.

Please make sure to create the file before performing a `terraform apply`. The configuration options for the router are described in [our docs](https://cosmo-docs.wundergraph.com/router/configuration) as well.

**Important:** As described before, the actual `GRAPH_API_TOKEN` value needs to be defined in the secret. This value gets injected when the container of the Cosmo Router starts. Please make sure that you add the following lines to your `config.yaml`. Otherwise, the Router wouldn't be able to communicate with the Cosmo Control Plane.

```yaml
graph:
  # Leave this definition as is. The variable will be substituted when the container starts.
  token: ${GRAPH_API_TOKEN}
```

## Inputs

| Name | Description | Type | Default | Required |
|------|-------------|------|---------|:--------:|
| region | region to for the cloud run deployment  | `string` | `null` | yes |
| project | GCP project id where the router will be deployed to | `string` | `null` | yes |
| memory | amount of memory allocated for the cloud run deployment | `string` | `null` | yes |
| memory | amount of memory allocated for the cloud run deployment | `string` | `null` | yes |
| cpu | amount of cpu allocated for the cloud run deployment | `string` | `null` | yes |
| min_instance_count | minimum no of instances to run  | `string` | `null` | yes |
| maximum_instance_count | maximum no of sinstances to run   | `string` | `null` | yes |
| image | cosmo router image to run   | `string` | `null` | yes |
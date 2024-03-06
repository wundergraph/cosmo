# Cosmo Router on AWS Fargate

This directory contains the necessary files to deploy the Cosmo Router on AWS Fargate.

Please note that this template deploys the Cosmo Router in the default VPC. It serves as a general setup example on AWS and should be customized to fit your project's specific requirements.

## Cosmo Router Configuration

The template contains an example file for configuring the Cosmo Router. Make sure to copy it over via `cp config.yaml.exmaple config.yaml` before applying the infrastructure via `terraform`.


## Secret Configuration

The router needs the `GRAPH_API_TOKEN` secret defined (see [wgc router token create](https://cosmo-docs.wundergraph.com/cli/router/token/create) for further information). Please create a secret via the AWS [Secret Manager](https://aws.amazon.com/secrets-manager/), place the generated value there and pass the ARN of that secret as a variable to your `terraform` CLI commands.

# aws-lambda-router

This is the [AWS Lambda](https://aws.amazon.com/lambda/) version of the WunderGraph Cosmo [Router](https://wundergraph.com/cosmo/features/router). Please [contact](https://wundergraph.com/contact/sales) us if you have any questions or production use case.

Status: **Beta**

- [X] GraphQL Queries
- [X] GraphQL Mutations
- [X] Telemetry Flushing after each request
- [X] Schema Usage Tracking after each request
- [ ] No support for subscriptions. Please [talk to us](https://wundergraph.com/contact/sales) if you need this.

## Requirements

* AWS CLI already configured with Administrator permission
* [Docker installed](https://www.docker.com/community-edition)
* [Golang](https://golang.org)
* SAM CLI - [Install the SAM CLI](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/serverless-sam-cli-install.html)

## Setup process

### Cosmo Cloud

Signup For Cosmo Cloud and follow the [onboarding](https://cosmo-docs.wundergraph.com/tutorial/cosmo-cloud-onboarding) process.

Run `make fetch-router-config` to fetch the latest router configuration from Cosmo Cloud. We assume that you have named your graph `production`.

### Installing dependencies & building the target 

In this example we use the built-in `sam build` to automatically download all the dependencies and package our build target.   
Read more about [SAM Build here](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/sam-cli-command-reference-sam-build.html) 

The `sam build` command is wrapped inside the `Makefile`. To execute this simply run
 
```shell
make build
```

### Local development

Start the API Gateway locally

```bash
make dev
```

### Deploying application

Ensure that the environment variables `STAGE` and `GRAPH_API_TOKEN` are set.

```bash
make deploy
```

The command will package and deploy your application to AWS.
You can find your API Gateway Endpoint URL in the output values displayed after deployment.
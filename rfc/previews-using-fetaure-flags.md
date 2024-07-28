---
title: 'Supergraph Previews for every Pull Request'
author: Suvij Surya
---

This RFC proposes a way to create a Supergraph Preview for every pull request. This would allow developers to test their changes before merging them.

## Motivation

When developing a new feature, it's important to test it in a production-like environment. By creating a preview for every pull request, developers can test their changes in a production-like environment before merging them.

With Graph Feature Flags, you can set up your continuous integration pipeline to deploy a new feature subgraph and feature flag for every pull request. This way, you can create one composition for every pull request without having to deploy a whole new set of subgraphs. All we need is a staging environment that's deployed from all main branches of your subgraphs. With graph feature flags, we can then "override" the subgraphs for a specific pull request.

## Proposal-1

```yaml
# feature-flags-preview.yaml
on:
  pull_request:
    paths:
      - 'services/subgraph1/**/*.graphql'
      - 'services/subgraph2/**/*.graphql'
    types: [labeled, synchronize, closed, opened, reopened]

jobs:
  create:
    runs-on: ubuntu-latest
    if: github.event.pull_request.action == 'opened' || github.event.pull_request.action == 'reopened'
    steps:
      # 1. Create & Publish feature subgraph based on cosmo.yaml
      # 2. Create a new feature flag
      - uses: wundergraph/feature-flags@main
        id: ff
        with:
          config: cosmo.yaml # Default to .github/cosmo.yaml
          create: true # Create the feature flag + subgraphs from cosmo.yaml
      - run: |
          echo "Feature flag has been created. You can now provision the subgraph service."
          echo "Published Feature Subgraphs: ${{ steps.ff.outputs.published_feature_subgraphs }}"

  # run the job to deploy all the changed subgraphs here.

  update:
    runs-on: ubuntu-latest
    if: github.event_name == 'synchronize'
    steps:
      - uses: wundergraph/feature-flags@main
        with:
          config: cosmo.yaml # Default to .github/cosmo.yaml
          update: true # Only update the feature subgraphs from cosmo.yaml
      - run: |
          echo "Feature subgraph has been updated. You can now update the subgraph service."
          echo "Published Feature Subgraphs: ${{ steps.ff.outputs.published_feature_subgraphs }}"

  destroy:
    if: github.event.pull_request.action == 'closed'
    runs-on: ubuntu-latest
    steps:
      - uses: wundergraph/feature-flags@main
        id: ff
        with:
          config: cosmo.yaml # Default to .github/cosmo.yaml
          destroy: true # Only destroy the feature flag + subgraphs from cosmo.yaml
      - run: |
          echo "Feature flag and the feature subgraphs have been destroyed. You can now unprovision the subgraph service."
---
# config
# .github/cosmo.yaml
namespace: 'staging'
feature_flags:
  - name: 'my-feature-flag-{PR_NUMBER}'
    labels:
      - 'my-feature-flag-label'

subgraphs:
  - name: 'subgraph1'
    schema: 'my-project/my-subgraph/subgraph1.graphql'
    routing_url: 'http://mycompany-subgraph1-{PR_NUMBER}.com/graphql' # Supports templating, only PR_NUMBER is supported
```

### Requirements

- Make sure the labels of the feature flag match that of the federated graph for which the preview is being created.
- Make sure that the subgraphs being changed are a part of the federated graph.
- Make sure that the changed subgraphs are a part of the config, if not present the featur subgraph for that subgraph will not be created.
- All the subgraphs in the config have to be deployed and present on Cosmo.
- The `cosmo.yaml` file should be present in the `.github` directory on the first commit of the PR(if already not present).
- The changes to the `cosmo.yaml` file should be in the first commit of the PR.
- All the subgraphs changed in this PR should be deployed at the proposed routing_url in the CI for the preview to work.

### Implementation

#### Create Job

- This job will create a new feature flag and create/publish the feature subgraphs for all the changed subgraphs.
- This job will only run when the PR is opened or reopened, so it is important for the `cosmo.yaml` file to be present in the `.github` directory on the first commit of the PR.

#### Update Job

- This job will publish(create if not present) the feature subgraphs for all the changed subgraphs in the latest commit.
- This job will only run on each new commit to the PR.

#### Destroy Job

- This job will destroy the feature flag and the feature subgraphs used for the preview of this PR.
- This job will only run when the PR is closed/merged.


### Limitations

- The comso.yaml file should not be changed after the PR is opened, if changed for the preview to work as expected, the PR has to be closed and reopened.


## Proposal-2

```yaml
# feature-flags-preview.yaml
on:
  pull_request:
    paths:
      - 'services/subgraph1/**/*.graphql'
      - 'services/subgraph2/**/*.graphql'
    types: [labeled, synchronize, closed, opened, reopened]

jobs:
  create:
    runs-on: ubuntu-latest
    if: github.event.label.name == 'cosmo-preview' && github.event.pull_request.action == 'labeled'
    steps:
      # 1. Create & Publish feature subgraph based on cosmo.yaml
      # 2. Create a new feature flag
      - uses: wundergraph/feature-flags@main
        id: ff
        with:
          config: cosmo.yaml # Default to .github/cosmo.yaml
          create: true # Create the feature flag + subgraphs from cosmo.yaml
      - run: |
          echo "Feature flag has been created. You can now provision the subgraph service."
          echo "Published Feature Subgraphs: ${{ steps.ff.outputs.published_feature_subgraphs }}"

  # run the job to deploy all the changed subgraphs here.

  update:
    runs-on: ubuntu-latest
    if: github.event_name == 'synchronize'
    steps:
      - uses: wundergraph/feature-flags@main
        with:
          config: cosmo.yaml # Default to .github/cosmo.yaml
          update: true # Only update the feature subgraphs from cosmo.yaml
      - run: |
          echo "Feature subgraph has been updated. You can now update the subgraph service."
          echo "Published Feature Subgraphs: ${{ steps.ff.outputs.published_feature_subgraphs }}"

  destroy:
    if: github.event.pull_request.action == 'closed' || (github.event.label.name == 'cosmo-preview' && github.event.pull_request.action == 'unlabeled')
    runs-on: ubuntu-latest
    steps:
      - uses: wundergraph/feature-flags@main
        id: ff
        with:
          config: cosmo.yaml # Default to .github/cosmo.yaml
          destroy: true # Only destroy the feature flag + subgraphs from cosmo.yaml
      - run: |
          echo "Feature flag and the feature subgraphs have been destroyed. You can now unprovision the subgraph service."
---
# config
# .github/cosmo.yaml
namespace: 'staging'
feature_flags:
  - name: 'my-feature-flag-{PR_NUMBER}'
    labels:
      - 'my-feature-flag-label'

subgraphs:
  - name: 'subgraph1'
    schema: 'my-project/my-subgraph/subgraph1.graphql'
    routing_url: 'http://mycompany-subgraph1-{PR_NUMBER}.com/graphql' # Supports templating, only PR_NUMBER is supported
```

### Requirements

- Make sure the labels of the feature flag match that of the federated graph for which the preview is being created.
- Make sure that the subgraphs being changed are a part of the federated graph.
- Make sure that the changed subgraphs are a part of the config, if not present the featur subgraph for that subgraph will not be created.
- All the subgraphs in the config have to be deployed and present on Cosmo.
- The `cosmo.yaml` file should be present in the `.github` directory before the PR is labeled with `cosmo-preview`.
- All the subgraphs changed in this PR should be deployed at the proposed routing_url in the CI for the preview to work.

### Implementation

The implementation is the same as Proposal-1, the only difference is that the feature flag is created when the PR is labeled with `cosmo-preview` and destroyed when the PR is unlabeled with `cosmo-preview` or when the pr is closed.

### Limitations

- The comso.yaml file should not be changed after the PR is labeled with `cosmo-preview`, if changed for the preview to work as expected, the PR has to be unlabeled and relabeled with `cosmo-preview`.


## Proposal-3

```yaml

# feature-flags-preview.yaml
on:
  pull_request:
    paths:
      - "services/subgraph1/**"
    types: [ opened, synchronize, closed, reopened ]

jobs:
  create:
    runs-on: ubuntu-latest
    if: github.event.pull_request.action == 'opened' || github.event.pull_request.action == 'reopened'
    steps:
      # 1. Create & Publish feature subgraph based on cosmo.yaml
      # 2. Create a new feature flag
      - uses: wundergraph/feature-flags@main
        id: ff
        with:
          namespace: "production"
          feature_flag_name: "my-feature-flag-{PR_NUMBER}"
          feature_flag_labels: "my-feature-flag-label" # comma separated
          subgraph_name: "subgraph1"
          subgraph_schema: "my-project/my-subgraph/subgraph1.graphql"
          subgraph_routing_url: "http://mycompany-subgraph1-{PR_NUMBER}.com/graphql" 
          create: true # Create the feature flag + subgraphs from cosmo.yaml
      - run: |
          echo "Feature flag has been created. You can now provision the subgraph service."

  update:
    runs-on: ubuntu-latest
    if: github.event_name == 'synchronize'
    steps:
      - uses: wundergraph/feature-flags@main
        with:
          namespace: "production"
          subgraph_name: "subgraph1"
          subgraph_schema: "my-project/my-subgraph/subgraph1.graphql"
          update: true # Only update the feature subgraphs from cosmo.yaml
      - run: |
          echo "Feature subgraph has been updated. You can now update the subgraph service."

  destroy:
    if: github.event.pull_request.action == 'closed'
    runs-on: ubuntu-latest
    steps:
      - uses: wundergraph/feature-flags@main
        id: ff
        with:
          namespace: "production"
          feature_flag_name: "my-feature-flag-{PR_NUMBER}"
          subgraph_name: "subgraph1"
          destroy: true # Only destroy the feature flag + subgraphs from cosmo.yaml
      - run: |
          echo "Feature flag has been destroyed. You can now unprovision the subgraph service."
```

### Requirements

- Make sure the labels of the feature flag match that of the federated graph for which the preview is being created.
- Make sure that the subgraphs being changed are a part of the federated graph.
- Make sure that the changed subgraphs are a part of the config, if not present the featur subgraph for that subgraph will not be created.
- All the subgraphs in the config have to be deployed and present on Cosmo.
- All the subgraphs changed in this PR should be deployed at the proposed routing_url in the CI for the preview to work.

### Implementation

The implementation is the same as Proposal-1.

### Limitations

- Can only have one feature flag per PR.
- Can only have one subgraph per feature flag.

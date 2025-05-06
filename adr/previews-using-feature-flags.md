---
title: 'Supergraph Previews for every Pull Request'
author: Suvij Surya
---

## Context

When developing new features, testing in a production-like environment is crucial. By creating a preview for every pull request (PR), developers can ensure their changes are tested in such an environment before merging. Utilizing [Graph Feature Flags](https://cosmo-docs.wundergraph.com/concepts/feature-flags), the continuous integration (CI) pipeline can deploy a new feature subgraphs and feature flag for each PR, allowing for one composition per PR without deploying all the subgraphs. All we need is a staging environment that's deployed from all main branches of your subgraphs. With graph feature flags, we can then "override" the subgraphs for a specific pull request.

## Decision

We will implement an action that allows for the creation of previews for every pull request by leveraging graph feature flags. This will enable us to override specific subgraphs for each PR in a staging environment, facilitating thorough testing before changes are merged. 
We will provide two different options. The only difference between them would be the triggers to run the actions. The users can choose one of these solutions based on their preference.

## Options

### Option 1: Using GitHub Pull Request Events

This solution triggers preview creation based on changes in subgraph files detected by GitHub pull request events.

#### Implementation

- **Trigger**: PR events (opened, reopened, synchronize, labeled, closed)
- **Configuration**: `.github/cosmo.yaml`
- **Actions**:
  - **Create**: When a PR is opened or reopened, create and publish a feature subgraph and a corresponding feature flag.
  - **Update**: When a PR is synchronized, update the feature subgraphs and the feature flag.
  - **Destroy**: When a PR is closed, destroy the feature subgraph and feature flag.

If the cosmo.yaml file is changed after the PR is created, the preview will not be updated, and we will return an error. To update the preview, the user has to close and reopen the PR.

#### Example Configuration

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

### Option 2: Using GitHub Pull Request Label Events

This solution allows for an on-demand approach for creating supergraph previews by using GitHub labels. This method provides flexibility, allowing developers to request previews only for specific pull requests by labeling them accordingly.

#### Implementation

- **Trigger**: PR events (labeled, unlabeled, synchronize, closed)
- **Configuration**: .github/cosmo.yaml
- **Actions**:
  - **Create**: When the label is added, create and publish a feature subgraph and a corresponding feature flag.
  - **Update**: When a PR is synchronized, update the feature subgraph and the feature flag.
  - **Destroy**: When a PR is closed or when the label is removed, destroy the feature subgraph and feature flag.

If the `cosmo.yaml` file is changed after the label is added, the preview will not be updated, and we will return an error. To update the preview, the user has to remove the label and add it again.

#### Example Configuration

```yaml
# feature-flags-preview.yaml
on:
  pull_request:
    paths:
      - 'services/subgraph1/**/*.graphql'
      - 'services/subgraph2/**/*.graphql'
    types: [labeled, unlabeled, synchronize, closed]

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

- Feature flag labels must match the federated graph for which the preview is created.
- Make sure that the subgraphs being changed are a part of the federated graph.
- Changed subgraphs must be specified in the cosmo.yaml file; otherwise, the feature subgraph will not be created.
- All subgraphs specified in the config must be deployed and available on Cosmo.
- The cosmo.yaml file must be present in the .github directory at the first commit of the PR.
- Any changes to the cosmo.yaml file must be included in the first commit of the PR or before the label is added depending on the option the user choses.
- The changed subgraphs in the PR must be deployed at the specified routing URL in the CI for the preview to function.
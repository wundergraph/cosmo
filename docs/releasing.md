# Releasing

## Monorepo

Release the full monorepo with all packages and services can be done by triggering a single GitHub Action workflow.

1. [Trigger the Release workflow](https://github.com/wundergraph/cosmo/actions/workflows/release.yaml): This will create GitHub releases and tags for all components. For services that are not published to NPM but to GitHub container registry, Lerna will trigger a `postversion` npm hooks that triggers the [Build and Release Image](https://github.com/wundergraph/cosmo/actions/workflows/image-release.yml) workflow. This workflow will build and tag all images:
    - `latest`: Only when the workflow was triggered on the default branch, the `latest` tag will be created.
    - `short-sha`: The short SHA of the commit that triggered the release workflow will be tagged e.g `sha-d7f7524`.
    - `git-tag`: The git tag that was updated by Lerna in the `package.json` will be tagged e.g. `0.4.2`
    - `buildcache`: This tag will be used by the Docker GitHub Action to cache the build step. This tag will be overwritten on every release.
2. After the release, you can validate the release by:
    1. checking the [GitHub Cosmo Packages](https://github.com/orgs/wundergraph/packages?repo_name=cosmo)
    2. checking the [GitHub Cosmo Releases](https://github.com/wundergraph/cosmo/releases)

## Release Automation

We use conventional commits to automate the release process. This means that we use the commit message to determine the next version. The commit message must follow the [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/) specification.

## Release Preview

On every merge to the default branch, a preview of the release will be created. This preview will be available as a summary on the [Release Preview](https://github.com/wundergraph/cosmo/actions/workflows/release-preview.yaml) workflow.

## Notes

This project uses [Lerna Lite](https://github.com/lerna-lite/lerna-lite) to manage the monorepo. Lerna is a tool that optimizes the workflow around managing multi-package repositories with git and npm.
Also for non NPM packages, Lerna is used to manage the versioning and releasing of the packages. This allows us to automate the release process and keep the versioning in sync with a single tool.

## Helm Charts

The Helm Chart release is handled by [release-please](https://github.com/googleapis/release-please).
This means, that whenever a pull request is merged to main, release please will open a release pull request and take care of bumping the version in the `Chart.yaml` file creating a release tag.

The process outlines as follows:

1. Create a PR for your feature and get it merged to main. This also includes running `cd helm && make docs`.
2. When your PR touched any files under the helm directory, a pull request will be opened against the main branch. For each helm chart, either [cosmo-platform](https://artifacthub.io/packages/helm/cosmo-platform/cosmo) or [cosmo-router](https://artifacthub.io/packages/helm/cosmo-router/router), that was changed, a PR will be created.
3. Release-Please takes care of bumping the version and creating a proper `CHANGELOG.md` for the changes that came in with the feature PR.
4. The PR will build the Changelog according to the [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/) specification.
5. E.g.: `fix: port in service` will bump the patch version, `feat: add new service` will bump the minor version.
6. After the PR was created `cd helm && make docs` runs on the PR branch to update the version in the changed helm charts.
7. As soon as the PR gets merged back to main, the packaged helm charts are pushed against oci://ghcr.io/wundergraph/cosmo/helm-charts.
8. After some time the released version will be available either under [cosmo-platform](https://artifacthub.io/packages/helm/cosmo-platform/cosmo) or [cosmo-router](https://artifacthub.io/packages/helm/cosmo-router/router).

### Prerequisites

- [helm](https://helm.sh/docs/intro/install/) Helm is a tool for managing Kubernetes charts.
- [yq](https://mikefarah.gitbook.io/yq) yq is a lightweight and portable command-line YAML processor.
- Write access to the gcr.io/wundergraph/cosmo repository
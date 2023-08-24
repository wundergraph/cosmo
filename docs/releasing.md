# Releasing

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

## Notes

This project uses [Lerna Lite](https://github.com/lerna-lite/lerna-lite) to manage the monorepo. Lerna is a tool that optimizes the workflow around managing multi-package repositories with git and npm.
Also for non NPM packages, Lerna is used to manage the versioning and releasing of the packages. This allows us to automate the release process and keep the versioning in sync with a single tool.

# Contributing to the WunderGraph Cosmo Repository

## Prerequisites

This guide assumes you have already installed the following software:

- make (should be installed on all linux / IOS systems)
- [golang](https://go.dev/dl/) `>= 1.18`
- [pnpm](https://pnpm.io/installation) >= 8.7.0
- Node.js [LTS](https://nodejs.org/en/about/releases/). You can also pnpm to [install](https://pnpm.io/cli/env) Node.js.
- [docker desktop](https://docs.docker.com/desktop/) (includes: engine, buildkit & compose) **or**:
- [docker engine](https://docs.docker.com/engine/) with:
    - [docker buildkit](https://docs.docker.com/build/buildkit/), with optionally: [docker buildx plugin](https://docs.docker.com/build/install-buildx/)
    - [docker compose plugin](https://docs.docker.com/compose/install/#scenario-two-install-the-compose-plugin)

## Monorepo

NPM packages are managed as a [pnpm workspace](https://pnpm.io/workspaces). This means during development all dependencies are linked.
The root [`package.json`](package.json) provides all scripts you need to orchestrate the development workflow.

### Bootstrap the development environment

Most of the project have a `.env.example` file. Replace `.env.example` with `.env` and fill in the required values.

### Bootstrap the repository

You can bootstrap the repository with the following command:

```bash
make
```

Ready! You can now start contributing to the WunderGraph Cosmo repository. Feel free to open an issue or pull request to add a new feature or fix a bug.

## Conventional Commit Standard

We use [conventionalcommits](https://www.conventionalcommits.org/en/v1.0.0-beta.2/#why-use-conventional-commits) for changelog generation and more structured commit messages.

In order to enforce this standard we use a linter on pre-commit hook. This functionality is provided by [husky](https://typicode.github.io/husky/#/).
In some setup, you have to tell husky where to find your package manager or binaries. Here is the file `.huskyrc` you have to put in your user home directory.

```bash
export NVM_DIR=/home/starptech/.nvm
[ -s /home/starptech/.nvm/nvm.sh ] && \. /home/starptech/.nvm/nvm.sh  # This loads nvm

# golang
export PATH=$PATH:/usr/local/go/bin
export PATH="$PATH:$(go env GOPATH)/bin"
```

### For JetBrains users

[This](https://plugins.jetbrains.com/plugin/13389-conventional-commit) plugins simplifies the commit message creation process.

### Pull Requests

We merge all pull requests in `squash merge` mode. You're not enforced to use [conventional commit standard](https://www.conventionalcommits.org/en/v1.0.0-beta.2/#why-use-conventional-commits) across all your commits, but it's a good practice and avoid mistakes. At the end it's important that the squashed commit message follow the standard.
# WunderGraph Cosmo CLI aka "wgc"

[![npm version](https://badge.fury.io/js/wgc.svg)](https://badge.fury.io/js/wgc)

## Getting started

Official documentation: [https://cosmo-docs.wundergraph.com/cli](https://cosmo-docs.wundergraph.com/cli)

### Prerequisites

- [Node.js 20 LTS or higher](https://nodejs.dev/en/about/releases/)

The cosmo CLI tool `wgc`. Used to manage the cosmo platform e.g. pushing schema, check schemas, creating new projects, managing users, etc. It interacts with the control plane.

### Installation

```bash
npx wgc --help
# or install it globally
npm install -g wgc --help
```

### Telemetry

The CLI tool collects usage data to help us improve the tool and understand how users interact with it. You can disable telemetry in one of the following ways:

1. Set the environment variable:
   ```shell
   export COSMO_TELEMETRY_DISABLED=true
   ```

2. Follow the [Console Do Not Track](https://consoledonottrack.com/) standard:
   ```shell
   export DO_NOT_TRACK=1
   ```

### Development

Ensure that at least Node.js 20.6.0 is installed because we rely on the native .env file support.

Replace `env.example` with `.env` and fill in the required values. By default, we point to the services of your local development environment.

Run any command with `pnpm wgc` to test your changes locally directly.

```bash
pnpm wgc ...
```

_Everything behind `wgc` is passed to the `wgc` cli. This allows you to test your changes locally._

#### Run tests:

```bash
pnpm test
```
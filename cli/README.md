# Cosmo CLI aka "wgc"

[![npm version](https://badge.fury.io/js/wgc.svg)](https://badge.fury.io/js/wgc)

## Getting started

### Prerequisites

- [Node.js 16 LTS or higher](https://nodejs.dev/en/about/releases/)

The cosmo CLI tool `wgc`. Used to manage the cosmo platform e.g. pushing schema, check schemas, creating new projects, managing users, etc. It interacts with the control plane.

### Installation

```bash
npx wgc schema push --service reviews --endpoint https://my-service.com/graphql <schema>.graphql
```

### Development

Run the following script to test your changes locally:

```bash
pnpm build && pnpm wgc schema push
```

_Everything behind `wgc` is passed to the `wgc` cli._

## Authentication

The CLI uses the following environment variables to authenticate with the control plane:

- `COSMO_API_KEY` - API key for the control plane
- `COSMO_API_URL` - URL of the control plane

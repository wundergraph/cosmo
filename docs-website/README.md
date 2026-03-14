# Cosmo Docs

Documentation for [WunderGraph Cosmo](https://cosmo-docs.wundergraph.com) — a Full Lifecycle GraphQL API Management Solution for managing Federated Graphs at scale. Built with [Mintlify](https://mintlify.com).

## Structure

```
├── cli/                      # CLI (wgc) command reference
├── concepts/                 # Core concepts (feature flags, namespaces, schema contracts, etc.)
├── connect/                  # Connect integration
├── connect-rpc/              # Connect-RPC integration
├── control-plane/            # Control Plane architecture
├── deployments-and-hosting/  # Kubernetes, Helm, Terraform, Docker, Cosmo Cloud
├── federation/               # GraphQL Federation and directives
├── getting-started/          # Quick start guides
├── images/                   # Documentation images (organized by topic)
├── logo/                     # Logo assets
├── router/                   # Router configuration, plugins, auth, subscriptions, telemetry
├── snippets/                 # Reusable MDX snippets
├── studio/                   # Studio UI, analytics, SSO, SCIM, policies
├── tutorial/                 # Step-by-step tutorials
├── docs.json                 # Mintlify configuration and navigation
└── style.css                 # Custom styling
```

## Development

Install the [Mintlify CLI](https://www.npmjs.com/package/mintlify):

```
pnpm add -g mintlify
```

Start the local dev server (run from this directory, where `docs.json` is):

```
mintlify dev
```

## Adding a New Page

1. Create an MDX file in the appropriate directory
2. Add the page to the `navigation` array in `docs.json`
3. Preview locally with `mintlify dev`

## Publishing Changes

Create a pull request with your changes. A preview will be automatically generated. Once approved, changes are merged to `main` and deployed to production.

## Troubleshooting

- **Mintlify dev isn't running** — Run `mintlify install` to re-install dependencies.
- **Page loads as a 404** — Make sure you are running in a folder with `docs.json` and the page is listed in the navigation.

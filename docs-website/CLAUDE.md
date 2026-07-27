# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is the documentation repository for WunderGraph Cosmo - a Full Lifecycle GraphQL API Management Solution for managing Federated Graphs at scale. The documentation is built using Mintlify and written in MDX format.

## Development Commands

### Prerequisites
```bash
pnpm add -g mintlify
```

### Local Development
```bash
mintlify dev
```

The development server will start and you can preview changes locally. Run this from the `docs-website/` directory (where `docs.json` is).

### Troubleshooting
If the development server isn't running properly:
```bash
mintlify install
```

## Architecture & Key Concepts

### Cosmo Components
1. **CLI (wgc)** - Command-line interface for managing the platform
2. **Control Plane** - Central management system with Platform API and Node API
3. **Router** - GraphQL Federation router that handles request routing and response aggregation
4. **Studio** - Web interface for management, monitoring, and analytics

### Important Concepts
- **Federated Graph**: Unified GraphQL schema composed of multiple subgraphs
- **Subgraph**: Individual GraphQL service that contributes to a federated graph
- **Monograph**: Single GraphQL service without federation
- **Namespaces**: Environment isolation for graphs (dev, staging, prod)
- **Feature Flags & Feature Subgraphs**: Toggle-able subgraph replacements for incremental rollout
- **Schema Contracts**: Filtered graph versions using @tag directives
- **Cosmo Streams / EDFS: Connects to event streaming systems like Kafka, NATS, and Redis to power event-driven, federated operations through real-time subscriptions.

## Documentation Structure

```
docs-website/
├── cli/                    # CLI documentation (wgc commands)
├── concepts/               # Core concepts and architecture
├── connect/                # Connect integration docs
├── connect-rpc/            # Connect-RPC docs
├── control-plane/          # Control Plane architecture
├── deployments-and-hosting/# Deployment guides
├── federation/             # GraphQL Federation concepts
├── getting-started/        # Quick start guides
├── images/                 # Documentation images by topic
├── logo/                   # Logo assets
├── router/                 # Router configuration and features
├── snippets/               # Reusable MDX snippets
├── studio/                 # Studio web interface docs
└── tutorial/               # Step-by-step tutorials
```

## Key Files

- `docs.json` - Mintlify configuration (navigation, theme, integrations)
- `style.css` - Custom styling
- MDX files throughout - Documentation content

## Writing Guidelines

### Tone and Style
- Write as reference documentation, not as an answer to a question. State facts directly.
- Avoid em dashes. Use periods or restructure the sentence instead.
- Avoid filler and hedging ("simply", "just", "easily", "of course", "it should be noted that").
- Do not over-explain. One clear sentence beats three cautious ones.
- Prefer short, declarative sentences. If a sentence has more than one comma-separated clause, consider splitting it.
- Use structured lists when presenting multiple distinct items. Do not pack them into a single paragraph.
- Do not sound like an LLM. No "This powerful feature allows you to..." or "In other words...". Describe what things do, not how impressive they are.

### Format
1. Use MDX format for all documentation
2. Place images in the appropriate `images/` subdirectory
3. Follow the existing navigation structure in `docs.json`
4. Include code examples where appropriate
5. Link between related documentation pages

### Frontmatter

Keep frontmatter sparse. Every content page should include:

```yaml
---
title: "..."
description: "..."
icon: ...
---
```

Snippets under `snippets/` do not need page frontmatter.

Do not use `dateModified`. Last-modified dates come from Mintlify's git-backed timestamps (`metadata.timestamp` in `docs.json`). Authors do not bump a date field. Set `timestamp: false` on a page only when a last-modified line would be misleading (redirect stubs, empty shells).

Opt-in fields (omit by default):

- `tag` — sidebar badge. Allowed values only: `New`, `Beta`, `Deprecated`. Apply only when true. Do not tag overview hubs or entire sections by default. Use `tag` only; do not also set Mintlify's `deprecated: true`.
- `sidebarTitle` — short nav label. Use `Overview` on section index/hub pages whose `title` is the full section name. Use a shortened label when the page title is too long for the sidebar. Keep the full `title` for the H1 and SEO. Do not add `sidebarTitle` on leaf pages with short titles.
- `noindex: true` — exclude from search engines, sitemaps, site search, and AI context. Page stays in navigation. Use for redirect stubs and pages that should not be indexed.
- `searchable: false` — exclude from in-product search and AI context only. Page remains externally indexable and in the sitemap. Rare. Prefer `noindex: true` for redirect stubs; do not set both.

## Common Tasks

### Adding a New Page
1. Create an MDX file in the appropriate directory
2. Add the page to navigation in `docs.json`
3. Test locally with `mintlify dev`

### Updating Navigation
Edit the `navigation` array in `docs.json` to modify the sidebar structure.

### Adding Images
1. Place images in `images/[topic]/`
2. Reference in MDX: `![Alt text](/images/topic/filename.png)`

## Deployment

Changes are automatically deployed when merged to the main branch. Pull requests generate preview deployments for review.
---
name: docs-update-check
description: Use after implementing features, changing configuration, modifying CLI commands, updating router behavior, altering architecture, or making any user-facing changes. Triggers a documentation review to check if docs-website/ needs updating. Use this skill whenever you finish writing code that changes how users interact with the platform — new flags, config options, API changes, new UI features, behavioral changes, deprecations, or new components. Even small changes like adding an environment variable or a new CLI flag need doc coverage.
---

# Documentation Update Check

After making code changes that affect user-facing behavior, check whether the documentation in `docs-website/` needs to be updated. Outdated or missing documentation is one of the most common sources of user frustration — users read the docs expecting them to match reality, and when they don't, trust erodes. This skill ensures documentation stays in sync with code.

## When This Applies

This check applies when changes touch any of these areas:

- **New features or capabilities** — anything users can now do that they couldn't before
- **Configuration changes** — new options, renamed keys, changed defaults, removed options
- **CLI command changes** — new commands, new flags, changed behavior, new output formats
- **Router behavior** — new middleware, changed request handling, new directives, subscription changes
- **Studio UI** — new pages, new settings panels, changed workflows
- **API changes** — new endpoints, changed request/response shapes, new auth methods
- **Architecture changes** — new components, changed data flow, new deployment requirements
- **Deprecations or removals** — anything users relied on that is going away
- **Environment variables** — new ones, changed names, changed defaults

If the changes are purely internal (refactoring, test-only, CI config, internal code reorganization with no behavioral change), skip the doc check.

## How to Check

### Step 1: Identify what changed

Look at the changes you just made (or use `git diff` if needed). Categorize them:

- What component was changed? (router, cli, controlplane, studio, composition, helm, etc.)
- What is the user-visible effect?
- Are there new configuration options, flags, or environment variables?
- Did any existing behavior change?

### Step 2: Map changes to documentation sections

Use this mapping to find which docs might need updating:

| Code area | Documentation section | Key files |
|---|---|---|
| `router/` (Go) | `docs-website/router/` | `router/configuration.mdx` for config, feature-specific pages |
| `router/pkg/config/` | `docs-website/router/configuration.mdx` | Config schema → config reference |
| `cli/src/commands/` | `docs-website/cli/` | One doc page per CLI command, organized by resource |
| `controlplane/` | `docs-website/control-plane/` | API docs, webhooks, RBAC |
| `studio/` | `docs-website/studio/` | Feature pages matching UI sections |
| `composition/` | `docs-website/federation/` | Directives, composition rules |
| `helm/` | `docs-website/deployments-and-hosting/kubernetes/` | Helm chart docs |
| `proto/` | `docs-website/control-plane/` | API reference pages |
| `aws-lambda-router/` | `docs-website/router/deployment/` | Lambda deployment guide |
| `docker/` | `docs-website/deployments-and-hosting/docker.mdx` | Docker setup |
| `cdn-server/` | `docs-website/deployments-and-hosting/` | CDN configuration |
| New concepts (feature flags, namespaces, etc.) | `docs-website/concepts/` | Concept explainer pages |
| `graphqlmetrics/` | `docs-website/router/metrics-and-monitoring/` | Metrics docs |
| `otelcollector/` | `docs-website/router/open-telemetry/` | OpenTelemetry docs |

### Step 3: Read the relevant doc pages

Read the existing documentation pages that correspond to your changes. Check for:

1. **Missing information** — is the new feature/option/flag documented?
2. **Outdated information** — do existing descriptions still match the new behavior?
3. **Code examples** — do they still work with the changes?
4. **Configuration examples** — do they reflect new defaults or options?
5. **Screenshots** — if UI changed, do screenshots still match? (flag these — don't generate new ones)

### Step 4: Check navigation

If a new documentation page is needed, it must be added to `docs-website/docs.json` in the appropriate navigation group. Read `docs.json` to verify the page is listed.

The navigation is organized into three tabs:
- **Documentation** — concepts, router, studio, control plane, federation, deployments
- **CLI** — all CLI commands organized by resource type
- **Tutorials** — step-by-step guides

### Step 5: Report findings

Tell the user what you found. Be specific:

- **Which doc pages need updating** — list the file paths
- **What needs to change** — describe each update needed (new section, updated example, corrected default value, etc.)
- **Whether new pages are needed** — and where they should go in the navigation
- **Whether screenshots are outdated** — flag these for the user since you can't regenerate them

Then ask the user if they want you to make the documentation updates now.

## Writing Documentation

When writing or updating docs, follow these conventions:

- **Format**: MDX with YAML frontmatter (`title`, `description`, optional `icon` and `sidebarTitle`)
- **Callouts**: Use `<Info>`, `<Note>`, `<Warning>` for important information
- **Images**: Place in `docs-website/images/[topic]/`, reference as `/images/topic/filename.png`
- **Code blocks**: Use language-specific syntax highlighting (```yaml, ```graphql, ```bash, etc.)
- **Internal links**: Use relative paths like `/router/configuration`
- **Style**: Be direct and practical. Lead with what the user needs to do, then explain why.

## Common Pitfalls

- **Forgetting docs.json** — new pages won't appear in the sidebar without a navigation entry
- **Config reference drift** — when adding router config options, the config reference page (`router/configuration.mdx`) must be updated along with any feature-specific page
- **CLI flag docs** — each CLI command page documents all available flags; new flags need to appear there
- **Environment variable docs** — these are often documented both in the config reference and in deployment guides

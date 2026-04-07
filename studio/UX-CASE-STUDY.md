# Cosmo Studio — UX Case Study & Implementation

**Branch:** `feat/ux-case-study`  
**Author:** Philip Lowe  
**Design proposal:** [Figma — Cosmo Studio UX Audit](https://www.figma.com/design/7MlOwTO0Kz0TSOYSvIk1kj/Cosmo-Studio-UX-Audit)

---

## Overview

This branch contains a UX audit of Cosmo Studio and two focused UI improvements
implemented in the `studio/` Next.js app:

1. **Sidebar navigation redesign** — grouped sections with labelled hierarchy
2. **EmptyState component** — reusable component applied across three pages

Both changes are directly tied to audit findings and designed to reduce cognitive
load, improve orientation, and create a more scalable foundation for the product.

---

## What Was Changed

### 1. Sidebar navigation (`studio/src/components/layout/`)

The existing sidebar presented 15 items in a flat list with no meaningful
hierarchy. Items across four distinct contexts — core product features, platform
tooling, team management, and account settings — sat at equal visual weight.

**Changes made:**
- Reorganised the flat nav list into four labelled groups:
  - **Core Product** — Graphs, Subgraphs
  - **Platform & Runtime** — Feature Flags, Policies, Check Extensions, Cache Warmer
  - **Organisation** — Members, Groups, API Keys, Notifications, Webhook History, Usage, Audit log
  - **Settings & Account** — Settings, Invitations, Manage
- Added section labels styled as small uppercase muted text
- Added `Separator` components between each group
- Updated active item styling:
  - Pink tint background using `bg-primary/10`
  - Flush left border bar using `lg:border-l-[3px] border-primary`
  - Right-only border radius using `lg:rounded-l-none lg:rounded-r-md`
  - Active icon inherits `text-primary` via `currentColor`
- Scoped border bar and border radius to desktop (`lg:`) — mobile retains full
  pill shape with `bg-muted` background and `text-foreground` to avoid visual
  conflict with the namespace pill in the mobile header

### 2. EmptyState component (`studio/src/components/empty-state.tsx`)

The existing `EmptyState` component had a fixed height, a small title, and no
support for contextual onboarding content. It was used across 70+ callsites
as a generic placeholder.

**Changes to the component:**
- Added `eyebrow?: string` prop — renders a small uppercase label above the title
- Added `children?: React.ReactNode` prop — preferred slot for page-specific content
- Added `secondaryAction?: { label: string; href: string }` prop — renders a
  secondary bordered link row at the bottom
- Kept `actions` prop for full backward compatibility with all existing callsites
- Replaced fixed `h-[520px]` with `py-16` for flexible content-driven height
- Updated title from `text-lg` to `text-2xl font-semibold` for stronger hierarchy

**Applied to three pages:**

**Graphs** (`studio/src/components/federatedgraphs-cards.tsx`)
- Heading: "Create your first graph"
- Two-card layout — Federated Graph (recommended) and Monograph (alternative)
- Each card has a badge, icon, description, CLI command, and docs link
- Apollo migration demoted to a secondary "OR MIGRATE" row

**Subgraphs** (subgraphs page component)
- Heading: "Add your first subgraph"
- Single primary card explaining what a subgraph is before showing the CLI command
- Secondary "NEED HELP?" row with guide link

**Feature Flags** (feature flags page component)
- Heading: "Create your first feature flag"
- Three numbered steps with pink step circles, plain-English titles and
  descriptions above each CLI command
- Secondary "LEARN MORE" row with docs link

---

## How to Test Changes Locally

1. Make sure the local environment is running (see `CONTRIBUTING.md` for full
   setup instructions)
2. Start the control plane: `make start-cp`
3. Start the studio: `make start-studio`
4. Open [http://localhost:3000](http://localhost:3000) and log in:
   - Email: `foo@wundergraph.com`
   - Password: `wunder@123`

**To test the sidebar:**
- Navigate between pages and verify the four labelled groups are visible
- Check the active state (pink tint, left border bar) on each page
- Resize the browser window to verify mobile nav uses a pill shape with no
  left border bar

**To test the empty states:**
- Visit `/graphs`, `/subgraphs`, and `/feature-flags` — all should show
  the new onboarding layouts
- Verify all existing CLI commands and docs links are unchanged and functional
- Click "Migrate from Apollo" on the Graphs page to confirm the migration
  dialog still works

---

## Trade-offs and Decisions

**What I focused on:**

Navigation and first-use empty states were chosen because they have the highest
impact per change — navigation affects every page and every user, empty states
shape first impressions and new user confidence. Improving these two surfaces
creates a stronger foundation than redesigning isolated UI details.

**What I left out:**

- **Page header hierarchy** — the breadcrumb/title treatment is inconsistent
  across pages but is a larger, more systemic change. Identified in the audit
  as a follow-on improvement.
- **Command palette** — a `⌘K` navigation shortcut would significantly improve
  developer experience for power users but was out of scope for this exercise.
- **Broader empty state rollout** — the `EmptyState` component could be applied
  to Notifications, Webhook History, and other surfaces. The pattern is in place
  and can be extended without further design work.

**Backward compatibility:**

The `EmptyState` component changes are fully backward compatible. The new props
are all optional and the `actions` prop is preserved, meaning all 70+ existing
callsites continue to work without modification.

**Mobile nav:**

The sidebar grouping (section labels, separators) is only visible on desktop.
On mobile the nav renders as a horizontal scroll of pills — section labels are
not shown on mobile as they would not suit the horizontal layout. The active
state uses `bg-muted` and `text-foreground` on mobile to avoid a visual clash
with the namespace pill in the header row.

---

## Design Proposal

The full UX case study — including audit findings, annotated before/after
screens, and design rationale — is in the Figma file linked at the top of
this document.

## Cosmo Studio Navigation & Layout – UX Case Study Checklist

### 1. Setup & Context

- [x] **Confirm local environment is running**
  - [x] Start control plane (`make start-cp`)
  - [x] Start Studio (`make start-studio`)
- [x] **Identify target user flows (via header/sidebar/footer)**
  - [x] “From landing → use sidebar/header to find a specific graph/service → inspect its health”
  - [x] “From anywhere → use sidebar/header to access and change org/project settings; confirm footer links support help/docs”
- [x] **Define success goals (header / footer / sidebar)**
  - [x] Header/sidebar/footer are **more readable** (clear labels, typography, spacing)
  - [x] Navigation structure is **more logical** (grouping, ordering, and context make sense)
  - [x] Shell is **visually better designed** while staying consistent with the design system
  - [x] Unnecessary items, links, or clutter in header/footer/sidebar are **removed or consolidated**

### 2. Audit Current Navigation & Layout

- [x] **Global navigation & IA**
  - [x] List all top-level nav items and destinations
  - [x] Capture how graphs/projects/environments are surfaced
  - [x] Note redundant or confusing entry points
- [x] **Wayfinding & context**
  - [x] Capture current “you are here” cues (active states, titles, breadcrumbs)
  - [x] Note mismatches between nav label and page title/content
  - [x] Identify where users may lose track of org/project/graph context
- [x] **Layout & hierarchy**
  - [x] Screenshot main overview/dashboard, detail, and settings pages
  - [x] Mark what appears primary vs secondary on each
  - [x] List areas where critical information is visually de-emphasised
- [x] **Responsiveness & accessibility**
  - [x] Test shell and sidebar at small/medium/large breakpoints
  - [x] Note any overflow, clipping, or unusable nav on smaller widths
  - [x] Check keyboard focus and basic contrast on nav items

### 3. Prioritise Problems

- [x] **Create issue list**
  - [x] For each finding, write a short problem statement
  - [x] Tag each with impact (High/Med/Low) and effort (S/M/L)
- [x] **Cluster into themes**
  - [x] Navigation clarity & IA
  - [x] Wayfinding & current context
  - [x] Layout density & hierarchy (including footer + scroll issues)
- [x] **Select focus areas**
  - [x] Choose 1–2 themes/surfaces to tackle (e.g. global shell + main overview)
  - [x] Document why they are highest leverage for Cosmo Studio and why footer cleanup was chosen as the first implementation slice

### 4. Design the Improved Navigation & Layout

- [x] **Define design goals & principles**
  - [x] Write 3–5 high-level goals for the nav/layout redesign
  - [x] Capture guiding principles (stable shell, clear context, progressive disclosure)
- [x] **Information architecture**
  - [x] Draft a nav structure (sections, groupings, labels) in Figma/Miro
  - [x] Decide which items live in sidebar vs footer (Legal moved to sidebar “Help & legal”)
- [x] **Layout shell**
  - [x] Design updated shell in Figma (desktop breakpoint)
  - [x] Include sidebar, header, and legal/help section in the shell
  - [x] Capture a second breakpoint / responsive behaviour in screenshots
- [x] **States & edge cases**
  - [x] Show hover/active states for sidebar and legal links
  - [x] Consider empty/first-time state implications in the shell
  - [x] Note how the shell scales with more projects/graphs/features

### 5. Choose Implementation Slice

- [x] **Pick one significant improvement to build**
  - [x] Remove the marketing‑style footer from the Studio shell and relocate its legal/help links into a compact “Help & legal” area (e.g. in the sidebar).
- [x] **Decide scope of affected routes**
  - [x] Apply the change to the shared Studio layout so all pages that previously used the footer now share the cleaner shell.

### 6. Implement Navigation/Layout Changes

- [x] **Locate existing layout components**
  - [x] Identify global layout file(s) used by Studio
  - [x] Find sidebar/top bar/nav components and any shared config
- [x] **Introduce or update layout shell**
  - [x] Remove the marketing-style `Footer` from the shared layout
  - [x] Add a compact “Help & legal” section in the sidebar using existing patterns
- [x] **Implement UI per design system**
  - [x] Reuse existing design system components (buttons, links, typography)
  - [x] Apply spacing, typography, and color tokens consistently
  - [x] Ensure semantic structure: `<nav>`, `<header>`, `<main>`, headings
- [x] **Responsiveness & accessibility**
  - [x] Keep sidebar behaviour consistent on narrow viewports
  - [x] Verify keyboard navigation and visible focus across the shell
  - [x] Check contrast and ARIA attributes for new legal links

### 7. Test, Document, and Submit

- [ ] **Verification**
  - [ ] Run lint and tests, fix introduced issues
  - [ ] Manually walk key flows and verify nav, context, and layout
  - [ ] Spot-check performance and visual polish
- [ ] **Case study write-up**
  - [ ] Document audit findings with screenshots
  - [ ] Summarise prioritisation and chosen focus areas
  - [ ] Explain design decisions and expected impact
- [ ] **Implementation documentation**
  - [ ] Describe implemented changes and how to test them locally
  - [ ] Note trade-offs, limitations, and potential follow-ups
- [ ] **Repository & submission**
  - [ ] Ensure branch `feat/ux-case-study` contains code and docs
  - [ ] Create a PR in your private fork with a clear summary
  - [ ] Share fork + design proposal links and brief summary via email


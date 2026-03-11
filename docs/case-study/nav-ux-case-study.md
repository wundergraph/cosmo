## Cosmo Studio Navigation Case Study – Header, Sidebar, Footer
 - **Link to exercise**: https://www.notion.so/wundergraph/Exercise-Cosmo-Studio-UX-Case-Study-Redesign-2b5b19e0a0ec80b7838ade49f4f46ad1

### 1. Context & Goals

- **Product**: Cosmo Studio (WunderGraph)
- **Scope**: Global navigation shell – **header**, **sidebar**, and **footer**.
- **Primary user flows in scope**:
  - From landing → use sidebar/header to find a specific **graph/service** → inspect its health.
  - From anywhere → use sidebar/header to access and change **org/project settings**; footer supports help/docs/legal as needed.
- **Success goals**:
  - Header/sidebar/footer are **more readable** (clear labels, sensible typography and spacing).
  - Navigation structure is **more logical** (grouping, ordering, and context match user mental models).
  - Shell is **visually improved** while remaining consistent with the existing design system.
  - Unnecessary items or visual noise in header/footer/sidebar are **removed or consolidated**.

---

### 2. Current UX Audit (Header / Sidebar / Footer)

#### 2.1 Sidebar

- **Observation**: The current sidebar presents a long, mostly flat list of items (Graphs, Subgraphs, Feature Flags, Policies, Members, Groups, API Keys, etc.) with minimal visual grouping.
- **Key issues**:
  - Sidebar contains a long, mostly flat list of items with mixed concerns (e.g. graphs, feature flags, members, account, documentation).
  - Sections are not clearly grouped, making it harder to scan and understand where to go for a given task.
  - Some items may be useful but do not need persistent prominence in the main sidebar.
- **Impact**:
  - Users take longer to locate the right section for common tasks.
  - Cognitive load increases when scanning the nav, especially for new users.
- **Evidence (screenshots)**:
  - `docs/case-study/Screenshot 2026-03-11 082859.png` (full-screen audit with red tickets highlighting issues).

#### 2.1.1 Sidebar responsiveness (small viewports)

- **Observation**: On smaller viewports, the sidebar is moved to the top of the page as a horizontal, scrollable bar.
- **Key issues**:
  - When converted into a horizontal bar, the already dense list of items becomes even harder to scan and understand.
  - The layout change does not introduce additional structure; it simply reflows the same complexity into a less readable pattern.
- **Impact**:
  - Navigation becomes more confusing on smaller screens, undermining responsiveness and making it harder to complete key flows.
- **Evidence (screenshots)**:
  - `docs/case-study/Screenshot 2026-03-11 082902.png` (small-screen audit with red tickets).

#### 2.2 Header

- **Observation**: The header contains the WunderGraph logo, a namespace “chip”, breadcrumb-like labels, a graph filter, and a primary “Create” action.
- **Key issues**:
  - Header does not clearly reinforce **where** the user is (org → project → graph/environment).
  - The namespace switcher and breadcrumb affordances are present but their value is unclear (“Why do we have a switcher?”).
  - Header space is not used to surface primary context or actions for graphs/services.
- **Impact**:
  - Users may be unsure which graph/environment they are operating on when making changes.
  - Key actions feel disconnected from context, increasing the chance of navigation back‑and‑forth.
- **Evidence (screenshots)**:
  - `docs/case-study/Screenshot 2026-03-11 082859.png` (header issues highlighted).

#### 2.2.1 Header controls & icon affordances

- **Observation**: On smaller screens, an icon that visually resembles a burger/menu icon is shown in the header.
- **Key issues**:
  - The icon’s appearance suggests that it will open a navigation menu, but instead it closes the content area.
  - This mismatch between visual affordance and behavior can cause user confusion and accidental loss of context.
- **Impact**:
  - Users may hesitate to interact with the icon or be surprised by its effect, reducing trust in the header controls.
- **Evidence (screenshots)**:
  - `docs/case-study/Screenshot 2026-03-11 082902.png` (icon behaviour highlighted).

#### 2.3 Footer

- **Observation**: The app uses a full, marketing‑style footer with privacy, terms, and other legal links that sits below a `100vh` content area.
- **Key issues**:
  - Heavy, website‑style footer is more suited to marketing pages than an authenticated app.
  - Content area is set to `100vh`, so the footer is often pushed off‑screen, creating **double scrollbars**.
  - Important app content competes with a large, rarely used block at the bottom.
- **Impact**:
  - Visual noise and vertical space usage don’t match the needs of in‑app workflows.
  - Double scrolling harms usability and makes the layout feel less polished.
- **Evidence (screenshots)**:
  - `docs/case-study/Screenshot 2026-03-11 082859.png` (footer and double‑scroll issue).

---

### 3. Problem Prioritisation

- **Theme 1 – Navigation clarity & IA (Sidebar)**  
  - _Problem statement_: The sidebar mixes unrelated items in a flat list, making it hard to scan and understand where to perform specific tasks.
  - _Impact_: High – affects almost every flow; the sidebar is a primary entry point.
  - _Effort_: Medium/High – meaningful improvements require product/domain context to regroup navigation in a way that matches real user mental models.

- **Theme 2 – Context & wayfinding (Header)**  
  - _Problem statement_: The header doesn’t clearly convey org/project/graph context or why controls like the switcher exist.
  - _Impact_: High – confusion about current context can lead to mistakes and slower workflows.
  - _Effort_: Medium/High – changing header structure and semantics without direct input from product/engineering risks misrepresenting key concepts.

- **Theme 3 – Visual noise & layout issues (Footer + scrolling)**  
  - _Problem statement_: A large, website‑style footer plus a `100vh` content area creates double scrolling and visual clutter, and surfaces legal/marketing links with the same visual weight as in‑app content.
  - _Impact_: Medium/High – immediately affects perceived polish and day‑to‑day usability, but is largely independent of domain modelling.
  - _Effort_: Low/Medium – can be improved by removing the footer from the main shell and relocating its links to an appropriate low‑priority area (e.g. sidebar “Help & legal” section).

_Rationale for focus_: In the context of a time‑boxed exercise and without access to product owners or domain experts, re‑architecting the sidebar IA and header semantics would be largely speculative. Instead, I focus implementation on the footer + layout theme, which is clearly misaligned with an authenticated product experience and can be improved with low risk and high visual/UX payoff.

---

### 4. Proposed Design Improvements

#### 4.1 Sidebar – Future IA Opportunities (not implemented in this iteration)

- **Intent (non‑implemented)**:
  - Long‑term, group nav items into clear, labelled sections that map to how users think about Cosmo (e.g. **Graphs & Routing**, **Operations**, **Access & Security**, **Account**).
  - Reduce persistent sidebar items to those needed frequently; move infrequent actions deeper into settings or secondary menus.
- **Why this is deferred**:
  - Without direct input from product/engineering, any new grouping would be speculative and could make navigation worse for existing users.
  - I instead document concrete issues and outline possible directions, leaving structural IA changes for a follow‑up iteration with stakeholders.

#### 4.2 Header – Future Context Bar Improvements (not implemented in this iteration)

- **Intent (non‑implemented)**:
  - Make org/project/graph/environment context immediately visible and stable, with a clearer relationship between breadcrumbs, namespace, and graph/environment selectors.
  - Align primary actions with the current context (e.g. “Create graph” when viewing Graphs).
- **Why this is deferred**:
  - Reframing header semantics requires agreement on domain concepts (orgs, graphs, environments, workspaces) that is hard to infer just from UI.
  - To avoid misrepresenting core concepts, I leave header restructuring as a recommended future improvement rather than part of this implementation.

#### 4.3 Footer – Remove Marketing‑Style Footer and Relocate Links (implemented)

- **Goals**:
  - Remove the heavy, website‑style footer from the authenticated app shell to reduce visual noise and double scrolling.
  - Keep privacy/terms/help links available in a more app‑appropriate, low‑priority location.
  - Make the shell feel more like a focused console and less like a marketing site.
- **Key changes (conceptual)**:
  - Remove the persistent footer component from the main Studio layout.
  - Move existing footer links (Privacy Policy, Trust Center, Website Terms, Cosmo Managed Service Terms, Cookie Policy) into a small “Help & legal” area in the sidebar or account/help section, using standard nav/link styles.
  - Ensure there is a single main scrollable region for app content, without a competing footer scroll area.
- **Design artefacts**:
  - Figma frames: “Footer – current vs footer‑free shell with ‘Help & legal’ sidebar section”.
  - Notes on how the relocated links appear on small screens and how they are distinguished from primary navigation.
  - Screenshot: `docs/case-study/Screenshot 2026-03-11 135025.png` (implemented shell with footer removed and Legal section in the sidebar).

---

### 5. Implementation Plan (What I Will Build)

- **Chosen implementation slice**:  
  Implement a **cleaner Studio shell by removing the marketing‑style footer and relocating its links**:
  - Remove the global footer component from the main layout so content no longer competes with a large website footer.
  - Create a compact “Help & legal” section using existing sidebar/link styles and move Privacy Policy, Trust Center, Website Terms of Use, Cosmo Managed Service Terms, and Cookie Policy there.
  - Ensure there is a single main scrollable area and that legal/help links remain easy to discover without dominating the UI.

- **Target pages/routes**:
  - All Studio pages that currently render the footer via the shared layout (e.g. Graphs overview and related pages), so the shell is consistent.

- **Technical approach**:
  - Locate shared layout component(s) that render `Footer` (e.g. in `layout` components or `_app.tsx`) and remove or gate that usage.
  - Keep `Footer` either deleted or reduced to a local component used only where explicitly required (if any).
  - Add a “Help & legal” section to the sidebar or account area using existing design system primitives (nav links, typography, spacing).

---

### 6. Risks, Trade‑offs, and Scalability

- **Risks / trade‑offs**:
  - Changing the IA of the sidebar may temporarily disorient existing users; mitigated by keeping labels familiar and changes incremental.
  - A more opinionated header context bar could reveal inconsistencies in how backend concepts (orgs/projects/graphs) are modeled; may require follow‑up work.
  - Slimming down the footer requires confirming that all compliance/legal needs are still met.
  - Local environment performance (WSL + Docker + multiple services) meant that restarting `make start-cp` / `make start-studio` to pick up UI changes was slow, so I optimised for a smaller, high‑impact implementation slice rather than frequent deep refactors.

- **Scalability**:
  - Sidebar grouping is designed to accommodate **more graphs/services and future features** by adding items within well‑named sections.
  - Header context bar can extend to additional dimensions (e.g. environments, teams) without redesigning the shell.
  - Footer pattern remains minimal even as new links are added (e.g. placed in a condensed “More”/“Legal” area).

---

### 7. Links & Artefacts


- **Miro audit board**: [Miro board](https://miro.com/app/board/uXjVG0Pnsqs=/)
- **Key screenshots in this repo**:
  - `docs/case-study/screenshots/Screenshot-full-screen.png`
  - `docs/case-study/screenshots/Screenshot-small-screen.png`
- **Figma – Simple clean sidebar**: [Clean Sidebar Dropdown Menu](https://www.figma.com/make/OoCmK2AUgz896ogGQMsW4C/Clean-Sidebar-Dropdown-Menu?p=f&t=ibyypbNkY1kFbAPt-0)
- **Figma – Minimalist**: [Clean Sidebar Dropdown Menu ](https://www.figma.com/make/nvYj6Z8LA0ETwgtVm9u0dl/Clean-Sidebar-Dropdown-Menu--Copy-?p=f&t=jZjLu49B7uM3tCXx-0)

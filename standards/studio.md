---
path: "studio/**"
---

# Studio Standards

- For operations components, use `operationsData?.operations` as the sole dependency in useEffect hooks when reacting to operation data changes (#2331)
- In client usage tables, precision loss for request counts is acceptable as values won't reach problematically high numbers (#2331)
- When displaying operation IDs in UI, show only the first 4-6 characters for consistency with operations overview patterns (#2474)
- In delete dialogs for persisted operations, emphasize analytics value with messaging like "If you are not sending us analytics, we cannot guarantee that existing clients won't break" (#2553)
- Use `localStorage` safely knowing it's domain-specific - GraphiQL headers won't affect router playground unless running under the same domain (#2446)
- For breaking change UI copy, use specific messaging: "Toggle to prevent future checks from treating this change to {path} as breaking for this operation" (#2461)
- In operations override UI, use clear enable/disable language: "Enable overrides so future checks will not fail on breaking listed changes" (#2461)
- When checking current organization context, always handle undefined cases safely even though it should never be null after session loads (#2161)
- For linter config accordions, disable expansion when the parent linter is disabled to prevent editing of nested dropdowns (#2574)
- Preserve existing tag input behaviors unless specifically requested to change - avoid modifying established interaction patterns (#2468)
- In trace detail components, prefer manual indentation adjustments over automatic prettier reformatting for React JSX nesting (#2235)
- For large SVG backgrounds in popups and feature announcements, ensure file size is justified by the visual requirement (#2182)

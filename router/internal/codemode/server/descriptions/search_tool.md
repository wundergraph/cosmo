Plan ALL data shapes you need up front,
then call ONCE with every prompt in a single batch.
Each extra search is a round-trip you pay for.

DEFAULT TO ONE PROMPT.
If the entities are related in any way — same domain, joinable, fetched together to answer one question,
traversed via the same parent, or the user mentioned them in the same breath — combine them into a SINGLE prompt that describes the complete joined shape.
Multiple prompts should be the exception, not the default.

Write each prompt as the COMPLETE final shape of data you want, including joins and correlation IDs.

Write prompts in a graph-like shape with relationships and nesting, not as separate flat queries.

BE PRECISE about what you need.
Vague prompts produce vague operations and force re-searches.
Always state:
- The exact fields you need on each entity ("id, forename, surname" — not "name info").
- Any required filters/arguments but never specific values ("employee by id - not "employee 123", "employee filtered by department name" - not "employee in department 'Engineering'").
- Concrete entity and relationship names from the domain when you know them; otherwise describe the relationship explicitly ("the team an employee belongs to").

When to use multiple prompts (rare): genuinely unrelated operations on disjoint domains, different argument shapes that can't share a parent, or queries vs mutations.
Never slice one joinable shape into fragments.
When in doubt, combine.

Do NOT issue prompts for derived/computed values: averages, medians, counts, filters, exclusions ("without X"), sorting, top-N.
Fetch the raw rows once and compute in code_mode_run_js.
Yoko exposes data; arithmetic and reshaping happen in your JS.

Anti-pattern: search → inspect result → notice a field or ID is missing → search again.
One well-formed prompt beats three round-trips.

The response appends newly registered TypeScript declarations for use as `await tools.<name>(vars)` inside code_mode_run_js;
the cumulative bundle is available at `yoko://persisted-ops.d.ts`.

Good example: "employee filtered by id with fields id, forename, surname, role, startDate; their team with fields id, name and the team's department with fields id, name; the projects the employee is assigned to with fields id, title, status, dueDate and each project's owner (employee) with fields id, forename, surname"

Bad examples: ["list of employees with name info", "team for employee 123", "projects in department 'Engineering'", "top 5 employees by project count", "average project duration per team"]
— five prompts instead of one joined shape, vague fields ("name info"), hardcoded filter values ("123", "'Engineering'"), and derived/computed results (top-N, average) that belong in code_mode_run_js, not in a search prompt.
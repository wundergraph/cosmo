Generate candidate GraphQL operations from a natural-language prompt via Yoko.

Use this when a developer asks you to draft a GraphQL query from a description ("a query that gets all characters with their episodes"). The tool calls Yoko with the prompt and returns the resulting GraphQL document(s) as plain text — nothing more.

Response contract:

- The response body is **zero or more named GraphQL operations**, separated by blank lines, and nothing else.
- Every operation is **named** (e.g. `query GetCharacters { ... }`) — anonymous shorthand (`{ ... }`) is filtered out.
- Each operation is preceded by a GraphQL block-string description (`"""Do Foo"""`) summarising what the operation does, derived from the prompt and the selected fields.
- Each operation is a complete `query` or `mutation` document — directly copy-paste-able into a GraphQL client.
- An empty response means Yoko could not produce any operation for the prompt; restate it with concrete entity/field names from the schema and try once more.
- This is a _preview_: nothing is written to session storage and the operations do **not** become callable from `code_mode_run_js`.

After receiving the response, present the operations to the user — if the client supports MCP elicitation (`elicitation/create`), use it to ask the user which one they want. Otherwise list them and ask in chat. Do not pick on their behalf.

Write the prompt as the COMPLETE final shape of data you want, including joins and correlation IDs:

- State the exact fields you need on each entity ("id, forename, surname" — not "name info").
- Describe filters by argument name, never by literal value ("employee filtered by id" — not "employee 123").
- Use concrete entity and relationship names from the domain when you know them; otherwise describe the relationship explicitly.
- Do NOT ask Yoko for derived/computed values (averages, counts, top-N). Fetch the raw rows and compute downstream.

This tool is for _authoring assistance_. If you need an operation you can execute, use `code_mode_search_tools` instead — that registers the operation in the session bundle so `code_mode_run_js` can call it as `tools.<name>(vars)`.

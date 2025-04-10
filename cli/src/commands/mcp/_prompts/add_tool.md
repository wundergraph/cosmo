# Add Tool Workflow

Instructions to add a new tool to the Cosmo MCP server

## Step 1: Add the tool to the `tools` directory

Add a new file to the `tools` directory, e.g. `cli/src/commands/mcp/tools/my-tool.ts`.
The tool name should be in snake_case and can be typically derived from the instructions of the use case.

Tool name template: `<use_case>`

## Step 2: Implement the tool

Typically, the tool can be implemented by copying the logic from existing cli commands.
You can find them in the `cli/src/commands/` directory.

## Step 3: Export the tool

Add an entry to the `cli/src/commands/mcp/tools/index.ts` file to export the tool.

## Step 4: Register the tool

Add the tool to the `registerTools` function in the `cli/src/commands/mcp/index.ts` file.

## Step 5: Update the README

Update the `cli/src/commands/mcp/README.md` file to reflect the new tool.

Example:

```md
- **`schema-change-proposal-workflow`**: Generates a step-by-step guide or set of instructions for making a specific schema change to a Supergraph safely and effectively.
  - _Use Case_: Assisting developers in planning and executing schema changes.
```

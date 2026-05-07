package mcpserver

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"

	"github.com/modelcontextprotocol/go-sdk/mcp"
	"go.uber.org/zap"

	"github.com/wundergraph/cosmo/router/internal/codemode/harness"
	"github.com/wundergraph/cosmo/router/internal/codemode/sandbox"
	"github.com/wundergraph/cosmo/router/internal/codemode/storage"
)

const codeModeToolName = "code_mode_run_js"

// codeModeToolDescription returns the LLM-facing description of code_mode_run_js.
// opNames are the operations bound as tools.<name>(vars). Variable shapes and
// return types are NOT duplicated here — they live on the per-op MCP tools the
// model already sees alongside this one. We only list bound names + the rules
// the model can't infer (sandbox shape, restrictions, return-value discipline).
func codeModeToolDescription(opNames []string) string {
	body := `Run an async arrow function in a V8 sandbox where every operation tool on this MCP server is pre-bound as ` + "`tools.<OperationName>(vars)`" + `. Compose, batch, or aggregate multiple ops in ONE call so the calling model only ever sees the final answer — not the raw payloads.

# Shape (strict)

` + "`source`" + ` MUST be exactly one expression: an async arrow function. The harness invokes it for you.

CORRECT:
` + "```" + `js
async () => {
  const r = await tools.SomeOp({ id: 1 });
  return r.data;
}
` + "```" + `

WRONG — these all fail with ShapeCheck or TranspileError:
- top-level await:        ` + "`const r = await tools.X(); return r;`" + `
- IIFE:                   ` + "`(async () => {...})()`" + `
- non-arrow root:         ` + "`function main(){...}`" + `, ` + "`tools.X().then(...)`" + `
- multiple statements:    ` + "`const x = 1; async () => x;`" + `
- import/export at top:   ` + "`import x from 'y'; async () => {}`" + `

# Tool bindings — refer to the per-op MCP tools

Every operation tool you see on this server is also bound inside the sandbox:

  tools.<OperationName>(vars) → Promise<{ data, errors? }>

` + "`vars`" + ` matches the per-op MCP tool's ` + "`inputSchema`" + ` exactly. ` + "`data`" + ` is the GraphQL response data shape — call ` + "`get_operation_info({operationName: '<name>'})`" + ` directly (outside code_mode) if you need to see the full query body.

DO NOT GUESS NAMES — only the ones below are bound.

` + buildBoundList(opNames) + `

# Helpers in scope

- ` + "`notNull(value, msg?)`" + ` — throws if null/undefined.
- ` + "`compact(value)`" + ` — recursively strips null/undefined from objects/arrays.
- ` + "`Promise.all([...])`" + ` for parallel calls.
- Standard JS array methods, destructuring, optional chaining.

# Sandbox restrictions

- No ` + "`console`" + ` (throws ConsoleUnavailable). Return diagnostics in the result instead.
- ` + "`Date.now()` returns 0, `Math.random()` returns 0" + ` — pinned for determinism.
- No ` + "`eval` / `Function` / `import` / `require`" + `; no arbitrary HTTP.
- ~256 ` + "`tools.*`" + ` calls per execution; ~64 KB result cap.

# Output envelope

Success:  ` + "`{ \"result\": <returnValue>, \"truncated\": false, \"warnings\": [] }`" + `
Failure:  ` + "`{ \"result\": null, \"error\": { \"name\", \"message\", \"stack\" } }`" + `

Common error names: ShapeCheck, TranspileError, InputTooLarge, HostCallLimitExceeded, ConsoleUnavailable.

# Return-value discipline (the whole point of this tool)

Every byte you return is context the calling model pays tokens for on the next turn. **Collapse data INSIDE the sandbox.**

1. Return the answer, not the data. "How many" → a number, not the list.
2. Don't enrich helpfully. No names, IDs, samples, or metadata the user didn't ask for.
3. Aggregate before returning. Count/sum/group/filter in JS, not in the model.
4. If a list IS the answer, project to only the fields needed: ` + "`{ id, name }`" + ` not the full object.
5. One op, no transform → use the per-op tool directly. code_mode is overhead unless you're transforming.

**Worked example — "how many countries speak Spanish":**

GOOD:
` + "```" + `js
async () => {
  const r = await tools.GetLanguage({ code: 'es' });
  return r.data?.language?.countries?.length ?? 0;
}
// → 31
` + "```" + `

BAD (every country name leaks back into the model's context):
` + "```" + `js
async () => {
  const r = await tools.GetLanguage({ code: 'es' });
  return {
    languageName: r.data?.language?.name,                              // not asked for
    countryCount: r.data?.language?.countries?.length,
    countries:    r.data?.language?.countries.map(c => c.name),        // pollution
  };
}
// → { languageName: "Spanish", countryCount: 31, countries: [...31 strings...] }
` + "```" + `

If the user asks a follow-up like "name them", that's a separate code_mode call. Don't pre-fetch.`

	return body
}

// buildBoundList renders the list of bound operation names. We surface only
// names — variable/return shapes are already in the per-op MCP tools' own
// descriptions and inputSchemas, which the model sees alongside this one.
func buildBoundList(names []string) string {
	if len(names) == 0 {
		return "Bound names: (none — no operations are loaded for this server)"
	}
	var b strings.Builder
	b.WriteString("Bound names:\n")
	for _, n := range names {
		b.WriteString("  - tools.")
		b.WriteString(n)
		b.WriteString("\n")
	}
	return b.String()
}

// codeModeRunJSInput is the JSON input schema for the code_mode_run_js tool.
type codeModeRunJSInput struct {
	Source string `json:"source"`
}

// ensureCodeModeSandbox lazily creates the V8 sandbox bound to this server's
// upstream GraphQL endpoint. The sandbox is reused across reloads — only the
// op catalog (looked up via StorageLookup) needs to refresh.
func (s *GraphQLSchemaServer) ensureCodeModeSandbox() (*sandbox.Sandbox, error) {
	if s.codeModeSandbox != nil {
		return s.codeModeSandbox, nil
	}
	sb, err := sandbox.New(sandbox.Config{
		RouterGraphQLEndpoint: s.routerGraphQLEndpoint,
		StorageLookup:         s.codeModeStorageLookup,
		Logger:                s.logger.With(zap.String("component", "code_mode_sandbox")),
	})
	if err != nil {
		return nil, fmt.Errorf("create code mode sandbox: %w", err)
	}
	s.codeModeSandbox = sb
	return sb, nil
}

// codeModeStorageLookup adapts the file-loaded operation catalog to the
// storage.SessionOp shape expected by the sandbox host. SessionID is ignored —
// each server has a single, file-driven catalog shared across all calls.
func (s *GraphQLSchemaServer) codeModeStorageLookup(_ context.Context, _ string, name string) (storage.SessionOp, bool, error) {
	if s.operationsManager == nil {
		return storage.SessionOp{}, false, nil
	}
	op := s.operationsManager.GetOperation(name)
	if op == nil {
		return storage.SessionOp{}, false, nil
	}
	return storage.SessionOp{
		Name:        op.Name,
		Body:        op.OperationString,
		Kind:        operationKindFromType(op.OperationType),
		Description: op.Description,
	}, true, nil
}

func operationKindFromType(opType string) storage.OperationKind {
	if opType == "mutation" {
		return storage.OperationKindMutation
	}
	return storage.OperationKindQuery
}

// codeModeToolDescriptor builds the code_mode_run_js MCP tool. Variable shapes
// and return types are NOT inlined here — the model sees those on the per-op
// MCP tools that share this server. Only the bound names + sandbox/usage rules
// are described to keep this tool's description lean.
func (s *GraphQLSchemaServer) codeModeToolDescriptor() *mcp.Tool {
	ops := s.operationsManager.GetFilteredOperations()
	names := make([]string, 0, len(ops))
	for _, op := range ops {
		names = append(names, op.Name)
	}

	desc := codeModeToolDescription(names)

	inputSchema := map[string]any{
		"type": "object",
		"properties": map[string]any{
			"source": map[string]any{
				"type":        "string",
				"description": "A single async arrow function expression. MUST be of the form `async () => { ... }`. Do NOT invoke it (no trailing `()`), do NOT use IIFE wrappers like `(async () => {...})()`, do NOT use top-level await, do NOT use multiple statements. The harness invokes the arrow.",
			},
		},
		"required":             []string{"source"},
		"additionalProperties": false,
	}

	return &mcp.Tool{
		Name:        codeModeToolName,
		Description: desc,
		InputSchema: inputSchema,
		Annotations: &mcp.ToolAnnotations{
			Title: "Code Mode (compose ops in JS)",
		},
	}
}

// handleCodeModeRunJS executes user-supplied JS/TS in a V8 sandbox where this
// server's loaded GraphQL operations are bound as tools.<name>(vars).
func (s *GraphQLSchemaServer) handleCodeModeRunJS() func(ctx context.Context, request *mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	return func(ctx context.Context, req *mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		var input codeModeRunJSInput
		if req != nil && req.Params != nil && len(req.Params.Arguments) > 0 {
			if err := json.Unmarshal(req.Params.Arguments, &input); err != nil {
				return codeModeErrorResult("source must be a string: " + err.Error()), nil
			}
		}
		if input.Source == "" {
			return codeModeErrorResult("source is required"), nil
		}

		sb, err := s.ensureCodeModeSandbox()
		if err != nil {
			return codeModeErrorResult(err.Error()), nil
		}

		ops := s.operationsManager.GetFilteredOperations()
		names := make([]string, 0, len(ops))
		for _, op := range ops {
			names = append(names, op.Name)
		}

		pipeline := &harness.Pipeline{
			Sandbox:        sb,
			MaxInputBytes:  64 * 1024,
			MaxResultBytes: 64 * 1024,
		}

		var headers http.Header
		if h, hErr := headersFromContext(ctx); hErr == nil {
			headers = h
		}

		resp, err := pipeline.Execute(ctx, harness.PipelineRequest{
			SessionID:      s.graphName,
			ToolNames:      names,
			Source:         input.Source,
			RequestHeaders: headers,
			ApprovalGate:   sandbox.AutoApprove,
		})
		if err != nil {
			return codeModeErrorResult("execute failed: " + err.Error()), nil
		}

		return &mcp.CallToolResult{
			Content: []mcp.Content{&mcp.TextContent{Text: string(resp.Encoded)}},
		}, nil
	}
}

func codeModeErrorResult(msg string) *mcp.CallToolResult {
	return &mcp.CallToolResult{
		IsError: true,
		Content: []mcp.Content{&mcp.TextContent{Text: "code_mode_run_js: " + msg}},
	}
}

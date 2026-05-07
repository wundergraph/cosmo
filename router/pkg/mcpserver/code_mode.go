package mcpserver

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/modelcontextprotocol/go-sdk/mcp"
	"go.uber.org/zap"

	"github.com/wundergraph/cosmo/router/internal/codemode/harness"
	"github.com/wundergraph/cosmo/router/internal/codemode/sandbox"
	"github.com/wundergraph/cosmo/router/internal/codemode/storage"
	"github.com/wundergraph/cosmo/router/internal/codemode/tsgen"
)

const codeModeToolName = "code_mode_run_js"

// codeModeToolDescription returns the LLM-facing description of code_mode_run_js.
// The TS bundle is appended at the end so the model sees the typed catalog of
// available tools.<name>(vars) bindings inline with the usage rules.
func codeModeToolDescription(tsBundle string) string {
	const prelude = `Run a single async arrow function in a V8 sandbox where every operation on this MCP server is pre-bound as ` + "`tools.<name>(vars)`" + `.

Use this to compose, batch, transform, or aggregate multiple operations in ONE call instead of issuing N separate MCP tool calls — fewer round-trips, smaller token cost, and you keep intermediate results in JS instead of streaming them back to the model.

# THE ONLY ACCEPTED SHAPE

The ` + "`source`" + ` argument MUST be exactly one expression: an async arrow function. The harness invokes it for you — do NOT call it yourself.

CORRECT:
` + "```" + `js
async () => {
  const a = await tools.someOp({ id: 1 });
  return a.data;
}
` + "```" + `

WRONG (every one of these will fail with ShapeCheck or TranspileError):
` + "```" + `js
// X — top-level await
const r = await tools.someOp({}); return r;

// X — IIFE (calling the arrow yourself)
(async () => { ... })()

// X — non-arrow root (function declaration, .then chain, plain expression)
function main() { ... }
tools.someOp({}).then(r => r.data)

// X — multiple top-level statements
const x = 1; async () => x;

// X — import/export at the top
import { foo } from 'bar'; async () => {}
` + "```" + `

# WHAT YOU CAN DO INSIDE THE ARROW

- ` + "`await tools.<name>(vars)`" + ` — call any operation in the typed catalog below. Returns ` + "`{ data: T | null, errors?: GraphQLError[] }`" + `.
- ` + "`Promise.all([...])`" + ` — fan out independent calls in parallel.
- Standard JS: array methods (map/filter/reduce), destructuring, template strings, spread, optional chaining.
- ` + "`notNull(value, msg?)`" + ` — throws if value is null/undefined; otherwise returns it. Use to assert required fields.
- ` + "`compact(value)`" + ` — recursively strips null/undefined from objects and arrays.

# SANDBOX RESTRICTIONS (read these — they bite)

- ` + "`console.log` is NOT available" + ` — touching it throws ConsoleUnavailable. Surface diagnostics by returning them, e.g. ` + "`return { result, debug: { count, sample } }`" + `.
- ` + "`Date.now()` returns 0 and `Math.random()` returns 0" + ` — pinned for determinism. Don't rely on them.
- No ` + "`eval` / `Function` constructor / `import` / `require`" + ` — sandbox is module-free and code-injection-free.
- Tool invocation cap (~256 calls) and result-size cap (~64 KB JSON). Stay tight; aggregate before returning.
- HTTP/network is only available indirectly through ` + "`tools.<name>`" + `; you cannot fetch arbitrary URLs.

# WHAT THE OUTPUT LOOKS LIKE

A JSON envelope is returned (as a string in the MCP TextContent):
` + "```" + `json
{ "result": <whatever your arrow returned>, "truncated": false, "warnings": [...] }
` + "```" + `

Or on failure:
` + "```" + `json
{ "result": null, "error": { "name": "...", "message": "...", "stack": "...", "cause": ... } }
` + "```" + `

Common error names: ` + "`ShapeCheck`" + ` (your source isn't a single async arrow), ` + "`TranspileError`" + ` (esbuild rejected the TS), ` + "`InputTooLarge`" + `, ` + "`HostCallLimitExceeded`" + `, ` + "`ConsoleUnavailable`" + `.

# WHEN TO USE THIS TOOL

Reach for ` + "`code_mode_run_js`" + ` instead of separate per-op tool calls when you need:

- **Aggregation** — sum/count/reduce across results without piping data back through the model.
  ` + "`async () => { const r = await tools.GetLanguage({code:'fr'}); return r.data?.language?.countries?.length ?? 0; }`" + `

- **Filtering / mapping** — get a list, transform/select fields locally.
  ` + "`async () => { const r = await tools.SearchAnime({search:'Cowboy'}); return r.data?.Page.media.map(m => ({id: m.id, title: m.title.romaji})); }`" + `

- **Parallel batching** — multiple independent ops in one call.
  ` + "`async () => { const [a, b] = await Promise.all([tools.GetA({}), tools.GetB({})]); return { a: a.data, b: b.data }; }`" + `

- **Chaining** — output of one op feeds the next.
  ` + "`async () => { const m = notNull((await tools.SearchAnime({search:'Bebop'})).data?.Page.media[0]); return tools.GetMediaDetails({id: m.id}); }`" + `

- **Aggregating before returning** — avoid blowing the result-size cap by summarizing.
  ` + "`async () => { const r = await tools.GetCountries({}); return { count: r.data?.countries.length, sample: r.data?.countries.slice(0,3) }; }`" + `

If you only need to call one op once, just use the dedicated per-op tool — code_mode is overhead.

# AVAILABLE OPERATIONS (TypeScript signatures)

The catalog below shows every binding on ` + "`tools.<name>`" + `. Variable shapes and return types are pulled from this server's GraphQL schema:

`

	if tsBundle == "" {
		return prelude + "```ts\n// (no operations loaded — nothing to call)\n```"
	}
	return prelude + "```ts\n" + tsBundle + "\n```"
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

// codeModeToolDescriptor builds the code_mode_run_js MCP tool, with a TS bundle
// in the description so the LLM sees the typed shapes of every tools.<name> binding.
func (s *GraphQLSchemaServer) codeModeToolDescriptor() *mcp.Tool {
	ops := s.operationsManager.GetFilteredOperations()
	sessionOps := make([]storage.SessionOp, 0, len(ops))
	for _, op := range ops {
		sessionOps = append(sessionOps, storage.SessionOp{
			Name:        op.Name,
			Body:        op.OperationString,
			Kind:        operationKindFromType(op.OperationType),
			Description: op.Description,
		})
	}

	bundle, err := tsgen.RenderBundle(sessionOps, s.operationsManager.GetSchema(), 32*1024)
	if err != nil {
		s.logger.Warn("code_mode: failed to render TS bundle for tool description", zap.Error(err))
		bundle = ""
	}

	desc := codeModeToolDescription(bundle)

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
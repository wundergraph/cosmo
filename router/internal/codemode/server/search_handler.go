package server

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"

	"github.com/modelcontextprotocol/go-sdk/mcp"
	yokov1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/code_mode/yoko/v1"
	"github.com/wundergraph/cosmo/router/internal/codemode/storage"
	"go.uber.org/zap"
)

const (
	maxSearchPrompts    = 20
	noOperationsMessage = "// yoko returned no operations for these prompts. Restate with concrete entity/field names."
)

type searchAPIInput struct {
	Prompts []string `json:"prompts"`
}

type legacyCatalogueOperation struct {
	Name            string `json:"name"`
	Body            string `json:"body"`
	Kind            string `json:"kind"`
	Description     string `json:"description"`
	VariablesSchema string `json:"variables_schema,omitempty"`
}

type legacyCatalogueResponse struct {
	Operations  []legacyCatalogueOperation `json:"operations"`
	Unsatisfied []string                   `json:"unsatisfied,omitempty"`
	Truncated   bool                       `json:"truncated,omitempty"`
}

func (s *Server) handleSearchAPI(ctx context.Context, req *mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	ctx = contextWithSessionFromExtra(ctx, req.GetExtra())

	prompts, validationErr := decodeSearchPrompts(req)
	if validationErr != nil {
		return toolErrorResult(validationErr.Error()), nil
	}

	if s.sessionStateless {
		return s.handleSearchStateless(ctx, prompts), nil
	}

	sessionID := SessionIDFromContext(ctx)
	if sessionID == "" {
		s.warnMissingSessionIDOnce()
		return s.handleSearchStateless(ctx, prompts), nil
	}

	key := searchSingleFlightKey(sessionID, prompts)
	value, _, _ := s.searchGroup.Do(key, func() (any, error) {
		return s.handleSearchStateful(ctx, sessionID, prompts), nil
	})
	return value.(*mcp.CallToolResult), nil
}

func decodeSearchPrompts(req *mcp.CallToolRequest) ([]string, error) {
	var input searchAPIInput
	if req != nil && req.Params != nil && len(req.Params.Arguments) > 0 {
		if err := json.Unmarshal(req.Params.Arguments, &input); err != nil {
			return nil, errors.New("code_mode_search_tools: prompts must be a non-empty array of strings")
		}
	}

	if len(input.Prompts) == 0 {
		return nil, errors.New("code_mode_search_tools: prompts must be a non-empty array of strings")
	}
	if len(input.Prompts) > maxSearchPrompts {
		return nil, fmt.Errorf("too many prompts: %d (max 20) — pass all prompts in one call", len(input.Prompts))
	}
	for i, prompt := range input.Prompts {
		if strings.TrimSpace(prompt) == "" {
			return nil, fmt.Errorf("code_mode_search_tools: prompt at index %d is empty", i)
		}
	}
	return input.Prompts, nil
}

func (s *Server) handleSearchStateless(ctx context.Context, prompts []string) *mcp.CallToolResult {
	resolution, err := s.searchYoko(ctx, prompts)
	if err != nil {
		return toolErrorResult(fmt.Sprintf("code_mode_search_tools: yoko search failed: %v", err))
	}

	catalogue := make([]legacyCatalogueOperation, 0, len(resolution.GetQueries()))
	for _, q := range resolution.GetQueries() {
		kind, ok := operationKindLabel(q.GetOperationType())
		if !ok {
			s.logger.Warn("code_mode_search_tools dropped unsupported operation kind",
				zap.String("name", q.GetOperationName()),
				zap.String("kind", q.GetOperationType()),
			)
			continue
		}
		catalogue = append(catalogue, legacyCatalogueOperation{
			Name:            storage.ShortSHA(q.GetDocument()),
			Body:            q.GetDocument(),
			Kind:            kind,
			Description:     q.GetDescription(),
			VariablesSchema: q.GetVariablesSchema(),
		})
	}

	response := legacyCatalogueResponse{
		Operations:  catalogue,
		Unsatisfied: unsatisfiedReasons(resolution),
		Truncated:   resolution.GetTruncated(),
	}
	encoded, err := json.Marshal(response)
	if err != nil {
		return toolErrorResult(fmt.Sprintf("code_mode_search_tools: failed to encode legacy catalogue: %v", err))
	}
	return textResult(string(encoded))
}

func (s *Server) handleSearchStateful(ctx context.Context, sessionID string, prompts []string) *mcp.CallToolResult {
	resolution, err := s.searchYoko(ctx, prompts)
	if err != nil {
		return toolErrorResult(fmt.Sprintf("code_mode_search_tools: yoko search failed: %v", err))
	}

	rawOps := make([]storage.SessionOp, 0, len(resolution.GetQueries()))
	for _, q := range resolution.GetQueries() {
		kind, ok := storageOperationKind(q.GetOperationType())
		if !ok {
			s.logger.Warn("code_mode_search_tools dropped unsupported operation kind",
				zap.String("name", q.GetOperationName()),
				zap.String("kind", q.GetOperationType()),
			)
			continue
		}
		rawOps = append(rawOps, storage.SessionOp{
			Name:         storage.ShortSHA(q.GetDocument()),
			Body:         q.GetDocument(),
			Kind:         kind,
			DocumentName: q.GetOperationName(),
			Description:  q.GetDescription(),
		})
	}

	notes := unsatisfactionNotes(resolution)

	if len(rawOps) == 0 {
		if notes != "" {
			return textResult(notes + noOperationsMessage)
		}
		return textResult(noOperationsMessage)
	}
	if s.storage == nil {
		return toolErrorResult("code_mode_search_tools: failed to register ops: code mode storage is not configured")
	}

	// Append returns one resolved SessionOp per input, mapping each yoko
	// query to either a freshly-registered op or a pre-existing op it
	// dedupes against by canonical body. Operation identity is the SHA
	// over the body, so the same body always lands on the same op — yoko
	// regenerating an operation under a different document name produces
	// the same identifier. The model receives declarations for every
	// match including reused ones, so a fresh context never has to
	// introspect the session.
	matchedOps, err := s.storage.Append(ctx, sessionID, rawOps)
	if err != nil {
		return toolErrorResult(fmt.Sprintf("code_mode_search_tools: failed to register ops: %v", err))
	}

	rendered, err := s.opsFragment(matchedOps, s.storage.Schema())
	if err != nil {
		return toolErrorResult(fmt.Sprintf("code_mode_search_tools: failed to render ops: %v", err))
	}
	if notes != "" {
		rendered = notes + "\n" + rendered
	}
	return textResult(rendered)
}

func (s *Server) searchYoko(ctx context.Context, prompts []string) (*yokov1.Resolution, error) {
	if s.yokoClient == nil {
		return nil, errors.New("yoko client is not configured")
	}
	return s.yokoClient.Search(ctx, prompts)
}

func storageOperationKind(operationType string) (storage.OperationKind, bool) {
	switch strings.ToLower(operationType) {
	case "query":
		return storage.OperationKindQuery, true
	case "mutation":
		return storage.OperationKindMutation, true
	default:
		return "", false
	}
}

func operationKindLabel(operationType string) (string, bool) {
	switch strings.ToLower(operationType) {
	case "query":
		return "Query", true
	case "mutation":
		return "Mutation", true
	default:
		return "", false
	}
}

func unsatisfiedReasons(resolution *yokov1.Resolution) []string {
	items := resolution.GetUnsatisfied()
	if len(items) == 0 {
		return nil
	}
	out := make([]string, 0, len(items))
	for _, u := range items {
		reason := strings.TrimSpace(u.GetReason())
		if reason == "" {
			continue
		}
		out = append(out, reason)
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

// unsatisfactionNotes formats unsatisfied requirements (and the truncated flag)
// as a leading TS-comment block prepended to the bundle fragment, so the model
// reading the search response can see what could not be satisfied.
func unsatisfactionNotes(resolution *yokov1.Resolution) string {
	reasons := unsatisfiedReasons(resolution)
	truncated := resolution.GetTruncated()
	if len(reasons) == 0 && !truncated {
		return ""
	}

	var b strings.Builder
	if len(reasons) > 0 {
		b.WriteString("// unsatisfied: yoko could not satisfy the following requirement(s):\n")
		for _, reason := range reasons {
			b.WriteString("//   - ")
			b.WriteString(reason)
			b.WriteByte('\n')
		}
	}
	if truncated {
		b.WriteString("// truncated: yoko ran out of turns before committing every requirement; consider tightening the prompt.\n")
	}
	return b.String()
}

func searchSingleFlightKey(sessionID string, prompts []string) string {
	sortedPrompts := append([]string(nil), prompts...)
	sort.Strings(sortedPrompts)
	keyParts := []string{sessionID}
	for _, p := range sortedPrompts {
		keyParts = append(keyParts, fmt.Sprintf("%d:%s", len(p), p))
	}
	return strings.Join(keyParts, "|")
}

func textResult(text string) *mcp.CallToolResult {
	return &mcp.CallToolResult{
		Content: []mcp.Content{&mcp.TextContent{Text: text}},
	}
}

func (s *Server) warnMissingSessionIDOnce() {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.warnedMissingSessionID {
		return
	}
	s.warnedMissingSessionID = true
	s.logger.Warn("code mode code_mode_search_tools missing MCP session id; falling back to legacy stateless catalogue")
}

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
	maxSearchPrompts              = 20
	emptySearchAPIResponseMessage = "// 0 new ops; previous code_mode_search_tools calls already cover these prompts."

	// The generated proto currently has query and mutation constants. Yoko may
	// still send the planned subscription enum value; host behavior is to drop it.
	yokoOperationKindSubscription yokov1.OperationKind = 3
)

type searchAPIInput struct {
	Prompts []string `json:"prompts"`
}

type legacyCatalogueOperation struct {
	Name        string  `json:"name"`
	Body        string  `json:"body"`
	Kind        string  `json:"kind"`
	Description string  `json:"description"`
	Variables   *string `json:"variables"`
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
	response, err := s.searchYoko(ctx, "", prompts)
	if err != nil {
		return toolErrorResult(fmt.Sprintf("code_mode_search_tools: yoko search failed: %v", err))
	}

	catalogue := make([]legacyCatalogueOperation, 0, len(response.GetOperations()))
	droppedSubscription := false
	for _, op := range response.GetOperations() {
		kind, ok, subscription := yokoOperationKindLabel(op.GetKind())
		if subscription {
			droppedSubscription = true
			continue
		}
		if !ok {
			s.logger.Warn("code_mode_search_tools dropped unsupported operation kind",
				zap.String("name", op.GetName()),
				zap.String("kind", op.GetKind().String()),
			)
			continue
		}
		catalogue = append(catalogue, legacyCatalogueOperation{
			Name:        op.GetName(),
			Body:        op.GetBody(),
			Kind:        kind,
			Description: op.GetDescription(),
			Variables:   extractGraphQLVariablesBlock(op.GetBody()),
		})
	}
	if droppedSubscription {
		s.logger.Warn("code_mode_search_tools dropped subscription operations returned by yoko")
	}

	encoded, err := json.Marshal(catalogue)
	if err != nil {
		return toolErrorResult(fmt.Sprintf("code_mode_search_tools: failed to encode legacy catalogue: %v", err))
	}
	return textResult(string(encoded))
}

func (s *Server) handleSearchStateful(ctx context.Context, sessionID string, prompts []string) *mcp.CallToolResult {
	response, err := s.searchYoko(ctx, sessionID, prompts)
	if err != nil {
		return toolErrorResult(fmt.Sprintf("code_mode_search_tools: yoko search failed: %v", err))
	}

	rawOps := make([]storage.SessionOp, 0, len(response.GetOperations()))
	droppedSubscription := false
	for _, op := range response.GetOperations() {
		kind, ok, subscription := storageOperationKind(op.GetKind())
		if subscription {
			droppedSubscription = true
			continue
		}
		if !ok {
			s.logger.Warn("code_mode_search_tools dropped unsupported operation kind",
				zap.String("name", op.GetName()),
				zap.String("kind", op.GetKind().String()),
			)
			continue
		}
		rawOps = append(rawOps, storage.SessionOp{
			Name:        storage.NormalizeName(op.GetName()),
			Body:        op.GetBody(),
			Kind:        kind,
			Description: op.GetDescription(),
		})
	}
	if droppedSubscription {
		s.logger.Warn("code_mode_search_tools dropped subscription operations returned by yoko")
	}

	if len(rawOps) == 0 {
		return textResult(emptySearchAPIResponseMessage)
	}
	if s.storage == nil {
		return toolErrorResult("code_mode_search_tools: failed to register ops: code mode storage is not configured")
	}

	// Collision handling approach: Append-applies-suffix. The storage backend is
	// the serialization point for a session and returns the final stored names.
	appendedOps, err := s.storage.Append(ctx, sessionID, rawOps)
	if err != nil {
		return toolErrorResult(fmt.Sprintf("code_mode_search_tools: failed to register ops: %v", err))
	}
	if len(appendedOps) == 0 {
		return textResult(emptySearchAPIResponseMessage)
	}

	rendered, err := s.newOpsFragment(appendedOps, s.storage.Schema())
	if err != nil {
		return toolErrorResult(fmt.Sprintf("code_mode_search_tools: failed to render new ops: %v", err))
	}
	return textResult(rendered)
}

func (s *Server) searchYoko(ctx context.Context, sessionID string, prompts []string) (*yokov1.SearchResponse, error) {
	if s.yokoClient == nil {
		return nil, errors.New("yoko client is not configured")
	}
	return s.yokoClient.Search(ctx, sessionID, prompts)
}

func storageOperationKind(kind yokov1.OperationKind) (storage.OperationKind, bool, bool) {
	switch kind {
	case yokov1.OperationKind_OPERATION_KIND_QUERY:
		return storage.OperationKindQuery, true, false
	case yokov1.OperationKind_OPERATION_KIND_MUTATION:
		return storage.OperationKindMutation, true, false
	case yokoOperationKindSubscription:
		return "", false, true
	default:
		return "", false, false
	}
}

func yokoOperationKindLabel(kind yokov1.OperationKind) (string, bool, bool) {
	switch kind {
	case yokov1.OperationKind_OPERATION_KIND_QUERY:
		return "Query", true, false
	case yokov1.OperationKind_OPERATION_KIND_MUTATION:
		return "Mutation", true, false
	case yokoOperationKindSubscription:
		return "", false, true
	default:
		return "", false, false
	}
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

func extractGraphQLVariablesBlock(body string) *string {
	open := strings.IndexByte(body, '(')
	if open < 0 {
		return nil
	}
	selection := strings.IndexByte(body, '{')
	if selection >= 0 && selection < open {
		return nil
	}

	depth := 0
	for i := open; i < len(body); i++ {
		switch body[i] {
		case '(':
			depth++
		case ')':
			depth--
			if depth == 0 {
				value := strings.TrimSpace(body[open : i+1])
				return &value
			}
		}
	}
	return nil
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

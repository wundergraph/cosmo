package server

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/modelcontextprotocol/go-sdk/mcp"
	"go.uber.org/zap"
)

type generateQueryInput struct {
	Prompt string `json:"prompt"`
}

func (s *Server) handleGenerateQueryAPI(ctx context.Context, req *mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	ctx = contextWithSessionFromExtra(ctx, req.GetExtra())

	prompt, validationErr := decodeGenerateQueryPrompt(req)
	if validationErr != nil {
		return toolErrorResult(validationErr.Error()), nil
	}

	resolution, err := s.searchYoko(ctx, []string{prompt})
	if err != nil {
		return toolErrorResult(fmt.Sprintf("code_mode_generate_query: yoko search failed: %v", err)), nil
	}

	documents := make([]string, 0, len(resolution.GetQueries()))
	for _, q := range resolution.GetQueries() {
		if _, ok := operationKindLabel(q.GetOperationType()); !ok {
			s.logger.Warn("code_mode_generate_query dropped unsupported operation kind",
				zap.String("name", q.GetOperationName()),
				zap.String("kind", q.GetOperationType()),
			)
			continue
		}
		doc := strings.TrimSpace(q.GetDocument())
		if doc == "" {
			continue
		}
		if strings.TrimSpace(q.GetOperationName()) == "" {
			s.logger.Warn("code_mode_generate_query dropped anonymous operation; only named operations are returned",
				zap.String("kind", q.GetOperationType()),
			)
			continue
		}
		documents = append(documents, prependOperationDescription(doc, q.GetDescription()))
	}

	return textResult(strings.Join(documents, "\n\n")), nil
}

// prependOperationDescription emits a GraphQL block-string description ahead of
// the operation. The description text is sanitised so any literal `"""` is
// escaped as `\"""` per the GraphQL block-string rules. If description is
// blank, the document is returned unchanged.
func prependOperationDescription(document, description string) string {
	desc := strings.TrimSpace(description)
	if desc == "" {
		return document
	}
	desc = strings.ReplaceAll(desc, `"""`, `\"""`)
	return "\"\"\"\n" + desc + "\n\"\"\"\n" + document
}

func decodeGenerateQueryPrompt(req *mcp.CallToolRequest) (string, error) {
	var input generateQueryInput
	if req != nil && req.Params != nil && len(req.Params.Arguments) > 0 {
		if err := json.Unmarshal(req.Params.Arguments, &input); err != nil {
			return "", errors.New("code_mode_generate_query: prompt must be a non-empty string")
		}
	}
	if strings.TrimSpace(input.Prompt) == "" {
		return "", errors.New("code_mode_generate_query: prompt must be a non-empty string")
	}
	return input.Prompt, nil
}

func generateQueryInputSchema() map[string]any {
	return map[string]any{
		"type":     "object",
		"required": []any{"prompt"},
		"properties": map[string]any{
			"prompt": map[string]any{
				"type":        "string",
				"minLength":   1,
				"description": "Natural-language description of the data shape the developer wants to query. State exact fields, filters by argument name (not literal value), and concrete entity/relationship names when known.",
			},
		},
	}
}

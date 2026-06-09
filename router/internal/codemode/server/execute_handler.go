package server

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"

	"github.com/modelcontextprotocol/go-sdk/mcp"
	"github.com/wundergraph/cosmo/router/internal/codemode/harness"
	"github.com/wundergraph/cosmo/router/internal/codemode/observability"
	"github.com/wundergraph/cosmo/router/internal/codemode/sandbox"
)

type executeAPIInput struct {
	Source string `json:"source"`
}

func (s *Server) handleExecuteAPI(ctx context.Context, req *mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	ctx = contextWithSessionFromExtra(ctx, req.GetExtra())

	source, err := decodeExecuteSource(req)
	if err != nil {
		return toolErrorResult(err.Error()), nil
	}

	if !s.namedOpsEnabled || s.sessionStateless {
		return toolErrorResult(namedOpsDisabledMessage), nil
	}

	sessionID := SessionIDFromContext(ctx)
	if sessionID == "" {
		return toolErrorResult(namedOpsDisabledMessage), nil
	}
	if s.storage == nil {
		return toolErrorResult("code_mode_run_js: storage is not configured"), nil
	}
	if s.pipeline == nil {
		return toolErrorResult("code_mode_run_js: pipeline failed: code mode execute pipeline is not configured"), nil
	}

	names, err := s.storage.ListNames(ctx, sessionID)
	if err != nil {
		return toolErrorResult(fmt.Sprintf("code_mode_run_js: failed to list tools: %v", err)), nil
	}

	executeTimeout := s.executeTimeout
	if executeTimeout <= 0 {
		executeTimeout = defaultExecuteTimeout
	}
	execCtx, cancel := context.WithTimeout(ctx, executeTimeout)
	defer cancel()

	response, err := s.pipeline.Execute(execCtx, harness.PipelineRequest{
		SessionID:      sessionID,
		ToolNames:      names,
		Source:         source,
		RequestHeaders: requestHeaders(req),
		ApprovalGate:   s.approvalGateForRequest(req),
	})
	if err != nil {
		return toolErrorResult(fmt.Sprintf("code_mode_run_js: pipeline failed: %v", err)), nil
	}
	if response.Envelope.Error != nil && response.Envelope.Error.Name == "TranspileError" {
		observability.LogTranspileFailure(s.logger, sessionID, response.Envelope.Error.Message)
	}
	return textResult(string(response.Encoded)), nil
}

func decodeExecuteSource(req *mcp.CallToolRequest) (string, error) {
	var input executeAPIInput
	if req != nil && req.Params != nil && len(req.Params.Arguments) > 0 {
		if err := json.Unmarshal(req.Params.Arguments, &input); err != nil {
			return "", errors.New("code_mode_run_js: source must be a non-empty string")
		}
	}
	if strings.TrimSpace(input.Source) == "" {
		return "", errors.New("code_mode_run_js: source must be a non-empty string")
	}
	return input.Source, nil
}

func (s *Server) approvalGateForRequest(req *mcp.CallToolRequest) sandbox.ApprovalGate {
	if s.approvalGate != nil {
		return s.approvalGate
	}
	var session *mcp.ServerSession
	if req != nil {
		session = req.Session
	}
	return NewElicitationGate(NewMCPElicitor(session), s.logger)
}

func requestHeaders(req *mcp.CallToolRequest) http.Header {
	if req == nil || req.GetExtra() == nil {
		return nil
	}
	return req.GetExtra().Header.Clone()
}

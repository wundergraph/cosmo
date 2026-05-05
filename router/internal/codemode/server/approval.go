package server

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"unicode/utf8"

	"github.com/modelcontextprotocol/go-sdk/mcp"
	"github.com/wundergraph/cosmo/router/internal/codemode/observability"
	"github.com/wundergraph/cosmo/router/internal/codemode/sandbox"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/astparser"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/astprinter"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/trace"
	"go.uber.org/zap"
)

const defaultMutationDeclinedReason = "Mutation declined by operator"

// Elicitor is the testable subset of the MCP elicitation API used by mutation approval.
type Elicitor interface {
	Elicit(ctx context.Context, params ElicitParams) (ElicitResponse, error)
}

type ElicitParams struct {
	Message         string
	RequestedSchema any
}

type ElicitResponse struct {
	Action   string
	FormData map[string]any
}

type ElicitationGate struct {
	elicitor Elicitor
	logger   *zap.Logger
}

func NewElicitationGate(elicitor Elicitor, logger *zap.Logger) *ElicitationGate {
	if logger == nil {
		logger = zap.NewNop()
	}
	return &ElicitationGate{elicitor: elicitor, logger: logger}
}

func (g *ElicitationGate) Decide(ctx context.Context, req sandbox.ApprovalRequest) (sandbox.ApprovalDecision, error) {
	if g == nil || g.elicitor == nil {
		decision := unsupportedElicitationDecision(errors.New("elicitor is not configured"))
		recordMutationApproval(ctx, decision)
		observability.LogElicitationOutcome(g.logger, SessionIDFromContext(ctx), decision.Approved, decision.Reason)
		return decision, nil
	}

	resp, err := g.elicitor.Elicit(ctx, ElicitParams{
		Message:         mutationApprovalMessage(req),
		RequestedSchema: mutationApprovalSchema(),
	})
	if err != nil {
		decision := unsupportedElicitationDecision(err)
		recordMutationApproval(ctx, decision)
		observability.LogElicitationOutcome(g.logger, SessionIDFromContext(ctx), decision.Approved, decision.Reason)
		return decision, nil
	}

	decision := decisionFromElicitation(resp)
	recordMutationApproval(ctx, decision)
	observability.LogElicitationOutcome(g.logger, SessionIDFromContext(ctx), decision.Approved, decision.Reason)
	return decision, nil
}

type MCPElicitor struct {
	session *mcp.ServerSession
}

func NewMCPElicitor(session *mcp.ServerSession) *MCPElicitor {
	return &MCPElicitor{session: session}
}

func (e *MCPElicitor) Elicit(ctx context.Context, params ElicitParams) (ElicitResponse, error) {
	if e == nil || e.session == nil {
		return ElicitResponse{}, errors.New("MCP server session is not available")
	}
	resp, err := e.session.Elicit(ctx, &mcp.ElicitParams{
		Message:         params.Message,
		RequestedSchema: params.RequestedSchema,
	})
	if err != nil {
		return ElicitResponse{}, err
	}
	if resp == nil {
		return ElicitResponse{}, nil
	}
	return ElicitResponse{Action: resp.Action, FormData: resp.Content}, nil
}

func decisionFromElicitation(resp ElicitResponse) sandbox.ApprovalDecision {
	if resp.Action != "accept" || resp.FormData == nil {
		return sandbox.ApprovalDecision{Approved: false, Reason: defaultMutationDeclinedReason}
	}
	if approved, ok := resp.FormData["approved"].(bool); ok && approved {
		return sandbox.ApprovalDecision{Approved: true}
	}
	reason, _ := resp.FormData["reason"].(string)
	return sandbox.ApprovalDecision{Approved: false, Reason: sanitizeMutationApprovalReason(reason)}
}

func unsupportedElicitationDecision(err error) sandbox.ApprovalDecision {
	return sandbox.ApprovalDecision{
		Approved: false,
		Reason:   fmt.Sprintf("mutation approval is required but the MCP client does not support elicitation: %s", err),
	}
}

func mutationApprovalSchema() map[string]any {
	return map[string]any{
		"type":     "object",
		"required": []string{"approved"},
		"properties": map[string]any{
			"approved": map[string]any{"type": "boolean"},
			"reason":   map[string]any{"type": "string", "maxLength": 500},
		},
	}
}

func mutationApprovalMessage(req sandbox.ApprovalRequest) string {
	return fmt.Sprintf(
		"Approve GraphQL mutation %q?\n\nGraphQL mutation:\n\n%s\n\nVariables:\n\n%s",
		req.Name,
		prettyMutationSource(req.Source),
		prettyMutationVariables(req.Vars),
	)
}

// prettyMutationSource reformats a GraphQL operation body with two-space indentation.
// On any parse failure the original source is returned verbatim — operator-visible
// readability is best-effort, and we never want to swallow what they actually approve.
func prettyMutationSource(source string) string {
	doc, report := astparser.ParseGraphqlDocumentString(source)
	if report.HasErrors() {
		return source
	}
	pretty, err := astprinter.PrintStringIndent(&doc, "  ")
	if err != nil {
		return source
	}
	return pretty
}

func prettyMutationVariables(vars json.RawMessage) string {
	if len(vars) == 0 {
		return "{}"
	}
	var decoded any
	if err := json.Unmarshal(vars, &decoded); err != nil {
		return string(vars)
	}
	pretty, err := json.MarshalIndent(decoded, "", "  ")
	if err != nil {
		return string(vars)
	}
	return string(pretty)
}

func sanitizeMutationApprovalReason(reason string) string {
	var b strings.Builder
	for len(reason) > 0 {
		r, size := utf8.DecodeRuneInString(reason)
		if r == utf8.RuneError && size == 1 {
			reason = reason[size:]
			continue
		}
		if r < 0x20 {
			reason = reason[size:]
			continue
		}
		if b.Len()+size > 500 {
			break
		}
		b.WriteString(reason[:size])
		reason = reason[size:]
	}
	return b.String()
}

func recordMutationApproval(ctx context.Context, decision sandbox.ApprovalDecision) {
	span := trace.SpanFromContext(ctx)
	span.SetAttributes(
		attribute.Bool("code_mode.mutation.approved", decision.Approved),
		attribute.String("code_mode.mutation.reason", decision.Reason),
	)
}

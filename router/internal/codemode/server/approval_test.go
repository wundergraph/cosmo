package server

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"unicode/utf8"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router/internal/codemode/sandbox"
	"go.uber.org/zap"
)

type fakeElicitor struct {
	response ElicitResponse
	err      error
	params   ElicitParams
}

func (f *fakeElicitor) Elicit(ctx context.Context, params ElicitParams) (ElicitResponse, error) {
	f.params = params
	if f.err != nil {
		return ElicitResponse{}, f.err
	}
	return f.response, nil
}

func TestElicitationGateAcceptApprovedTrue(t *testing.T) {
	elicitor := &fakeElicitor{
		response: ElicitResponse{Action: "accept", FormData: map[string]any{"approved": true}},
	}
	gate := NewElicitationGate(elicitor, zap.NewNop())

	got, err := gate.Decide(context.Background(), sandbox.ApprovalRequest{
		Name:   "deleteOrders",
		Source: "mutation DeleteOrders { deleteOrders }",
		Vars:   json.RawMessage(`{"id":"x"}`),
	})

	require.NoError(t, err)
	assert.Equal(t, sandbox.ApprovalDecision{Approved: true, Reason: ""}, got)
	assert.Equal(t, map[string]any{
		"type":     "object",
		"required": []string{"approved"},
		"properties": map[string]any{
			"approved": map[string]any{"type": "boolean"},
			"reason":   map[string]any{"type": "string", "maxLength": 500},
		},
	}, elicitor.params.RequestedSchema)
	assert.Equal(t, "Approve GraphQL mutation \"deleteOrders\"?\n\nGraphQL mutation:\n\nmutation DeleteOrders {\n  deleteOrders\n}\n\nVariables:\n\n{\n  \"id\": \"x\"\n}", elicitor.params.Message)
}

func TestElicitationGateAcceptApprovedFalseUsesReason(t *testing.T) {
	elicitor := &fakeElicitor{
		response: ElicitResponse{Action: "accept", FormData: map[string]any{"approved": false, "reason": "no thanks"}},
	}
	gate := NewElicitationGate(elicitor, zap.NewNop())

	got, err := gate.Decide(context.Background(), sandbox.ApprovalRequest{Name: "deleteOrders"})

	require.NoError(t, err)
	assert.Equal(t, sandbox.ApprovalDecision{Approved: false, Reason: "no thanks"}, got)
}

func TestElicitationGateAcceptApprovedFalseStripsControlCharacters(t *testing.T) {
	elicitor := &fakeElicitor{
		response: ElicitResponse{Action: "accept", FormData: map[string]any{"approved": false, "reason": "no\x00 \x01thanks\x1f"}},
	}
	gate := NewElicitationGate(elicitor, zap.NewNop())

	got, err := gate.Decide(context.Background(), sandbox.ApprovalRequest{Name: "deleteOrders"})

	require.NoError(t, err)
	assert.Equal(t, sandbox.ApprovalDecision{Approved: false, Reason: "no thanks"}, got)
}

func TestElicitationGateAcceptApprovedFalseTruncatesReasonUTF8Safely(t *testing.T) {
	elicitor := &fakeElicitor{
		response: ElicitResponse{Action: "accept", FormData: map[string]any{"approved": false, "reason": strings.Repeat("é", 300)}},
	}
	gate := NewElicitationGate(elicitor, zap.NewNop())

	got, err := gate.Decide(context.Background(), sandbox.ApprovalRequest{Name: "deleteOrders"})

	require.NoError(t, err)
	assert.Equal(t, sandbox.ApprovalDecision{Approved: false, Reason: strings.Repeat("é", 250)}, got)
	assert.Equal(t, 500, len(got.Reason))
	assert.Equal(t, true, utf8.ValidString(got.Reason))
}

func TestElicitationGateDeclineAction(t *testing.T) {
	elicitor := &fakeElicitor{response: ElicitResponse{Action: "decline"}}
	gate := NewElicitationGate(elicitor, zap.NewNop())

	got, err := gate.Decide(context.Background(), sandbox.ApprovalRequest{Name: "deleteOrders"})

	require.NoError(t, err)
	assert.Equal(t, sandbox.ApprovalDecision{Approved: false, Reason: "Mutation declined by operator"}, got)
}

func TestElicitationGateCancelAction(t *testing.T) {
	elicitor := &fakeElicitor{response: ElicitResponse{Action: "cancel"}}
	gate := NewElicitationGate(elicitor, zap.NewNop())

	got, err := gate.Decide(context.Background(), sandbox.ApprovalRequest{Name: "deleteOrders"})

	require.NoError(t, err)
	assert.Equal(t, sandbox.ApprovalDecision{Approved: false, Reason: "Mutation declined by operator"}, got)
}

func TestElicitationGateUnsupportedElicitationErrorDeclines(t *testing.T) {
	elicitor := &fakeElicitor{err: errors.New("elicitation not supported")}
	gate := NewElicitationGate(elicitor, zap.NewNop())

	got, err := gate.Decide(context.Background(), sandbox.ApprovalRequest{Name: "deleteOrders"})

	require.NoError(t, err)
	assert.Equal(t, sandbox.ApprovalDecision{
		Approved: false,
		Reason:   "mutation approval is required but the MCP client does not support elicitation: elicitation not supported",
	}, got)
}

func TestElicitationGateContextCanceledErrorDeclines(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	elicitor := &fakeElicitor{err: ctx.Err()}
	gate := NewElicitationGate(elicitor, zap.NewNop())

	got, err := gate.Decide(ctx, sandbox.ApprovalRequest{Name: "deleteOrders"})

	require.NoError(t, err)
	assert.Equal(t, sandbox.ApprovalDecision{
		Approved: false,
		Reason:   "mutation approval is required but the MCP client does not support elicitation: context canceled",
	}, got)
}

func TestElicitationGateAcceptWithoutFormDataDeclines(t *testing.T) {
	elicitor := &fakeElicitor{response: ElicitResponse{Action: "accept"}}
	gate := NewElicitationGate(elicitor, zap.NewNop())

	got, err := gate.Decide(context.Background(), sandbox.ApprovalRequest{Name: "deleteOrders"})

	require.NoError(t, err)
	assert.Equal(t, sandbox.ApprovalDecision{Approved: false, Reason: "Mutation declined by operator"}, got)
}

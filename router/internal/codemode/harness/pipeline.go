package harness

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"

	"github.com/wundergraph/cosmo/router/internal/codemode/sandbox"
)

const defaultMaxInputBytes = 64 << 10

type sandboxExecutor interface {
	Execute(ctx context.Context, req sandbox.ExecuteRequest) (sandbox.ExecuteResult, error)
}

type Executor interface {
	Execute(ctx context.Context, req PipelineRequest) (PipelineResponse, error)
}

type Pipeline struct {
	Sandbox        *sandbox.Sandbox
	MaxInputBytes  int
	MaxResultBytes int

	executor sandboxExecutor
}

type PipelineRequest struct {
	SessionID      string
	ToolNames      []string
	Source         string
	RequestHeaders http.Header
	ApprovalGate   sandbox.ApprovalGate
}

type PipelineResponse struct {
	Envelope    ResultEnvelope
	Encoded     []byte
	Diagnostics []Diagnostic
}

func (p *Pipeline) Execute(ctx context.Context, req PipelineRequest) (PipelineResponse, error) {
	maxInputBytes := p.MaxInputBytes
	if maxInputBytes <= 0 {
		maxInputBytes = defaultMaxInputBytes
	}

	// Raw-source guard rejects oversized input before esbuild parses it. The
	// same limit applies post-transpile below because generated JS can differ
	// slightly from source size.
	if len(req.Source) > maxInputBytes {
		return p.errorResponse(&ErrorEnvelope{
			Name:    "InputTooLarge",
			Message: fmt.Sprintf("input size %d bytes exceeds limit %d bytes", len(req.Source), maxInputBytes),
			Stack:   "",
		}, nil)
	}

	transpiled, err := Transpile(req.Source)
	if err != nil {
		return p.errorResponse(&ErrorEnvelope{Name: "TranspileError", Message: err.Error(), Stack: ""}, transpiled.Diagnostics)
	}

	if len(transpiled.JS) > maxInputBytes {
		return p.errorResponse(&ErrorEnvelope{
			Name:    "InputTooLarge",
			Message: fmt.Sprintf("input size %d bytes exceeds limit %d bytes", len(transpiled.JS), maxInputBytes),
			Stack:   "",
		}, nil)
	}

	if err := ShapeCheck(transpiled.JS); err != nil {
		return p.errorResponse(&ErrorEnvelope{Name: "ShapeCheck", Message: err.Error(), Stack: ""}, nil)
	}

	executor, err := p.sandboxExecutor()
	if err != nil {
		return PipelineResponse{}, err
	}
	sandboxResult, err := executor.Execute(ctx, sandbox.ExecuteRequest{
		SessionID:      req.SessionID,
		ToolNames:      req.ToolNames,
		WrappedJS:      transpiled.JS,
		SourceMap:      transpiled.SourceMap,
		RequestHeaders: req.RequestHeaders,
		ApprovalGate:   req.ApprovalGate,
	})
	if err != nil {
		return PipelineResponse{}, err
	}

	envelope, err := BuildEnvelope(sandboxResult, p.MaxResultBytes)
	if err != nil {
		return PipelineResponse{}, err
	}
	encoded, err := json.Marshal(envelope)
	if err != nil {
		return PipelineResponse{}, err
	}
	return PipelineResponse{Envelope: envelope, Encoded: encoded}, nil
}

func (p *Pipeline) sandboxExecutor() (sandboxExecutor, error) {
	if p.executor != nil {
		return p.executor, nil
	}
	if p.Sandbox == nil {
		return nil, errors.New("code mode: pipeline sandbox is nil")
	}
	return p.Sandbox, nil
}

func (p *Pipeline) errorResponse(errEnv *ErrorEnvelope, diagnostics []Diagnostic) (PipelineResponse, error) {
	envelope := ResultEnvelope{
		Result:    json.RawMessage("null"),
		Truncated: false,
		Error:     errEnv,
	}
	encoded, err := json.Marshal(envelope)
	if err != nil {
		return PipelineResponse{}, err
	}
	return PipelineResponse{Envelope: envelope, Encoded: encoded, Diagnostics: diagnostics}, nil
}

package harness

import (
	"context"
	"encoding/json"
	"net/http"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router/internal/codemode/sandbox"
)

type fakeExecutor struct {
	calls  int
	result sandbox.ExecuteResult
	err    error
}

func (f *fakeExecutor) Execute(ctx context.Context, req sandbox.ExecuteRequest) (sandbox.ExecuteResult, error) {
	f.calls++
	return f.result, f.err
}

func TestPipelineShapeCheckFailureShortCircuits(t *testing.T) {
	fake := &fakeExecutor{}
	pipeline := Pipeline{executor: fake}

	got, err := pipeline.Execute(context.Background(), PipelineRequest{Source: `() => 1`})
	require.NoError(t, err)

	assert.Equal(t, 0, fake.calls)
	require.NotNil(t, got.Envelope.Error)
	assert.Equal(t, "ShapeCheck", got.Envelope.Error.Name)
	assert.Equal(t, `code mode: source must be a single async-arrow root (got: missing async modifier)`, got.Envelope.Error.Message)
	assert.Empty(t, got.Diagnostics)
	assert.NotEmpty(t, got.Encoded)
}

func TestPipelineTopLevelAwaitFailsAtTranspile(t *testing.T) {
	fake := &fakeExecutor{}
	pipeline := Pipeline{executor: fake}

	got, err := pipeline.Execute(context.Background(), PipelineRequest{Source: `await tools.getUser({})`})
	require.NoError(t, err)

	assert.Equal(t, 0, fake.calls)
	require.NotNil(t, got.Envelope.Error)
	assert.Equal(t, "TranspileError", got.Envelope.Error.Name)
	// esbuild's exact message is target-version dependent. We only assert the
	// transpile-error envelope name; the full message lives in Diagnostics.
	assert.NotEmpty(t, got.Diagnostics)
}

func TestPipelineAcceptsTypeScriptSource(t *testing.T) {
	fake := &fakeExecutor{result: sandbox.ExecuteResult{OK: true, Result: raw(`{"id":"1"}`)}}
	pipeline := Pipeline{executor: fake}

	// TypeScript source: type annotations, optional params, type parameters.
	// All three are valid TS-only syntax. Pipeline must transpile then accept.
	tsInputs := []string{
		`async (x: string) => ({ id: x })`,
		`async (x: string, y?: number) => ({ id: x })`,
		`async <T>(x: T) => ({ id: String(x) })`,
	}
	for _, in := range tsInputs {
		t.Run(in, func(t *testing.T) {
			fake.calls = 0
			got, err := pipeline.Execute(context.Background(), PipelineRequest{Source: in})
			require.NoError(t, err)
			assert.Equal(t, 1, fake.calls, "sandbox should be invoked")
			assert.Nil(t, got.Envelope.Error, "no shape or transpile error expected")
		})
	}
}

func TestPipelineTranspileFailureReturnsDiagnostics(t *testing.T) {
	fake := &fakeExecutor{}
	pipeline := Pipeline{executor: fake}

	got, err := pipeline.Execute(context.Background(), PipelineRequest{Source: `async () => { let x = ; }`})
	require.NoError(t, err)

	assert.Equal(t, 0, fake.calls)
	require.NotNil(t, got.Envelope.Error)
	assert.Equal(t, "TranspileError", got.Envelope.Error.Name)
	assert.NotEmpty(t, got.Diagnostics)
	assert.NotEmpty(t, got.Encoded)
}

func TestPipelineSandboxErrorIsFoldedIntoEnvelope(t *testing.T) {
	fake := &fakeExecutor{result: sandbox.ExecuteResult{
		OK:    false,
		Error: &sandbox.ErrorEnvelope{Name: "RuntimeError", Message: "boom", Stack: "stack"},
	}}
	pipeline := Pipeline{executor: fake}

	got, err := pipeline.Execute(context.Background(), PipelineRequest{Source: `async () => 1`})
	require.NoError(t, err)

	assert.Equal(t, 1, fake.calls)
	require.NotNil(t, got.Envelope.Error)
	assert.Equal(t, "RuntimeError", got.Envelope.Error.Name)
	assert.Equal(t, false, got.Envelope.Truncated)
}

func TestPipelineSandboxSuccessEncodesEnvelope(t *testing.T) {
	fake := &fakeExecutor{result: sandbox.ExecuteResult{OK: true, Result: raw(`{"ok":true}`)}}
	pipeline := Pipeline{executor: fake}

	got, err := pipeline.Execute(context.Background(), PipelineRequest{
		SessionID:      "session-1",
		ToolNames:      []string{"getUser"},
		Source:         `async () => ({ ok: true })`,
		RequestHeaders: http.Header{"Authorization": []string{"Bearer token"}},
		ApprovalGate:   nil,
	})
	require.NoError(t, err)

	assert.Equal(t, 1, fake.calls)
	assert.Equal(t, ResultEnvelope{Result: raw(`{"ok":true}`), Truncated: false, Error: nil}, got.Envelope)

	var decoded map[string]any
	require.NoError(t, json.Unmarshal(got.Encoded, &decoded))
	assert.Equal(t, map[string]any{"result": map[string]any{"ok": true}}, decoded)
}

func TestPipelineTruncationTriggers(t *testing.T) {
	result, err := json.Marshal([]any{map[string]any{"id": 1}, map[string]any{"id": 2}, map[string]any{"id": 3}})
	require.NoError(t, err)

	fake := &fakeExecutor{result: sandbox.ExecuteResult{OK: true, Result: result}}
	pipeline := Pipeline{executor: fake, MaxResultBytes: len(`[{"id":1},{"id":2}]`)}

	got, err := pipeline.Execute(context.Background(), PipelineRequest{Source: `async () => []`})
	require.NoError(t, err)

	assert.Equal(t, true, got.Envelope.Truncated)
	assert.Equal(t, raw(`[{"id":1},{"id":2}]`), got.Envelope.Result)
}

func raw(s string) json.RawMessage {
	return json.RawMessage(s)
}

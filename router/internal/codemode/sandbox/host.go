package sandbox

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
	"sync/atomic"

	"github.com/fastschema/qjs"
	"github.com/wundergraph/cosmo/router/internal/codemode/observability"
	"github.com/wundergraph/cosmo/router/internal/codemode/storage"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/trace"
)

// TODO(code-mode §9): The plan calls for channel-based async host calls so
// Promise.all can overlap HTTP work. qjs v0.0.6 SetAsyncFunc invokes the Go
// callback synchronously on the QuickJS/Wazero call path, and resolving from
// arbitrary goroutines is not supported by the wrapper without a JS-thread
// drain loop, so host calls remain serialized for the MVP.

type executeState struct {
	req       ExecuteRequest
	hostCalls atomic.Int32
	qjsMu     sync.Mutex
}

func (s *Sandbox) installHostInvoke(ctx context.Context, qctx *qjs.Context, state *executeState) {
	qctx.SetAsyncFunc("__hostInvokeTool", func(this *qjs.This) {
		args := this.Args()
		name := ""
		if len(args) > 0 && !args[0].IsUndefined() && !args[0].IsNull() {
			name = args[0].String()
		}
		vars, err := varsJSON(args)
		if err != nil {
			resolveString(this, state, hostErrorPayload("TypeError", err.Error()))
			return
		}

		result, invokeErr := s.invokeTool(ctx, state, name, vars)
		if invokeErr != nil {
			resolveString(this, state, hostErrorPayload(invokeErr.name, invokeErr.message))
			return
		}
		resolveString(this, state, string(result))
	})
}

func resolveString(this *qjs.This, state *executeState, payload string) {
	state.qjsMu.Lock()
	defer state.qjsMu.Unlock()
	this.Promise().Resolve(this.Context().NewString(payload))
}

func hostErrorPayload(name, message string) string {
	body, _ := json.Marshal(map[string]any{
		"__codemodeHostError": map[string]string{
			"name":    name,
			"message": message,
		},
	})
	return string(body)
}

type hostError struct {
	name    string
	message string
}

func varsJSON(args []*qjs.Value) (json.RawMessage, error) {
	if len(args) < 2 || args[1].IsUndefined() || args[1].IsNull() {
		return json.RawMessage(`{}`), nil
	}
	jsonString, err := args[1].JSONStringify()
	if err != nil {
		return nil, err
	}
	if jsonString == "" || jsonString == "null" {
		return json.RawMessage(`{}`), nil
	}
	return json.RawMessage(jsonString), nil
}

func (s *Sandbox) invokeTool(ctx context.Context, state *executeState, name string, vars json.RawMessage) (json.RawMessage, *hostError) {
	count := int(state.hostCalls.Add(1))
	if count > s.cfg.MaxToolInvocationsPerCall {
		return nil, &hostError{
			name:    "HostCallLimitExceeded",
			message: fmt.Sprintf("tools.* invocation cap of %d exceeded; batch independent calls with Promise.all.", s.cfg.MaxToolInvocationsPerCall),
		}
	}

	op, ok, err := s.cfg.StorageLookup(ctx, state.req.SessionID, name)
	if err != nil {
		observability.LogToolInvocationFailure(s.cfg.Logger, state.req.SessionID, name, err)
		return nil, &hostError{name: "Error", message: err.Error()}
	}
	if !ok {
		err := fmt.Errorf("tools.%s is not a function", name)
		observability.LogToolInvocationFailure(s.cfg.Logger, state.req.SessionID, name, err)
		return nil, &hostError{name: "TypeError", message: err.Error()}
	}

	span := trace.SpanFromContext(ctx)
	span.SetAttributes(
		attribute.String("codemode.op.name", op.Name),
		attribute.String("codemode.op.kind", string(op.Kind)),
	)

	if op.Kind == storage.OperationKindMutation {
		gate := state.req.ApprovalGate
		if gate == nil {
			gate = approveAllGate{}
		}
		decision, err := gate.Decide(ctx, ApprovalRequest{Name: name, Source: op.Body, Vars: vars})
		if err != nil {
			observability.LogToolInvocationFailure(s.cfg.Logger, state.req.SessionID, name, err)
			return nil, &hostError{name: "Error", message: err.Error()}
		}
		span.SetAttributes(
			attribute.Bool("code_mode.mutation.approved", decision.Approved),
			attribute.String("code_mode.mutation.reason", decision.Reason),
		)
		if !decision.Approved {
			body := mutationDeclinedResponse(decision.Reason)
			span.SetAttributes(attribute.Bool("codemode.op.success", false))
			return body, nil
		}
	}

	body, err := json.Marshal(graphQLRequest{
		Query:         op.Body,
		OperationName: name,
		Variables:     vars,
	})
	if err != nil {
		return nil, &hostError{name: "Error", message: err.Error()}
	}

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, s.cfg.RouterGraphQLEndpoint, bytes.NewReader(body))
	if err != nil {
		return nil, &hostError{name: "Error", message: err.Error()}
	}
	copyAllowedHeaders(httpReq.Header, state.req.RequestHeaders, s.allowList)
	httpReq.Header.Set("Content-Type", "application/json")

	resp, err := s.http.Do(httpReq)
	if err != nil {
		span.SetAttributes(attribute.Bool("codemode.op.success", false))
		observability.LogToolInvocationFailure(s.cfg.Logger, state.req.SessionID, name, err)
		return nil, &hostError{name: "Error", message: err.Error()}
	}
	defer resp.Body.Close()

	respBody, err := readCapped(resp.Body, s.cfg.MaxResponseBodyBytes)
	if err != nil {
		span.SetAttributes(attribute.Bool("codemode.op.success", false))
		observability.LogToolInvocationFailure(s.cfg.Logger, state.req.SessionID, name, err)
		return nil, &hostError{name: "Error", message: err.Error()}
	}

	result := normalizeGraphQLResponse(resp.StatusCode, respBody)
	if errorsJSON := graphQLErrors(result); errorsJSON != "" {
		span.SetAttributes(attribute.String("codemode.graphql.errors", errorsJSON))
		observability.LogToolInvocationFailure(s.cfg.Logger, state.req.SessionID, name, fmt.Errorf("graphql errors: %s", errorsJSON))
	}
	span.SetAttributes(attribute.Bool("codemode.op.success", resp.StatusCode < 400))
	if resp.StatusCode >= 400 {
		observability.LogToolInvocationFailure(s.cfg.Logger, state.req.SessionID, name, fmt.Errorf("graphql http status %d", resp.StatusCode))
	}
	return result, nil
}

type graphQLRequest struct {
	Query         string          `json:"query"`
	OperationName string          `json:"operationName"`
	Variables     json.RawMessage `json:"variables"`
}

func mutationDeclinedResponse(reason string) json.RawMessage {
	if reason == "" {
		reason = "Mutation declined by operator"
	}
	body, _ := json.Marshal(map[string]any{
		"data": nil,
		"errors": []map[string]string{{
			"message": "Mutation declined by operator: " + reason,
		}},
		"declined": map[string]string{"reason": reason},
	})
	return body
}

func normalizeGraphQLResponse(status int, body []byte) json.RawMessage {
	var payload map[string]json.RawMessage
	if err := json.Unmarshal(body, &payload); err == nil {
		if status >= 400 {
			if _, ok := payload["errors"]; ok {
				out, _ := json.Marshal(payload)
				return out
			}
		}
		out, _ := json.Marshal(payload)
		return out
	}
	msg := strings.TrimSpace(string(body))
	if msg == "" {
		msg = http.StatusText(status)
	}
	out, _ := json.Marshal(map[string]any{
		"errors": []map[string]string{{"message": msg}},
	})
	return out
}

func graphQLErrors(body json.RawMessage) string {
	var payload struct {
		Errors json.RawMessage `json:"errors"`
	}
	if err := json.Unmarshal(body, &payload); err != nil || len(payload.Errors) == 0 {
		return ""
	}
	return string(payload.Errors)
}

func readCapped(r io.Reader, capBytes int) ([]byte, error) {
	data, err := io.ReadAll(io.LimitReader(r, int64(capBytes)+1))
	if err != nil {
		return nil, err
	}
	if len(data) > capBytes {
		return nil, fmt.Errorf("tools.* HTTP response body exceeded %d bytes", capBytes)
	}
	return data, nil
}

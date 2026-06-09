package sandbox

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"strings"
	"time"

	"github.com/fastschema/qjs"
)

func (s *Sandbox) Execute(ctx context.Context, req ExecuteRequest) (execResult ExecuteResult, retErr error) {
	if err := s.acquire(ctx); err != nil {
		return ExecuteResult{}, err
	}
	defer s.release()

	// qjs v0.0.6 panics from inside its Eval/Free/Close paths when the underlying
	// wazero module is closed by context cancellation (e.g. host call exceeded
	// the sandbox wall-clock). Recover here so a panicking call cannot crash the
	// router goroutine; surface as a Timeout envelope instead.
	defer func() {
		if r := recover(); r != nil {
			errEnv := &ErrorEnvelope{Name: "Timeout", Message: fmt.Sprintf("sandbox runtime panic: %v", r)}
			if ctx.Err() != nil {
				errEnv.Message = ctx.Err().Error()
			}
			execResult = ExecuteResult{OK: false, Error: errEnv, OutputSize: envelopeSize(nil, errEnv)}
			retErr = nil
		}
	}()

	program := buildPreamble(req.WrappedJS)
	if len(program) > s.cfg.MaxInputSizeBytes {
		errEnv := &ErrorEnvelope{
			Name:    "InputTooLarge",
			Message: fmt.Sprintf("input size %d bytes exceeds limit %d bytes", len(program), s.cfg.MaxInputSizeBytes),
			Stack:   "",
		}
		return ExecuteResult{OK: false, Error: errEnv, OutputSize: envelopeSize(nil, errEnv)}, nil
	}

	execCtx, cancel := context.WithTimeout(ctx, s.cfg.RequestTimeout)
	defer cancel()

	rt, err := qjs.New(qjs.Option{
		Context:            execCtx,
		CloseOnContextDone: true,
		DisableBuildCache:  true,
		MemoryLimit:        s.cfg.MemoryLimitBytes,
		MaxExecutionTime:   int(s.cfg.RequestTimeout / time.Millisecond),
		Stdout:             io.Discard,
		Stderr:             io.Discard,
	})
	if err != nil {
		return runtimeErrorResult(err, execCtx, 0), nil
	}

	qctx := rt.Context()
	state := &executeState{req: req}
	defer func() {
		// qjs panics on Close when the runtime context has already been cancelled.
		// Treat the runtime as best-effort cleanup; a leaked WASM instance is bounded
		// by GC and the per-call freshness contract.
		defer func() { _ = recover() }()
		rt.Close()
	}()
	s.installHostInvoke(execCtx, qctx, state)
	if err := installValidationHelpers(qctx); err != nil {
		return runtimeErrorResult(err, execCtx, int(state.hostCalls.Load())), nil
	}

	global := qctx.Global()
	toolNames := req.ToolNames
	if toolNames == nil {
		toolNames = []string{}
	}
	namesJSON, err := json.Marshal(toolNames)
	if err != nil {
		return ExecuteResult{}, err
	}
	names := qctx.ParseJSON(string(namesJSON))
	global.SetPropertyStr("__HOST_TOOL_NAMES", names)

	value, err := qctx.Eval("codemode_agent.js", qjs.Code(program))
	if err != nil {
		return runtimeErrorResult(err, execCtx, int(state.hostCalls.Load())), nil
	}

	value, err = awaitWithContext(execCtx, rt, value)
	if err != nil {
		return runtimeErrorResult(err, execCtx, int(state.hostCalls.Load())), nil
	}
	okValue := value.GetPropertyStr("ok")
	ok := okValue.Bool()

	if !ok {
		errValue := value.GetPropertyStr("error")
		errEnv, err := normalizeError(qctx, errValue, req.SourceMap, program)
		if err != nil {
			return runtimeErrorResult(err, execCtx, int(state.hostCalls.Load())), nil
		}
		if errEnv.Name == "InternalError" {
			errEnv.Name = "MemoryLimit"
		}
		if errEnv.Name == "TypeError" && errEnv.Message == "not a function" {
			if missing := missingToolName(req.WrappedJS, req.ToolNames); missing != "" {
				errEnv.Message = "tools." + missing + " is not a function"
			}
		}
		hostCalls := int(state.hostCalls.Load())
		if errEnv.Name == "HostCallLimitExceeded" {
			hostCalls = s.cfg.MaxToolInvocationsPerCall + 1
		}
		return ExecuteResult{
			OK:         false,
			Error:      errEnv,
			OutputSize: envelopeSize(nil, errEnv),
			HostCalls:  hostCalls,
		}, nil
	}

	resultValue := value.GetPropertyStr("result")
	result, warnings, validationErr, err := validateResult(qctx, resultValue, s.cfg.MaxOutputSizeBytes)
	if err != nil {
		return runtimeErrorResult(err, execCtx, int(state.hostCalls.Load())), nil
	}
	if validationErr != nil {
		return ExecuteResult{
			OK:         false,
			Error:      validationErr,
			Warnings:   warnings,
			OutputSize: envelopeSize(nil, validationErr),
			HostCalls:  int(state.hostCalls.Load()),
		}, nil
	}
	return ExecuteResult{
		OK:         true,
		Result:     result,
		Warnings:   warnings,
		OutputSize: envelopeSize(result, nil),
		HostCalls:  int(state.hostCalls.Load()),
	}, nil
}

type awaitResult struct {
	value *qjs.Value
	err   error
}

func awaitWithContext(ctx context.Context, rt *qjs.Runtime, value *qjs.Value) (*qjs.Value, error) {
	if !value.IsPromise() {
		return value, nil
	}

	done := make(chan awaitResult, 1)
	go func() {
		awaited, err := value.Await()
		done <- awaitResult{value: awaited, err: err}
	}()

	select {
	case result := <-done:
		return result.value, result.err
	case <-ctx.Done():
		// Best-effort runtime close so the await goroutine unblocks; the deferred
		// close in Execute owns the canonical cleanup (and recovers any qjs panic).
		func() {
			defer func() { _ = recover() }()
			rt.Close()
		}()
		select {
		case result := <-done:
			_ = result
		case <-time.After(100 * time.Millisecond):
		}
		return nil, ctx.Err()
	}
}

func runtimeErrorResult(err error, ctx context.Context, hostCalls int) ExecuteResult {
	errEnv := classifyRuntimeError(err, ctx)
	return ExecuteResult{
		OK:         false,
		Error:      errEnv,
		OutputSize: envelopeSize(nil, errEnv),
		HostCalls:  hostCalls,
	}
}

func classifyRuntimeError(err error, ctx context.Context) *ErrorEnvelope {
	if ctx.Err() != nil {
		return &ErrorEnvelope{Name: "Timeout", Message: ctx.Err().Error(), Stack: ""}
	}
	msg := err.Error()
	lower := strings.ToLower(msg)
	if strings.Contains(lower, "memory") || strings.Contains(lower, "out of memory") {
		return &ErrorEnvelope{Name: "MemoryLimit", Message: msg, Stack: ""}
	}
	return &ErrorEnvelope{Name: "Error", Message: msg, Stack: ""}
}

func envelopeSize(result json.RawMessage, errEnv *ErrorEnvelope) int {
	if errEnv != nil {
		body, _ := json.Marshal(errEnv)
		return len(body)
	}
	return len(result)
}

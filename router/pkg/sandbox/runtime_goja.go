package sandbox

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/dop251/goja"
)

// gojaRuntime executes JavaScript code in an isolated goja environment.
type gojaRuntime struct {
	config ExecutionConfig
}

func newGojaRuntime(config ExecutionConfig) *gojaRuntime {
	return &gojaRuntime{config: config}
}

// injectGojaFunc injects a named host function into the goja VM.
// Used for both sync and async functions (goja has no native Promises,
// so async functions are called synchronously-blocking).
func injectGojaFunc(vm *goja.Runtime, name string, fn func(args []any) (any, error)) error {
	return vm.Set(name, func(call goja.FunctionCall) goja.Value {
		args := convertGojaArgs(vm, call)
		result, err := fn(args)
		if err != nil {
			panic(vm.NewGoError(err))
		}
		return goToGojaValue(vm, result)
	})
}

// Execute runs JavaScript code with the provided globals in an isolated sandbox.
// Each call creates a fresh goja VM — no state leaks between executions.
func (r *gojaRuntime) Execute(ctx context.Context, jsCode string, syncFuncs []SyncFunc, asyncFuncs []AsyncFunc, objects []ObjectDef) (*Result, error) {
	timeout := r.config.Timeout
	if timeout <= 0 {
		timeout = 5 * time.Second
	}

	type execResult struct {
		result *Result
		err    error
	}

	ch := make(chan execResult, 1)
	done := make(chan struct{})

	go func() {
		vm := goja.New()
		vm.SetMaxCallStackSize(64)

		// Set up timeout: interrupt the VM after the deadline
		timer := time.AfterFunc(timeout, func() {
			vm.Interrupt("execution timeout exceeded")
		})
		defer timer.Stop()

		// Monitor context cancellation. The done channel prevents
		// this goroutine from leaking after execution completes.
		go func() {
			select {
			case <-ctx.Done():
				vm.Interrupt("context cancelled")
			case <-done:
			}
		}()

		// Inject sync functions
		for _, sf := range syncFuncs {
			fn := sf // capture
			if err := injectGojaFunc(vm, fn.Name, fn.Fn); err != nil {
				ch <- execResult{err: fmt.Errorf("failed to inject function %s: %w", fn.Name, err)}
				return
			}
		}

		// Inject async functions (synchronous-blocking in goja)
		for _, af := range asyncFuncs {
			fn := af // capture
			if err := injectGojaFunc(vm, fn.Name, fn.Fn); err != nil {
				ch <- execResult{err: fmt.Errorf("failed to inject function %s: %w", fn.Name, err)}
				return
			}
		}

		// Inject objects with methods
		for _, od := range objects {
			obj := vm.NewObject()
			for methodName, methodFn := range od.Methods {
				mfn := methodFn // capture
				if err := obj.Set(methodName, func(call goja.FunctionCall) goja.Value {
					args := convertGojaArgs(vm, call)
					result, err := mfn(args)
					if err != nil {
						panic(vm.NewGoError(err))
					}
					return goToGojaValue(vm, result)
				}); err != nil {
					ch <- execResult{err: fmt.Errorf("failed to inject method %s.%s: %w", od.Name, methodName, err)}
					return
				}
			}
			if err := vm.Set(od.Name, obj); err != nil {
				ch <- execResult{err: fmt.Errorf("failed to inject object %s: %w", od.Name, err)}
				return
			}
		}

		// Remove dangerous globals for sandbox security.
		// No timers: prevent timeout bypass.
		for _, name := range []string{"setTimeout", "setInterval", "clearTimeout", "clearInterval"} {
			_ = vm.GlobalObject().Delete(name)
		}
		// No eval or Function constructor: prevent dynamic code generation.
		_ = vm.GlobalObject().Delete("eval")
		_, _ = vm.RunString("Function = undefined;")
		// Deterministic execution: freeze Math.random and Date.now.
		_, _ = vm.RunString("Math.random = function() { return 0; }; Date.now = function() { return 0; };")

		// Execute the code
		val, err := vm.RunString(jsCode)
		if err != nil {
			// Check for interrupt
			if interrupted, ok := err.(*goja.InterruptedError); ok {
				ch <- execResult{err: fmt.Errorf("execution timeout exceeded (%s): %s", timeout, interrupted.Value())}
				return
			}
			ch <- execResult{err: fmt.Errorf("execution error: %w", err)}
			return
		}

		// JSON-serialize the result
		exported := val.Export()
		if exported == nil {
			ch <- execResult{result: &Result{Value: json.RawMessage("null")}}
			return
		}

		data, err := json.Marshal(exported)
		if err != nil {
			ch <- execResult{err: fmt.Errorf("failed to serialize result: %w", err)}
			return
		}

		// Enforce output size limit
		if r.config.MaxOutputBytes > 0 && len(data) > r.config.MaxOutputBytes {
			ch <- execResult{err: fmt.Errorf("output size %d exceeds limit %d", len(data), r.config.MaxOutputBytes)}
			return
		}

		ch <- execResult{result: &Result{Value: json.RawMessage(data)}}
	}()

	defer close(done)

	select {
	case res := <-ch:
		return res.result, res.err
	case <-ctx.Done():
		return nil, fmt.Errorf("execution cancelled: %w", ctx.Err())
	case <-time.After(timeout + 2*time.Second):
		return nil, fmt.Errorf("execution timeout exceeded (%s)", timeout)
	}
}

// convertGojaArgs converts goja call arguments to Go values.
func convertGojaArgs(_ *goja.Runtime, call goja.FunctionCall) []any {
	args := make([]any, len(call.Arguments))
	for i, arg := range call.Arguments {
		args[i] = arg.Export()
	}
	return args
}

// goToGojaValue converts a Go value to a goja Value.
func goToGojaValue(vm *goja.Runtime, v any) goja.Value {
	if v == nil {
		return goja.Null()
	}

	switch val := v.(type) {
	case string:
		return vm.ToValue(val)
	case bool:
		return vm.ToValue(val)
	case int:
		return vm.ToValue(val)
	case int32:
		return vm.ToValue(val)
	case int64:
		return vm.ToValue(val)
	case float64:
		return vm.ToValue(val)
	case json.RawMessage:
		return jsonToGojaValue(vm, val)
	default:
		// Marshal to JSON and parse back to get proper goja types
		data, err := json.Marshal(v)
		if err != nil {
			return goja.Undefined()
		}
		return jsonToGojaValue(vm, data)
	}
}

// jsonToGojaValue parses JSON bytes into a Go value and converts to a goja Value.
// Uses json.Unmarshal instead of vm.RunString to avoid code injection risks.
func jsonToGojaValue(vm *goja.Runtime, jsonData []byte) goja.Value {
	var v any
	if err := json.Unmarshal(jsonData, &v); err != nil {
		return goja.Undefined()
	}
	return vm.ToValue(v)
}

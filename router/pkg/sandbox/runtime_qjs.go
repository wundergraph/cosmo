package sandbox

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/fastschema/qjs"
)

// qjsRuntime executes JavaScript code in a QuickJS WASM sandbox.
// Provides native Promise support, WASM memory isolation, and resource limits.
type qjsRuntime struct {
	config ExecutionConfig
}

// asyncResult holds a completed async function result delivered via channel.
// Goroutines do Go work (HTTP calls etc.) concurrently, then send results here.
// The WASM thread drains results and resolves promises, keeping all WASM access single-threaded.
type asyncResult struct {
	promise *qjs.Value
	value   any
	err     error
}

func newQJSRuntime(config ExecutionConfig) *qjsRuntime {
	return &qjsRuntime{config: config}
}

// Execute runs JavaScript code with the provided globals in an isolated QuickJS sandbox.
// Each call creates a fresh QuickJS runtime — no state leaks between executions.
func (r *qjsRuntime) Execute(ctx context.Context, jsCode string, syncFuncs []SyncFunc, asyncFuncs []AsyncFunc, objects []ObjectDef) (result *Result, retErr error) {
	// Wrap context with timeout for reliable interruption.
	// CloseOnContextDone closes the WASM module on context cancellation,
	// which causes panics in any in-flight qjs calls. We recover from those.
	timeout := r.config.Timeout
	if timeout <= 0 {
		timeout = 5 * time.Second
	}
	execCtx, execCancel := context.WithTimeout(ctx, timeout)
	defer execCancel()

	// When CloseOnContextDone fires, the WASM module is forcibly closed.
	// All subsequent qjs calls (including cleanup) will panic.
	// We recover from these panics and return a timeout/cancellation error.
	defer func() {
		if r := recover(); r != nil {
			if execCtx.Err() != nil {
				retErr = fmt.Errorf("execution interrupted: %w", execCtx.Err())
			} else {
				retErr = fmt.Errorf("execution panic: %v", r)
			}
			result = nil
		}
	}()

	opts := qjs.Option{
		Context:            execCtx,
		CloseOnContextDone: true,
		MaxStackSize:       256 * 1024, // 256KB
	}

	if r.config.MaxMemoryMB > 0 {
		opts.MemoryLimit = r.config.MaxMemoryMB * 1024 * 1024
	}

	if r.config.Timeout > 0 {
		opts.MaxExecutionTime = int(r.config.Timeout.Milliseconds())
	}

	rt, err := qjs.New(opts)
	if err != nil {
		return nil, fmt.Errorf("failed to create qjs runtime: %w", err)
	}
	defer rt.Close()

	qctx := rt.Context()

	// Inject sync functions via SetAsyncFunc (not SetFunc).
	// This is necessary because values returned from SetFunc callbacks get corrupted
	// when they flow through async IIFE Promise wrapping in qjs/WASM. Using
	// SetAsyncFunc with Promise.Resolve() properly manages value lifetimes.
	// Since Promise resolution is synchronous (no goroutines), behavior is identical.
	for _, sf := range syncFuncs {
		fn := sf // capture
		qctx.SetAsyncFunc(fn.Name, func(this *qjs.This) {
			args := convertQJSArgs(this)
			result, fnErr := fn.Fn(args)
			if fnErr != nil {
				errVal := this.Context().NewError(fnErr)
				this.Promise().Reject(errVal)
				return
			}
			val, convErr := goToQJSValue(this.Context(), result)
			if convErr != nil {
				errVal := this.Context().NewError(convErr)
				this.Promise().Reject(errVal)
				return
			}
			this.Promise().Resolve(val)
		})
	}

	// Inject async functions with channel-based concurrency.
	// The callback converts args on the WASM thread, then launches a goroutine
	// for the Go work (HTTP calls etc.). The goroutine sends results to a channel.
	// The WASM thread drains the channel and resolves promises — keeping all
	// WASM access single-threaded while enabling true concurrency for Promise.all.
	const maxConcurrentAsync = 64
	resultCh := make(chan asyncResult, maxConcurrentAsync)
	asyncSem := make(chan struct{}, maxConcurrentAsync)
	done := make(chan struct{})
	defer close(done)

	for _, af := range asyncFuncs {
		fn := af // capture
		qctx.SetAsyncFunc(fn.Name, func(this *qjs.This) {
			args := convertQJSArgs(this) // read args on WASM thread
			promise := this.Promise()    // capture promise for later resolution
			asyncSem <- struct{}{}       // limit in-flight goroutines
			go func() {
				var res any
				var fnErr error
				defer func() {
					<-asyncSem
					if r := recover(); r != nil {
						fnErr = fmt.Errorf("sandbox panic: %v", r)
					}
					select {
					case resultCh <- asyncResult{promise: promise, value: res, err: fnErr}:
					case <-done:
					}
				}()
				res, fnErr = fn.Fn(args)
			}()
		})
	}

	// Inject objects with methods
	for _, od := range objects {
		obj := qctx.NewObject()
		for methodName, methodFn := range od.Methods {
			mfn := methodFn // capture
			fnVal := qctx.Function(func(this *qjs.This) (*qjs.Value, error) {
				args := convertQJSArgs(this)
				result, fnErr := mfn(args)
				if fnErr != nil {
					return nil, fnErr
				}
				return goToQJSValue(this.Context(), result)
			}, false)
			obj.SetPropertyStr(methodName, fnVal)
		}
		qctx.Global().SetPropertyStr(od.Name, obj)
	}

	// Remove dangerous globals that QuickJS provides by default.
	// Timers can bypass timeout limits, eval/Function enable dynamic code generation,
	// and Math.random/Date.now can leak timing info or enable non-determinism.
	for _, name := range []string{"setTimeout", "setInterval", "clearTimeout", "clearInterval"} {
		qctx.Global().DeleteProperty(name)
	}

	// Remove eval and Function constructor to prevent dynamic code generation (RFC security rule #4).
	qctx.Global().DeleteProperty("eval")
	if _, err := qctx.Eval("lockdown.js", qjs.Code("Function = undefined; Math.random = function() { return 0; }; Date.now = function() { return 0; };")); err != nil {
		return nil, fmt.Errorf("sandbox lockdown failed: %w", err)
	}

	var val *qjs.Value

	if len(asyncFuncs) > 0 {
		// With async functions, we CANNOT use FlagAsync because QJS_Eval blocks
		// inside js_std_await for any Promise result — preventing our goroutines
		// from delivering results via the channel.
		//
		// Instead, wrap the user code so the eval returns a non-Promise (0).
		// The async IIFE captures the result in __sr, which we poll for.
		// Strip trailing semicolons/whitespace from the code so it's a clean
		// expression inside await().
		trimmedCode := strings.TrimRight(jsCode, "; \t\n\r")

		// Harden __sr: the internal state variables (_d, _ok, _v, _e) live in
		// an IIFE closure inaccessible to user code. The global __sr is a
		// non-writable, non-configurable getter that returns a snapshot, so
		// user code cannot tamper with completion status.
		wrappedCode := `(function(){` +
			`var _d=false,_ok,_v,_e;` +
			`Object.defineProperty(globalThis,'__sr',{get:function(){return{d:_d,ok:_ok,v:_v,e:_e}},configurable:false});` +
			`(async function(){try{` +
			`_v=await(` + trimmedCode + `);_ok=true;` +
			`}catch(e){_e=e;_ok=false;}` +
			`_d=true;})();})();0`

		_, err = qctx.Eval("sandbox.js", qjs.Code(wrappedCode))
		if err != nil {
			return nil, fmt.Errorf("execution error: %w", err)
		}

		val, err = awaitAsyncResults(execCtx, qctx, resultCh)
		if err != nil {
			return nil, fmt.Errorf("execution error: %w", err)
		}
	} else {
		// No async functions — safe to use FlagAsync + Await (all promises resolve
		// synchronously inside js_std_await on the WASM thread).
		val, err = qctx.Eval("sandbox.js", qjs.Code(jsCode), qjs.FlagAsync())
		if err != nil {
			return nil, fmt.Errorf("execution error: %w", err)
		}
		if val != nil && val.IsPromise() {
			val, err = val.Await()
			if err != nil {
				return nil, fmt.Errorf("execution error: %w", err)
			}
		}
	}

	// Handle null/undefined
	if val == nil || val.IsNull() || val.IsUndefined() {
		return &Result{Value: json.RawMessage("null")}, nil
	}

	// Serialize to JSON using JS-native JSON.stringify instead of the Go-level
	// JSONStringify. This avoids a qjs/WASM memory corruption bug where
	// JSONStringify returns corrupt data for certain value sizes after Await().
	qctx.Global().SetPropertyStr("__qjs_result", val)
	strVal, err := qctx.Eval("serialize.js", qjs.Code("JSON.stringify(__qjs_result)"))
	qctx.Global().DeleteProperty("__qjs_result")
	if err != nil {
		return nil, fmt.Errorf("failed to serialize result: %w", err)
	}
	jsonStr := strVal.String()

	// Enforce output size limit
	if r.config.MaxOutputBytes > 0 && len(jsonStr) > r.config.MaxOutputBytes {
		return nil, fmt.Errorf("output size %d exceeds limit %d", len(jsonStr), r.config.MaxOutputBytes)
	}

	return &Result{Value: json.RawMessage(jsonStr)}, nil
}


// awaitAsyncResults polls for goroutine results and resolves their promises on
// the WASM thread. The caller's JS code was wrapped to store its result in __sr
// (a global variable), avoiding a Promise return that would block QJS_Eval.
// This keeps all WASM access single-threaded while goroutines run concurrently.
func awaitAsyncResults(ctx context.Context, qctx *qjs.Context, resultCh <-chan asyncResult) (*qjs.Value, error) {
	for {
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}

		// Check if the async wrapper has completed.
		// The previous Eval's js_std_loop already processed pending microtasks,
		// so __sr.d reflects the current state.
		checkVal, _ := qctx.Eval("_c.js", qjs.Code("__sr.d===true"))
		if checkVal != nil && checkVal.Bool() {
			okVal, _ := qctx.Eval("_ok.js", qjs.Code("__sr.ok===true"))
			if okVal == nil || !okVal.Bool() {
				errStr, _ := qctx.Eval("_e.js", qjs.Code("String(__sr.e)"))
				return nil, fmt.Errorf("%s", errStr.String())
			}
			resultVal, _ := qctx.Eval("_r.js", qjs.Code("__sr.v"))
			return resultVal, nil
		}

		// Drain completed goroutine results, resolving promises on the WASM thread.
		// Each resolution is wrapped in a recovery closure because WASM calls
		// (goToQJSValue, NewError, Resolve, Reject) can panic if the module is in
		// a bad state. A panic resolving one promise shouldn't abort the entire execution.
		drained := false
	drain:
		for {
			select {
			case res := <-resultCh:
				if err := resolveAsyncResult(qctx, res); err != nil {
					return nil, err
				}
				drained = true
			default:
				break drain
			}
		}

		if drained {
			// Process JS microtasks from the resolved promises (runs js_std_loop).
			qctx.Eval("_d.js", qjs.Code("void 0"))
			continue // Re-check — the drain may have completed the wrapper
		}

		// Nothing ready yet — sleep briefly to avoid busy-spinning.
		time.Sleep(time.Millisecond)
	}
}

// resolveAsyncResult resolves or rejects a single async promise on the WASM thread.
// It recovers from WASM panics so that a corrupted module doesn't crash the process.
func resolveAsyncResult(qctx *qjs.Context, res asyncResult) (retErr error) {
	defer func() {
		if r := recover(); r != nil {
			retErr = fmt.Errorf("sandbox panic resolving promise: %v", r)
		}
	}()
	if res.err != nil {
		errVal := qctx.NewError(res.err)
		res.promise.Reject(errVal)
	} else {
		v, convErr := goToQJSValue(qctx, res.value)
		if convErr != nil {
			errVal := qctx.NewError(convErr)
			res.promise.Reject(errVal)
		} else {
			res.promise.Resolve(v)
		}
	}
	return nil
}

// convertQJSArgs converts qjs function arguments to Go values.
func convertQJSArgs(this *qjs.This) []any {
	qjsArgs := this.Args()
	args := make([]any, len(qjsArgs))
	for i, arg := range qjsArgs {
		args[i] = qjsValueToGo(arg)
	}
	return args
}

// qjsValueToGo converts a qjs Value to a Go value.
func qjsValueToGo(val *qjs.Value) any {
	if val.IsNull() || val.IsUndefined() {
		return nil
	}
	if val.IsBool() {
		return val.Bool()
	}
	if val.IsNumber() {
		f := val.Float64()
		if f == float64(int64(f)) {
			return int64(f)
		}
		return f
	}
	if val.IsString() {
		return val.String()
	}
	// For objects/arrays, serialize to JSON and parse back to Go.
	// JSONStringify is safe here because these are function arguments received
	// in callbacks — not post-Await values, which trigger the WASM corruption
	// bug documented at the result serialization site (uses JSON.stringify via eval).
	jsonStr, err := val.JSONStringify()
	if err != nil {
		return nil
	}
	var result any
	if err := json.Unmarshal([]byte(jsonStr), &result); err != nil {
		return nil
	}
	return result
}

// goToQJSValue converts a Go value to a qjs Value.
func goToQJSValue(ctx *qjs.Context, v any) (*qjs.Value, error) {
	if v == nil {
		return ctx.ParseJSON("null"), nil
	}

	switch val := v.(type) {
	case string:
		return ctx.NewString(val), nil
	case bool:
		return ctx.NewBool(val), nil
	case int:
		return ctx.NewInt64(int64(val)), nil
	case int32:
		return ctx.NewInt32(val), nil
	case int64:
		return ctx.NewInt64(val), nil
	case float64:
		return ctx.NewFloat64(val), nil
	case json.RawMessage:
		return ctx.ParseJSON(string(val)), nil
	default:
		data, err := json.Marshal(v)
		if err != nil {
			return nil, fmt.Errorf("failed to marshal value to JSON: %w", err)
		}
		return ctx.ParseJSON(string(data)), nil
	}
}

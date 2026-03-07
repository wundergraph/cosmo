package sandbox

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func defaultConfig() ExecutionConfig {
	return ExecutionConfig{
		Timeout:        30 * time.Second, // 30s to accommodate WASM cold start on CI
		MaxMemoryMB:    16,
		MaxOutputBytes: 1024 * 1024,
	}
}

// wrap simulates what the transpiler does: wraps an async IIFE
func wrap(code string) string {
	return fmt.Sprintf("(async function() { %s })()", code)
}

func TestRuntime_BasicExecution(t *testing.T) {
	r := NewRuntime(defaultConfig())
	result, err := r.Execute(context.Background(), `(function() { return 42; })()`, nil, nil, nil)
	require.NoError(t, err)
	assert.Equal(t, json.RawMessage("42"), result.Value)
}

func TestRuntime_ReturnObject(t *testing.T) {
	r := NewRuntime(defaultConfig())
	result, err := r.Execute(context.Background(), `(function() { return { name: "test", value: 123 }; })()`, nil, nil, nil)
	require.NoError(t, err)

	var obj map[string]any
	require.NoError(t, json.Unmarshal(result.Value, &obj))
	assert.Equal(t, "test", obj["name"])
	assert.Equal(t, float64(123), obj["value"])
}

func TestRuntime_ReturnArray(t *testing.T) {
	r := NewRuntime(defaultConfig())
	result, err := r.Execute(context.Background(), `(function() { return [1, 2, 3]; })()`, nil, nil, nil)
	require.NoError(t, err)

	var arr []any
	require.NoError(t, json.Unmarshal(result.Value, &arr))
	assert.Len(t, arr, 3)
}

func TestRuntime_ReturnNull(t *testing.T) {
	r := NewRuntime(defaultConfig())
	result, err := r.Execute(context.Background(), `(function() { return null; })()`, nil, nil, nil)
	require.NoError(t, err)
	assert.Equal(t, json.RawMessage("null"), result.Value)
}

func TestRuntime_ReturnUndefined(t *testing.T) {
	r := NewRuntime(defaultConfig())
	result, err := r.Execute(context.Background(), `(function() { return undefined; })()`, nil, nil, nil)
	require.NoError(t, err)
	assert.Equal(t, json.RawMessage("null"), result.Value)
}

func TestRuntime_SyncFunctionInjection(t *testing.T) {
	r := NewRuntime(defaultConfig())
	funcs := []SyncFunc{
		{
			Name: "add",
			Fn: func(args []any) (any, error) {
				a, _ := args[0].(int64)
				b, _ := args[1].(int64)
				return a + b, nil
			},
		},
	}
	result, err := r.Execute(context.Background(), `(function() { return add(10, 20); })()`, funcs, nil, nil)
	require.NoError(t, err)
	assert.Equal(t, json.RawMessage("30"), result.Value)
}

func TestRuntime_SyncFunctionReturnsObject(t *testing.T) {
	r := NewRuntime(defaultConfig())
	funcs := []SyncFunc{
		{
			Name: "getData",
			Fn: func(args []any) (any, error) {
				return map[string]any{"key": "value", "count": 42}, nil
			},
		},
	}
	result, err := r.Execute(context.Background(), `(function() { return getData(); })()`, funcs, nil, nil)
	require.NoError(t, err)

	var obj map[string]any
	require.NoError(t, json.Unmarshal(result.Value, &obj))
	assert.Equal(t, "value", obj["key"])
	assert.Equal(t, float64(42), obj["count"])
}

func TestRuntime_ObjectInjection(t *testing.T) {
	r := NewRuntime(defaultConfig())
	objects := []ObjectDef{
		{
			Name: "schema",
			Methods: map[string]func(args []any) (any, error){
				"queries": func(args []any) (any, error) {
					return []map[string]any{
						{"name": "users", "description": "Get all users"},
					}, nil
				},
				"type": func(args []any) (any, error) {
					name, _ := args[0].(string)
					if name == "User" {
						return map[string]any{"name": "User", "kind": "OBJECT"}, nil
					}
					return nil, nil
				},
			},
		},
	}
	result, err := r.Execute(context.Background(), wrap(`
		var q = schema.queries();
		var t = schema.type("User");
		return { queries: q, userType: t };
	`), nil, nil, objects)
	require.NoError(t, err)

	var obj map[string]any
	require.NoError(t, json.Unmarshal(result.Value, &obj))
	queries := obj["queries"].([]any)
	assert.Len(t, queries, 1)
	typeInfo := obj["userType"].(map[string]any)
	assert.Equal(t, "User", typeInfo["name"])
}

func TestRuntime_ObjectMethodReturnsNull(t *testing.T) {
	r := NewRuntime(defaultConfig())
	objects := []ObjectDef{
		{
			Name: "schema",
			Methods: map[string]func(args []any) (any, error){
				"type": func(args []any) (any, error) {
					return nil, nil
				},
			},
		},
	}
	result, err := r.Execute(context.Background(), `(function() { return schema.type("Missing"); })()`, nil, nil, objects)
	require.NoError(t, err)
	assert.Equal(t, json.RawMessage("null"), result.Value)
}

// --- Security tests (100% coverage required) ---

func TestRuntime_TimeoutKillsInfiniteLoop(t *testing.T) {
	r := NewRuntime(ExecutionConfig{
		Timeout:        500 * time.Millisecond,
		MaxMemoryMB:    16,
		MaxOutputBytes: 1024,
	})
	_, err := r.Execute(context.Background(), `(function() { while(true) {} })()`, nil, nil, nil)
	require.Error(t, err)
}

func TestRuntime_ContextCancellationStopsExecution(t *testing.T) {
	r := NewRuntime(ExecutionConfig{
		Timeout:        10 * time.Second,
		MaxMemoryMB:    16,
		MaxOutputBytes: 1024,
	})
	ctx, cancel := context.WithCancel(context.Background())
	go func() {
		time.Sleep(200 * time.Millisecond)
		cancel()
	}()
	_, err := r.Execute(ctx, `(function() { while(true) {} })()`, nil, nil, nil)
	require.Error(t, err)
}

func TestRuntime_NoSetTimeout(t *testing.T) {
	r := NewRuntime(defaultConfig())
	result, err := r.Execute(context.Background(), `(function() { return typeof setTimeout; })()`, nil, nil, nil)
	require.NoError(t, err)
	assert.Equal(t, json.RawMessage(`"undefined"`), result.Value)
}

func TestRuntime_NoSetInterval(t *testing.T) {
	r := NewRuntime(defaultConfig())
	result, err := r.Execute(context.Background(), `(function() { return typeof setInterval; })()`, nil, nil, nil)
	require.NoError(t, err)
	assert.Equal(t, json.RawMessage(`"undefined"`), result.Value)
}

func TestRuntime_NoFetch(t *testing.T) {
	r := NewRuntime(defaultConfig())
	result, err := r.Execute(context.Background(), `(function() { return typeof fetch; })()`, nil, nil, nil)
	require.NoError(t, err)
	assert.Equal(t, json.RawMessage(`"undefined"`), result.Value)
}

func TestRuntime_NoRequire(t *testing.T) {
	r := NewRuntime(defaultConfig())
	result, err := r.Execute(context.Background(), `(function() { return typeof require; })()`, nil, nil, nil)
	require.NoError(t, err)
	assert.Equal(t, json.RawMessage(`"undefined"`), result.Value)
}

func TestRuntime_NoProcess(t *testing.T) {
	r := NewRuntime(defaultConfig())
	result, err := r.Execute(context.Background(), `(function() { return typeof process; })()`, nil, nil, nil)
	require.NoError(t, err)
	assert.Equal(t, json.RawMessage(`"undefined"`), result.Value)
}

func TestRuntime_NoEval(t *testing.T) {
	r := NewRuntime(defaultConfig())
	result, err := r.Execute(context.Background(), `(function() { return typeof eval; })()`, nil, nil, nil)
	require.NoError(t, err)
	assert.Equal(t, json.RawMessage(`"undefined"`), result.Value)
}

func TestRuntime_MathRandomDeterministic(t *testing.T) {
	r := NewRuntime(defaultConfig())
	result, err := r.Execute(context.Background(), `(function() { return Math.random(); })()`, nil, nil, nil)
	require.NoError(t, err)
	assert.Equal(t, json.RawMessage(`0`), result.Value)
}

func TestRuntime_DateNowDeterministic(t *testing.T) {
	r := NewRuntime(defaultConfig())
	result, err := r.Execute(context.Background(), `(function() { return Date.now(); })()`, nil, nil, nil)
	require.NoError(t, err)
	assert.Equal(t, json.RawMessage(`0`), result.Value)
}

func TestRuntime_NoGlobalsLeakBetweenExecutions(t *testing.T) {
	r := NewRuntime(defaultConfig())

	// First execution sets a global
	_, err := r.Execute(context.Background(), `(function() { globalThis.leaked = 42; return 1; })()`, nil, nil, nil)
	require.NoError(t, err)

	// Second execution should not see it (fresh VM each time)
	result, err := r.Execute(context.Background(), `(function() { return typeof globalThis.leaked; })()`, nil, nil, nil)
	require.NoError(t, err)
	assert.Equal(t, json.RawMessage(`"undefined"`), result.Value)
}

func TestRuntime_JSErrorReturnsStructuredError(t *testing.T) {
	r := NewRuntime(defaultConfig())
	_, err := r.Execute(context.Background(), `(function() { throw new Error("test error"); })()`, nil, nil, nil)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "test error")
}

func TestRuntime_SyntaxErrorReturnsError(t *testing.T) {
	r := NewRuntime(defaultConfig())
	_, err := r.Execute(context.Background(), `(function() { invalid syntax here })()`, nil, nil, nil)
	require.Error(t, err)
}

func TestRuntime_OutputSizeLimitEnforced(t *testing.T) {
	r := NewRuntime(ExecutionConfig{
		Timeout:        5 * time.Second,
		MaxMemoryMB:    16,
		MaxOutputBytes: 100,
	})
	// Return a large string that exceeds the limit
	_, err := r.Execute(context.Background(), `(function() { var s = ""; for(var i=0;i<200;i++) s+="x"; return s; })()`, nil, nil, nil)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "output size")
}

func TestRuntime_MemoryLimitViaTimeout(t *testing.T) {
	r := NewRuntime(ExecutionConfig{
		Timeout:        1 * time.Second,
		MaxMemoryMB:    1,
		MaxOutputBytes: 1024 * 1024,
	})
	_, err := r.Execute(context.Background(), `(function() {
		var arr = [];
		for (var i = 0; i < 100000000; i++) { arr.push("x".repeat(1000)); }
		return arr.length;
	})()`, nil, nil, nil)
	require.Error(t, err)
}

// --- Multiple calls / chaining ---

func TestRuntime_MultipleCallsSyncFuncs(t *testing.T) {
	r := NewRuntime(defaultConfig())
	syncFuncs := []SyncFunc{
		{
			Name: "getValue",
			Fn: func(args []any) (any, error) {
				key, _ := args[0].(string)
				return "value_" + key, nil
			},
		},
	}
	result, err := r.Execute(context.Background(), wrap(`
		var a = await getValue("a");
		var b = await getValue("b");
		return [a, b];
	`), syncFuncs, nil, nil)
	require.NoError(t, err)

	var arr []string
	require.NoError(t, json.Unmarshal(result.Value, &arr))
	assert.Equal(t, []string{"value_a", "value_b"}, arr)
}

func TestRuntime_ChainedSyncCalls(t *testing.T) {
	r := NewRuntime(defaultConfig())
	callCount := 0
	syncFuncs := []SyncFunc{
		{
			Name: "getUser",
			Fn: func(args []any) (any, error) {
				callCount++
				return map[string]any{"id": "u1", "name": "Alice"}, nil
			},
		},
		{
			Name: "getOrders",
			Fn: func(args []any) (any, error) {
				callCount++
				userId, _ := args[0].(string)
				return []map[string]any{{"id": "o1", "userId": userId, "total": 100}}, nil
			},
		},
	}
	result, err := r.Execute(context.Background(), wrap(`
		var user = await getUser();
		var orders = await getOrders(user.id);
		return { user: user, orders: orders };
	`), syncFuncs, nil, nil)
	require.NoError(t, err)
	assert.Equal(t, 2, callCount)

	var obj map[string]any
	require.NoError(t, json.Unmarshal(result.Value, &obj))
	require.NotNil(t, obj["user"])
	user := obj["user"].(map[string]any)
	assert.Equal(t, "Alice", user["name"])
	require.NotNil(t, obj["orders"])
	orders := obj["orders"].([]any)
	assert.Len(t, orders, 1)
}

// --- Edge cases ---

func TestRuntime_ReturnString(t *testing.T) {
	r := NewRuntime(defaultConfig())
	result, err := r.Execute(context.Background(), `(function() { return "hello world"; })()`, nil, nil, nil)
	require.NoError(t, err)
	assert.Equal(t, json.RawMessage(`"hello world"`), result.Value)
}

func TestRuntime_ReturnBoolean(t *testing.T) {
	r := NewRuntime(defaultConfig())
	result, err := r.Execute(context.Background(), `(function() { return true; })()`, nil, nil, nil)
	require.NoError(t, err)
	assert.Equal(t, json.RawMessage("true"), result.Value)
}

func TestRuntime_SyncFunctionError(t *testing.T) {
	r := NewRuntime(defaultConfig())
	funcs := []SyncFunc{
		{
			Name: "failingFunc",
			Fn: func(args []any) (any, error) {
				return nil, fmt.Errorf("intentional error")
			},
		},
	}
	_, err := r.Execute(context.Background(), `(function() { return failingFunc(); })()`, funcs, nil, nil)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "intentional error")
}

func TestRuntime_StringPassthrough(t *testing.T) {
	r := NewRuntime(defaultConfig())

	funcs := []SyncFunc{
		{
			Name: "validate",
			Fn: func(args []any) (any, error) {
				query, _ := args[0].(string)
				if strings.Contains(query, "invalid") {
					return []map[string]any{{"message": "syntax error"}}, nil
				}
				return []map[string]any{}, nil
			},
		},
	}

	result, err := r.Execute(context.Background(), `(function() { return validate("query { invalid }"); })()`, funcs, nil, nil)
	require.NoError(t, err)

	var errors []map[string]any
	require.NoError(t, json.Unmarshal(result.Value, &errors))
	assert.Len(t, errors, 1)
	assert.Equal(t, "syntax error", errors[0]["message"])
}

func TestRuntime_EmptyObjectReturn(t *testing.T) {
	r := NewRuntime(defaultConfig())
	result, err := r.Execute(context.Background(), `(function() { return {}; })()`, nil, nil, nil)
	require.NoError(t, err)
	assert.Equal(t, json.RawMessage("{}"), result.Value)
}

func TestRuntime_NestedObjectReturn(t *testing.T) {
	r := NewRuntime(defaultConfig())
	result, err := r.Execute(context.Background(), `(function() { return { a: { b: { c: 42 } } }; })()`, nil, nil, nil)
	require.NoError(t, err)

	var obj map[string]any
	require.NoError(t, json.Unmarshal(result.Value, &obj))
	a := obj["a"].(map[string]any)
	b := a["b"].(map[string]any)
	assert.Equal(t, float64(42), b["c"])
}

// --- Security hardening tests ---

func TestRuntime_NoFunctionConstructor(t *testing.T) {
	r := NewRuntime(defaultConfig())
	result, err := r.Execute(context.Background(), `(function() { return typeof Function; })()`, nil, nil, nil)
	require.NoError(t, err)
	assert.Equal(t, json.RawMessage(`"undefined"`), result.Value)
}

func TestRuntime_SrManipulationDoesNotShortCircuit(t *testing.T) {
	// __sr is the internal result holder for async code.
	// User code must not be able to set __sr.d=true to short-circuit the polling loop.
	r := NewRuntime(defaultConfig())

	called := false
	asyncFuncs := []AsyncFunc{
		{
			Name: "doWork",
			Fn: func(args []any) (any, error) {
				called = true
				return "real_result", nil
			},
		},
	}

	// Code attempts to tamper with __sr before calling the async function.
	// The hardened __sr should ignore direct property assignment.
	code := `(async function() {
		try { globalThis.__sr = {d:true, ok:true, v:"hacked"}; } catch(e) {}
		try { __sr.d = true; } catch(e) {}
		var result = await doWork();
		return result;
	})()`

	result, err := r.Execute(context.Background(), code, nil, asyncFuncs, nil)
	require.NoError(t, err)
	assert.True(t, called, "async function should have been called")
	assert.Equal(t, json.RawMessage(`"real_result"`), result.Value)
}

func TestPool_InputSizeLimitEnforced(t *testing.T) {
	pool := NewPool(1, ExecutionConfig{
		Timeout:        5 * time.Second,
		MaxMemoryMB:    16,
		MaxInputBytes:  100,
		MaxOutputBytes: 1024 * 1024,
	})
	defer pool.Close()

	// Small input should work
	result, err := pool.Execute(context.Background(), `(function() { return 1; })()`, nil, nil, nil)
	require.NoError(t, err)
	assert.Equal(t, json.RawMessage("1"), result.Value)

	// Large input should be rejected
	largeCode := `(function() { return "` + strings.Repeat("x", 200) + `"; })()`
	_, err = pool.Execute(context.Background(), largeCode, nil, nil, nil)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "input size")
}

package sandbox

import (
	"context"
	"encoding/json"
	"fmt"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// --- QJS-specific tests: native Promise support, WASM isolation ---

func TestQJS_AsyncFunctionWithAwait(t *testing.T) {
	r := NewRuntime(defaultConfig())
	asyncFuncs := []AsyncFunc{
		{
			Name: "fetchValue",
			Fn: func(args []any) (any, error) {
				return "async_result", nil
			},
		},
	}
	// Use async IIFE with await — only works with qjs native Promises
	result, err := r.Execute(context.Background(), `(async function() { var v = await fetchValue(); return v; })()`, nil, asyncFuncs, nil)
	require.NoError(t, err)
	assert.Equal(t, json.RawMessage(`"async_result"`), result.Value)
}

func TestQJS_AsyncFunctionReturnsObject(t *testing.T) {
	r := NewRuntime(defaultConfig())
	asyncFuncs := []AsyncFunc{
		{
			Name: "fetchData",
			Fn: func(args []any) (any, error) {
				return map[string]any{"items": []string{"a", "b"}}, nil
			},
		},
	}
	result, err := r.Execute(context.Background(), `(async function() { return await fetchData(); })()`, nil, asyncFuncs, nil)
	require.NoError(t, err)

	var obj map[string]any
	require.NoError(t, json.Unmarshal(result.Value, &obj))
	assert.NotNil(t, obj["items"])
}

func TestQJS_AsyncFunctionError(t *testing.T) {
	r := NewRuntime(defaultConfig())
	asyncFuncs := []AsyncFunc{
		{
			Name: "failingAsync",
			Fn: func(args []any) (any, error) {
				return nil, fmt.Errorf("async error")
			},
		},
	}
	_, err := r.Execute(context.Background(), `(async function() { return await failingAsync(); })()`, nil, asyncFuncs, nil)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "async error")
}

func TestQJS_ChainedAsyncCalls(t *testing.T) {
	r := NewRuntime(defaultConfig())
	callCount := int32(0)
	asyncFuncs := []AsyncFunc{
		{
			Name: "getUser",
			Fn: func(args []any) (any, error) {
				atomic.AddInt32(&callCount, 1)
				return map[string]any{"id": "u1", "name": "Alice"}, nil
			},
		},
		{
			Name: "getOrders",
			Fn: func(args []any) (any, error) {
				atomic.AddInt32(&callCount, 1)
				userId, _ := args[0].(string)
				return []map[string]any{{"id": "o1", "userId": userId, "total": 100}}, nil
			},
		},
	}
	result, err := r.Execute(context.Background(), `(async function() {
		var user = await getUser();
		var orders = await getOrders(user.id);
		return { user: user, orders: orders };
	})()`, nil, asyncFuncs, nil)
	require.NoError(t, err)
	assert.Equal(t, int32(2), atomic.LoadInt32(&callCount))

	var obj map[string]any
	require.NoError(t, json.Unmarshal(result.Value, &obj))
	user := obj["user"].(map[string]any)
	assert.Equal(t, "Alice", user["name"])
	orders := obj["orders"].([]any)
	assert.Len(t, orders, 1)
}

func TestQJS_PromiseAll(t *testing.T) {
	r := NewRuntime(defaultConfig())
	var callCount int32
	asyncFuncs := []AsyncFunc{
		{
			Name: "fetchItem",
			Fn: func(args []any) (any, error) {
				atomic.AddInt32(&callCount, 1)
				id, _ := args[0].(int64)
				return map[string]any{"id": id, "name": fmt.Sprintf("item_%d", id)}, nil
			},
		},
	}
	// Use Promise.all for parallel fan-out
	result, err := r.Execute(context.Background(), `(async function() {
		var items = await Promise.all([
			fetchItem(1),
			fetchItem(2),
			fetchItem(3)
		]);
		return items;
	})()`, nil, asyncFuncs, nil)
	require.NoError(t, err)
	assert.Equal(t, int32(3), atomic.LoadInt32(&callCount))

	var items []map[string]any
	require.NoError(t, json.Unmarshal(result.Value, &items))
	assert.Len(t, items, 3)
}

func TestQJS_MultipleAsyncCallsWithAwait(t *testing.T) {
	r := NewRuntime(defaultConfig())
	asyncFuncs := []AsyncFunc{
		{
			Name: "getValue",
			Fn: func(args []any) (any, error) {
				key, _ := args[0].(string)
				return map[string]any{"key": key, "value": "value_" + key}, nil
			},
		},
	}
	result, err := r.Execute(context.Background(), `(async function() {
		var a = await getValue("a");
		var b = await getValue("b");
		return { first: a.value, second: b.value };
	})()`, nil, asyncFuncs, nil)
	require.NoError(t, err)

	var obj map[string]any
	require.NoError(t, json.Unmarshal(result.Value, &obj))
	assert.Equal(t, "value_a", obj["first"])
	assert.Equal(t, "value_b", obj["second"])
}

func TestQJS_MemoryLimit(t *testing.T) {
	r := NewRuntime(ExecutionConfig{
		Timeout:        5 * time.Second,
		MaxMemoryMB:    1,
		MaxOutputBytes: 1024 * 1024,
	})
	// Try to allocate way more memory than allowed
	_, err := r.Execute(context.Background(), `(function() {
		var arr = [];
		for (var i = 0; i < 100000; i++) { arr.push("x".repeat(1000)); }
		return arr.length;
	})()`, nil, nil, nil)
	require.Error(t, err)
}

func TestQJS_MaxExecutionTime(t *testing.T) {
	r := NewRuntime(ExecutionConfig{
		Timeout:        500 * time.Millisecond,
		MaxMemoryMB:    16,
		MaxOutputBytes: 1024,
	})
	start := time.Now()
	_, err := r.Execute(context.Background(), `(function() { while(true) {} })()`, nil, nil, nil)
	elapsed := time.Since(start)
	require.Error(t, err)
	// Should stop within reasonable time of the timeout
	require.True(t, elapsed < 3*time.Second, "execution took %s, expected less than 3s", elapsed)
}

func TestQJS_MixedSyncAndAsyncFunctions(t *testing.T) {
	r := NewRuntime(defaultConfig())
	syncFuncs := []SyncFunc{
		{
			Name: "validate",
			Fn: func(args []any) (any, error) {
				query, _ := args[0].(string)
				if query == "" {
					return []map[string]any{{"message": "empty query"}}, nil
				}
				return nil, nil
			},
		},
	}
	asyncFuncs := []AsyncFunc{
		{
			Name: "generateQuery",
			Fn: func(args []any) (any, error) {
				prompt, _ := args[0].(string)
				return map[string]any{"query": "{ " + prompt + " { id } }"}, nil
			},
		},
	}
	result, err := r.Execute(context.Background(), `(async function() {
		var generated = await generateQuery("users");
		var errors = await validate(generated.query);
		return { query: generated.query, valid: errors === null };
	})()`, syncFuncs, asyncFuncs, nil)
	require.NoError(t, err)

	var obj map[string]any
	require.NoError(t, json.Unmarshal(result.Value, &obj))
	assert.Equal(t, "{ users { id } }", obj["query"])
	assert.Equal(t, true, obj["valid"])
}

func TestQJS_AsyncFunctionPanicRecovery(t *testing.T) {
	r := NewRuntime(defaultConfig())
	asyncFuncs := []AsyncFunc{
		{
			Name: "panicFunc",
			Fn: func(args []any) (any, error) {
				panic("simulated WASM crash")
			},
		},
	}
	_, err := r.Execute(context.Background(), `(async function() { return await panicFunc(); })()`, nil, asyncFuncs, nil)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "sandbox panic")
}

package sandbox

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/evanw/esbuild/pkg/api"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router/internal/codemode/storage"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"
)

type DeclinedGate struct {
	reason string
}

func (g DeclinedGate) Decide(context.Context, ApprovalRequest) (ApprovalDecision, error) {
	return ApprovalDecision{Approved: false, Reason: g.reason}, nil
}

type nameDeclinedGate struct {
	name   string
	reason string
}

func (g nameDeclinedGate) Decide(_ context.Context, req ApprovalRequest) (ApprovalDecision, error) {
	if req.Name == g.name {
		return ApprovalDecision{Approved: false, Reason: g.reason}, nil
	}
	return ApprovalDecision{Approved: true}, nil
}

type lookup map[string]storage.SessionOp

func (l lookup) get(_ context.Context, _ string, name string) (storage.SessionOp, bool, error) {
	op, ok := l[name]
	return op, ok, nil
}

func clientFunc(fn roundTripFunc) *http.Client {
	return &http.Client{Transport: fn}
}

func jsonResponse(status int, body string) *http.Response {
	return &http.Response{
		StatusCode: status,
		Header:     http.Header{"Content-Type": []string{"application/json"}},
		Body:       ioNopCloser{bytes.NewBufferString(body)},
	}
}

func newTestSandbox(t *testing.T, endpoint string, ops lookup, opts func(*Config)) *Sandbox {
	t.Helper()

	cfg := Config{
		RouterGraphQLEndpoint: endpoint,
		StorageLookup:         ops.get,
		RequestTimeout:        30 * time.Second,
		RetryAttempts:         0,
	}
	if opts != nil {
		opts(&cfg)
	}
	s, err := New(cfg)
	require.NoError(t, err)
	return s
}

func execute(t *testing.T, s *Sandbox, req ExecuteRequest) ExecuteResult {
	t.Helper()

	got, err := s.Execute(context.Background(), req)
	require.NoError(t, err)
	return got
}

func raw(s string) json.RawMessage {
	return json.RawMessage(s)
}

func TestExecuteHappyPathToolCall(t *testing.T) {
	var gotBody map[string]any
	client := clientFunc(func(r *http.Request) (*http.Response, error) {
		require.Equal(t, http.MethodPost, r.Method)
		require.NoError(t, json.NewDecoder(r.Body).Decode(&gotBody))
		return jsonResponse(http.StatusOK, `{"data":{"order":{"id":"o1"}}}`), nil
	})

	s := newTestSandbox(t, "http://router/graphql", lookup{
		"getOrder": {Name: "getOrder", Body: "query GetOrder($id: ID!) { order(id: $id) { id } }", Kind: storage.OperationKindQuery},
	}, func(cfg *Config) { cfg.HTTPClient = client })

	got := execute(t, s, ExecuteRequest{
		SessionID: "s1",
		ToolNames: []string{"getOrder"},
		WrappedJS: `async () => {
  return await tools.getOrder({ id: "o1" });
}`,
	})

	assert.Equal(t, "getOrder", gotBody["operationName"])
	assert.Equal(t, ExecuteResult{
		OK:        true,
		Result:    raw(`{"data":{"order":{"id":"o1"}}}`),
		HostCalls: 1,
	}, ExecuteResult{OK: got.OK, Result: got.Result, HostCalls: got.HostCalls})
}

func TestExecuteGraphQLErrorsResolveVerbatimAndRecordSpan(t *testing.T) {
	client := clientFunc(func(r *http.Request) (*http.Response, error) {
		return jsonResponse(http.StatusOK, `{"data":null,"errors":[{"message":"x"}]}`), nil
	})

	exporter := tracetest.NewInMemoryExporter()
	tp := trace.NewTracerProvider(trace.WithSyncer(exporter))
	old := otel.GetTracerProvider()
	otel.SetTracerProvider(tp)
	defer otel.SetTracerProvider(old)

	s := newTestSandbox(t, "http://router/graphql", lookup{
		"getBroken": {Name: "getBroken", Body: "query Broken { broken }", Kind: storage.OperationKindQuery},
	}, func(cfg *Config) { cfg.HTTPClient = client })

	ctx, span := otel.Tracer("sandbox-test").Start(context.Background(), "parent")
	got, err := s.Execute(ctx, ExecuteRequest{
		SessionID: "s1",
		ToolNames: []string{"getBroken"},
		WrappedJS: `async () => await tools.getBroken()`,
	})
	span.End()
	require.NoError(t, err)

	assert.Equal(t, ExecuteResult{
		OK:        true,
		Result:    raw(`{"data":null,"errors":[{"message":"x"}]}`),
		HostCalls: 1,
	}, ExecuteResult{OK: got.OK, Result: got.Result, HostCalls: got.HostCalls})
	spans := exporter.GetSpans()
	require.NotEmpty(t, spans)
	var found bool
	for _, sp := range spans {
		for _, attr := range sp.Attributes {
			if string(attr.Key) == "codemode.graphql.errors" && strings.Contains(attr.Value.AsString(), `"message":"x"`) {
				found = true
			}
		}
	}
	assert.Equal(t, true, found)
}

func TestExecuteHTTP500CanBeReturnedOrThrownByAgent(t *testing.T) {
	client := clientFunc(func(r *http.Request) (*http.Response, error) {
		return jsonResponse(http.StatusInternalServerError, `{"errors":[{"message":"upstream failed"}]}`), nil
	})

	s := newTestSandbox(t, "http://router/graphql", lookup{
		"getBroken": {Name: "getBroken", Body: "query Broken { broken }", Kind: storage.OperationKindQuery},
	}, func(cfg *Config) { cfg.HTTPClient = client })

	returned := execute(t, s, ExecuteRequest{
		SessionID: "s1",
		ToolNames: []string{"getBroken"},
		WrappedJS: `async () => await tools.getBroken()`,
	})
	assert.Equal(t, ExecuteResult{
		OK:        true,
		Result:    raw(`{"errors":[{"message":"upstream failed"}]}`),
		HostCalls: 1,
	}, ExecuteResult{OK: returned.OK, Result: returned.Result, HostCalls: returned.HostCalls})

	thrown := execute(t, s, ExecuteRequest{
		SessionID: "s1",
		ToolNames: []string{"getBroken"},
		WrappedJS: `async () => {
  const r = await tools.getBroken();
  if (r.errors?.length) throw new Error(r.errors[0].message);
  return r;
}`,
	})
	assert.Equal(t, false, thrown.OK)
	require.NotNil(t, thrown.Error)
	assert.Equal(t, "Error", thrown.Error.Name)
	assert.Equal(t, "upstream failed", thrown.Error.Message)
	assert.Equal(t, 1, thrown.HostCalls)
}

func TestExecuteConsoleUnavailable(t *testing.T) {
	s := newTestSandbox(t, "", lookup{}, nil)

	got := execute(t, s, ExecuteRequest{WrappedJS: `async () => { console.log("x"); }`})

	assert.Equal(t, false, got.OK)
	require.NotNil(t, got.Error)
	assert.Equal(t, ErrorEnvelope{
		Name:    "ConsoleUnavailable",
		Message: "console is not available in this sandbox. Include diagnostics in your return value, e.g. `return { result, debug: { ... } }`.",
		Stack:   got.Error.Stack,
	}, *got.Error)
}

func TestExecuteEvalAndFunctionRemoved(t *testing.T) {
	s := newTestSandbox(t, "", lookup{}, nil)

	tests := []struct {
		name      string
		wrappedJS string
		want      json.RawMessage
	}{
		{
			name:      "typeof eval",
			wrappedJS: `async () => { return typeof eval; }`,
			want:      raw(`"undefined"`),
		},
		{
			name:      "typeof Function",
			wrappedJS: `async () => { return typeof Function; }`,
			want:      raw(`"undefined"`),
		},
		{
			name:      "indirect eval",
			wrappedJS: `async () => { try { (0, eval)("1+1"); return "ok"; } catch (e) { return e.name + ":" + e.message; } }`,
			want:      raw(`"ReferenceError:eval is not defined"`),
		},
		{
			name:      "new Function",
			wrappedJS: `async () => { try { new Function("return 1"); return "ok"; } catch (e) { return e.name + ":" + e.message; } }`,
			want:      raw(`"ReferenceError:Function is not defined"`),
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := execute(t, s, ExecuteRequest{WrappedJS: tt.wrappedJS})

			assert.Equal(t, ExecuteResult{OK: true, Result: tt.want}, ExecuteResult{OK: got.OK, Result: got.Result})
		})
	}
}

func TestExecuteDeterministicDateAndRandom(t *testing.T) {
	s := newTestSandbox(t, "", lookup{}, nil)

	got := execute(t, s, ExecuteRequest{WrappedJS: `async () => ({
  random: Math.random(),
  now: Date.now(),
  epoch: new Date().getTime(),
  parsed: new Date(123).getTime()
})`})

	assert.Equal(t, ExecuteResult{
		OK:     true,
		Result: raw(`{"random":0,"now":0,"epoch":0,"parsed":123}`),
	}, ExecuteResult{OK: got.OK, Result: got.Result})
}

func TestExecuteAllowsConfiguredHostCallCapAndThrowsOnNextCall(t *testing.T) {
	var calls atomic.Int32
	client := clientFunc(func(r *http.Request) (*http.Response, error) {
		calls.Add(1)
		return jsonResponse(http.StatusOK, `{"data":{"ok":true}}`), nil
	})
	s := newTestSandbox(t, "http://router/graphql", lookup{
		"foo": {Name: "foo", Body: "query Foo { foo }", Kind: storage.OperationKindQuery},
	}, func(cfg *Config) { cfg.HTTPClient = client })

	withinCap := execute(t, s, ExecuteRequest{
		SessionID: "s1",
		ToolNames: []string{"foo"},
		WrappedJS: `async () => {
  for (let i = 0; i < 256; i++) await tools.foo({});
  return "ok";
}`,
	})

	assert.Equal(t, ExecuteResult{
		OK:        true,
		Result:    raw(`"ok"`),
		HostCalls: 256,
	}, ExecuteResult{OK: withinCap.OK, Result: withinCap.Result, HostCalls: withinCap.HostCalls})
	assert.Equal(t, int32(256), calls.Load())

	got := execute(t, s, ExecuteRequest{
		SessionID: "s1",
		ToolNames: []string{"foo"},
		WrappedJS: `async () => {
  for (let i = 0; i < 257; i++) await tools.foo({});
  return null;
}`,
	})

	assert.Equal(t, false, got.OK)
	require.NotNil(t, got.Error)
	assert.Equal(t, "HostCallLimitExceeded", got.Error.Name)
	assert.Equal(t, "tools.* invocation cap of 256 exceeded; batch independent calls with Promise.all.", got.Error.Message)
	assert.Equal(t, 257, got.HostCalls)
	assert.Equal(t, int32(512), calls.Load())
}

func TestExecutePromiseAllToolCallsRunInParallel(t *testing.T) {
	var calls atomic.Int32
	client := clientFunc(func(r *http.Request) (*http.Response, error) {
		calls.Add(1)
		return jsonResponse(http.StatusOK, `{"data":{"ok":true}}`), nil
	})
	s := newTestSandbox(t, "http://router/graphql", lookup{
		"ping": {Name: "ping", Body: "query Ping { ping }", Kind: storage.OperationKindQuery},
	}, func(cfg *Config) { cfg.HTTPClient = client })

	got := execute(t, s, ExecuteRequest{
		SessionID: "s1",
		ToolNames: []string{"ping"},
		WrappedJS: `async () => Promise.all([tools.ping(), tools.ping(), tools.ping(), tools.ping()])`,
	})

	assert.Equal(t, true, got.OK)
	assert.Equal(t, 4, got.HostCalls)
	assert.Equal(t, int32(4), calls.Load())
}

func TestExecuteAcceptsTopLevelAwaitStringAsHarnessDeviation(t *testing.T) {
	s := newTestSandbox(t, "", lookup{}, nil)

	got := execute(t, s, ExecuteRequest{WrappedJS: `async () => await Promise.resolve(1)`})

	assert.Equal(t, ExecuteResult{OK: true, Result: raw(`1`)}, ExecuteResult{OK: got.OK, Result: got.Result})
}

func TestExecuteWallClockTimeout(t *testing.T) {
	s := newTestSandbox(t, "", lookup{}, func(cfg *Config) {
		cfg.RequestTimeout = 25 * time.Millisecond
	})

	got := execute(t, s, ExecuteRequest{WrappedJS: `async () => await new Promise(() => {})`})

	assert.Equal(t, false, got.OK)
	require.NotNil(t, got.Error)
	assert.Equal(t, "Timeout", got.Error.Name)
}

func TestExecuteMemoryLimit(t *testing.T) {
	s := newTestSandbox(t, "", lookup{}, func(cfg *Config) {
		cfg.MemoryLimitBytes = 2 << 20
	})

	got := execute(t, s, ExecuteRequest{WrappedJS: `async () => {
  const xs = [];
  for (let i = 0; i < 1000000; i++) xs.push("xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx");
  return xs.length;
}`})

	assert.Equal(t, false, got.OK)
	require.NotNil(t, got.Error)
	assert.Equal(t, "MemoryLimit", got.Error.Name)
}

func TestExecuteSanitizesNonSerializableField(t *testing.T) {
	s := newTestSandbox(t, "", lookup{}, nil)

	got := execute(t, s, ExecuteRequest{WrappedJS: `async () => ({ x: () => 1 })`})

	assert.Equal(t, true, got.OK)
	assert.Nil(t, got.Error)
	assert.Equal(t, json.RawMessage(`{"x":"<<non-serializable: function>>"}`), got.Result)
	assert.Equal(t, []SerializationWarning{{Path: "$.x", Kind: "function"}}, got.Warnings)
}

func TestExecuteSanitizesMixedNonSerializableValues(t *testing.T) {
	s := newTestSandbox(t, "", lookup{}, nil)

	got := execute(t, s, ExecuteRequest{WrappedJS: `async () => { return { x: () => 1, y: 5n, cycle: (() => { const o = {}; o.self = o; return o; })() }; }`})

	assert.Equal(t, true, got.OK)
	assert.Nil(t, got.Error)
	assert.Equal(t, json.RawMessage(`{"x":"<<non-serializable: function>>","y":"<<non-serializable: bigint>>","cycle":{"self":"<<non-serializable: cycle>>"}}`), got.Result)
	assert.Equal(t, []SerializationWarning{
		{Path: "$.x", Kind: "function"},
		{Path: "$.y", Kind: "bigint"},
		{Path: "$.cycle.self", Kind: "cycle"},
	}, got.Warnings)
}

func TestExecuteSanitizesRootBigInt(t *testing.T) {
	s := newTestSandbox(t, "", lookup{}, nil)

	got := execute(t, s, ExecuteRequest{WrappedJS: `async () => 5n`})

	assert.Equal(t, true, got.OK)
	assert.Nil(t, got.Error)
	assert.Equal(t, json.RawMessage(`"<<non-serializable: bigint>>"`), got.Result)
	assert.Equal(t, []SerializationWarning{{Path: "$", Kind: "bigint"}}, got.Warnings)
}

func TestExecuteSanitizesRootUndefined(t *testing.T) {
	s := newTestSandbox(t, "", lookup{}, nil)

	got := execute(t, s, ExecuteRequest{WrappedJS: `async () => undefined`})

	assert.Equal(t, true, got.OK)
	assert.Nil(t, got.Error)
	assert.Equal(t, json.RawMessage(`"<<non-serializable: undefined>>"`), got.Result)
	assert.Equal(t, []SerializationWarning{{Path: "$", Kind: "undefined"}}, got.Warnings)
}

func TestExecuteSanitizesNonSerializableInArray(t *testing.T) {
	s := newTestSandbox(t, "", lookup{}, nil)

	got := execute(t, s, ExecuteRequest{WrappedJS: `async () => [1, undefined, () => 2]`})

	assert.Equal(t, true, got.OK)
	assert.Nil(t, got.Error)
	assert.Equal(t, json.RawMessage(`[1,"<<non-serializable: undefined>>","<<non-serializable: function>>"]`), got.Result)
	assert.Equal(t, []SerializationWarning{
		{Path: "$[1]", Kind: "undefined"},
		{Path: "$[2]", Kind: "function"},
	}, got.Warnings)
}

func TestExecuteCleanResultProducesNoWarnings(t *testing.T) {
	s := newTestSandbox(t, "", lookup{}, nil)

	got := execute(t, s, ExecuteRequest{WrappedJS: `async () => ({ ok: true, n: 1, items: [1, 2, 3] })`})

	assert.Equal(t, true, got.OK)
	assert.Nil(t, got.Error)
	assert.Equal(t, json.RawMessage(`{"ok":true,"n":1,"items":[1,2,3]}`), got.Result)
	assert.Equal(t, []SerializationWarning(nil), got.Warnings)
}

func TestExecuteOutputTooLarge(t *testing.T) {
	s := newTestSandbox(t, "", lookup{}, func(cfg *Config) {
		cfg.MaxOutputSizeBytes = 10
	})

	got := execute(t, s, ExecuteRequest{WrappedJS: `async () => "this is too large"`})

	assert.Equal(t, false, got.OK)
	require.NotNil(t, got.Error)
	assert.Equal(t, "OutputTooLarge", got.Error.Name)
	assert.Contains(t, got.Error.Message, "encoded result size")
}

func TestExecuteErrorCauseChain(t *testing.T) {
	s := newTestSandbox(t, "", lookup{}, nil)

	got := execute(t, s, ExecuteRequest{WrappedJS: `async () => {
  throw new Error("a", { cause: new Error("b", { cause: new Error("c") }) });
}`})

	assert.Equal(t, false, got.OK)
	require.NotNil(t, got.Error)
	assert.Equal(t, "a", got.Error.Message)
	require.NotNil(t, got.Error.Cause)
	assert.Equal(t, "b", got.Error.Cause.Message)
	require.NotNil(t, got.Error.Cause.Cause)
	assert.Equal(t, "c", got.Error.Cause.Cause.Message)
	assert.Nil(t, got.Error.Cause.Cause.Cause)
}

func TestExecuteErrorCauseChainTruncatesAfterDepthFive(t *testing.T) {
	s := newTestSandbox(t, "", lookup{}, nil)

	got := execute(t, s, ExecuteRequest{WrappedJS: `async () => {
  let err = new Error("7");
  for (let i = 6; i >= 1; i--) err = new Error(String(i), { cause: err });
  throw err;
}`})

	assert.Equal(t, false, got.OK)
	require.NotNil(t, got.Error)
	cause := got.Error
	for range 5 {
		require.NotNil(t, cause.Cause)
		cause = cause.Cause
	}
	assert.Equal(t, "TruncatedCause", cause.Name)
	assert.Equal(t, "cause chain exceeded depth 5", cause.Message)
}

func TestExecuteSourceMapRewrite(t *testing.T) {
	ts := "async () => {\n  const x: number = 1;\n  throw new Error(\"boom\");\n}"
	transformed := api.Transform(ts, api.TransformOptions{
		Loader:     api.LoaderTS,
		Sourcemap:  api.SourceMapExternal,
		Sourcefile: "agent.ts",
	})
	require.Empty(t, transformed.Errors)
	js := strings.TrimSpace(string(transformed.Code))
	js = strings.TrimSuffix(js, ";")
	s := newTestSandbox(t, "", lookup{}, nil)

	got := execute(t, s, ExecuteRequest{WrappedJS: js, SourceMap: []byte(transformed.Map)})

	assert.Equal(t, false, got.OK)
	require.NotNil(t, got.Error)
	assert.Contains(t, got.Error.Stack, "agent.ts:3:")
}

func TestExecuteMutationApprovalDeclined(t *testing.T) {
	var calls atomic.Int32
	client := clientFunc(func(r *http.Request) (*http.Response, error) {
		calls.Add(1)
		return jsonResponse(http.StatusOK, `{"data":{"ok":true}}`), nil
	})
	s := newTestSandbox(t, "http://router/graphql", lookup{
		"deleteOrder": {Name: "deleteOrder", Body: "mutation DeleteOrder { deleteOrder }", Kind: storage.OperationKindMutation},
	}, func(cfg *Config) { cfg.HTTPClient = client })

	got := execute(t, s, ExecuteRequest{
		SessionID:      "s1",
		ToolNames:      []string{"deleteOrder"},
		ApprovalGate:   DeclinedGate{reason: "no thanks"},
		WrappedJS:      `async () => await tools.deleteOrder({ id: "o1" })`,
		RequestHeaders: http.Header{},
	})

	assert.Equal(t, int32(0), calls.Load())
	assert.Equal(t, ExecuteResult{
		OK:        true,
		Result:    raw(`{"data":null,"declined":{"reason":"no thanks"},"errors":[{"message":"Mutation declined by operator: no thanks"}]}`),
		HostCalls: 1,
	}, ExecuteResult{OK: got.OK, Result: got.Result, HostCalls: got.HostCalls})
}

func TestExecuteSpecificMutationApprovalDeclinedReturnsStructuredValue(t *testing.T) {
	var calls atomic.Int32
	client := clientFunc(func(r *http.Request) (*http.Response, error) {
		calls.Add(1)
		return jsonResponse(http.StatusOK, `{"data":{"ok":true}}`), nil
	})
	s := newTestSandbox(t, "http://router/graphql", lookup{
		"deleteOrders": {Name: "deleteOrders", Body: "mutation DeleteOrders($id: ID!) { deleteOrders(id: $id) }", Kind: storage.OperationKindMutation},
	}, func(cfg *Config) { cfg.HTTPClient = client })

	got := execute(t, s, ExecuteRequest{
		SessionID:      "s1",
		ToolNames:      []string{"deleteOrders"},
		ApprovalGate:   nameDeclinedGate{name: "deleteOrders", reason: "policy forbids"},
		WrappedJS:      `async () => { const r = await tools.deleteOrders({id:"x"}); return r; }`,
		RequestHeaders: http.Header{},
	})

	assert.Equal(t, int32(0), calls.Load())
	assert.Equal(t, ExecuteResult{
		OK:        true,
		Result:    raw(`{"data":null,"declined":{"reason":"policy forbids"},"errors":[{"message":"Mutation declined by operator: policy forbids"}]}`),
		HostCalls: 1,
	}, ExecuteResult{OK: got.OK, Result: got.Result, HostCalls: got.HostCalls})
}

func TestExecuteHeaderAllowList(t *testing.T) {
	seen := make(chan http.Header, 1)
	client := clientFunc(func(r *http.Request) (*http.Response, error) {
		seen <- r.Header.Clone()
		return jsonResponse(http.StatusOK, `{"data":{"ok":true}}`), nil
	})
	s := newTestSandbox(t, "http://router/graphql", lookup{
		"ping": {Name: "ping", Body: "query Ping { ping }", Kind: storage.OperationKindQuery},
	}, func(cfg *Config) {
		cfg.HeaderAllowList = []string{"Authorization", "X-Trace"}
		cfg.HTTPClient = client
	})

	got := execute(t, s, ExecuteRequest{
		SessionID: "s1",
		ToolNames: []string{"ping"},
		WrappedJS: `async () => await tools.ping()`,
		RequestHeaders: http.Header{
			"Authorization": []string{"Bearer token"},
			"X-Trace":       []string{"trace-1"},
			"X-Skip":        []string{"skip"},
			"Connection":    []string{"keep-alive"},
		},
	})

	headers := <-seen
	assert.Equal(t, true, got.OK)
	assert.Equal(t, "Bearer token", headers.Get("Authorization"))
	assert.Equal(t, "trace-1", headers.Get("X-Trace"))
	assert.Equal(t, "", headers.Get("X-Skip"))
	assert.Equal(t, "", headers.Get("Connection"))
	assert.Equal(t, "application/json", headers.Get("Content-Type"))
}

func TestExecuteSemaphoreBoundsConcurrency(t *testing.T) {
	var active atomic.Int32
	var maxActive atomic.Int32
	started := make(chan struct{}, 5)
	release := make(chan struct{})
	client := &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		now := active.Add(1)
		for {
			max := maxActive.Load()
			if now <= max || maxActive.CompareAndSwap(max, now) {
				break
			}
		}
		started <- struct{}{}
		<-release
		active.Add(-1)
		return &http.Response{
			StatusCode: http.StatusOK,
			Header:     make(http.Header),
			Body:       ioNopCloser{bytes.NewBufferString(`{"data":{"ok":true}}`)},
		}, nil
	})}
	s := newTestSandbox(t, "http://router/graphql", lookup{
		"ping": {Name: "ping", Body: "query Ping { ping }", Kind: storage.OperationKindQuery},
	}, func(cfg *Config) {
		cfg.MaxConcurrent = 4
		cfg.HTTPClient = client
	})

	var wg sync.WaitGroup
	for range 5 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, err := s.Execute(context.Background(), ExecuteRequest{
				SessionID: "s1",
				ToolNames: []string{"ping"},
				WrappedJS: `async () => await tools.ping()`,
			})
			assert.NoError(t, err)
		}()
	}

	for range 4 {
		<-started
	}
	assert.Equal(t, int32(4), maxActive.Load())
	assert.Equal(t, int32(4), active.Load())
	select {
	case <-started:
		t.Fatal("fifth Execute entered before a semaphore slot was released")
	default:
	}
	close(release)
	wg.Wait()
	assert.Equal(t, int32(4), maxActive.Load())
}

func TestExecuteFrozenToolsAssignmentThrowsInStrictMode(t *testing.T) {
	s := newTestSandbox(t, "", lookup{
		"foo": {Name: "foo", Body: "query Foo { foo }", Kind: storage.OperationKindQuery},
	}, nil)

	got := execute(t, s, ExecuteRequest{ToolNames: []string{"foo"}, WrappedJS: `async () => {
  tools.foo = () => null;
  return tools.foo === null;
}`})

	assert.Equal(t, false, got.OK)
	require.NotNil(t, got.Error)
	assert.Equal(t, "TypeError", got.Error.Name)
}

func TestExecuteUnknownToolName(t *testing.T) {
	s := newTestSandbox(t, "", lookup{}, nil)

	got := execute(t, s, ExecuteRequest{WrappedJS: `async () => await tools.nope()`})

	assert.Equal(t, false, got.OK)
	require.NotNil(t, got.Error)
	assert.Equal(t, "TypeError", got.Error.Name)
	// qjs reports native missing-method calls in this form for plain objects.
	assert.Equal(t, "tools.nope is not a function", got.Error.Message)
}

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(r *http.Request) (*http.Response, error) {
	return f(r)
}

type ioNopCloser struct {
	*bytes.Buffer
}

func (c ioNopCloser) Close() error {
	return nil
}

package module_test

import (
	"bytes"
	"encoding/json"
	"fmt"
	"maps"
	"net/http"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/core"
)

// bufferingModule is a RouterMiddlewareHandler that captures the response from
// downstream handlers in an in-memory buffer, then decides what to write to the
// real response writer. This pattern requires the router to propagate the writer
// parameter through the middleware chain; otherwise inner modules bypass the
// buffer and write directly to the original response writer.
type bufferingModule struct{}

func (m *bufferingModule) Module() core.ModuleInfo {
	return core.ModuleInfo{
		ID:       "bufferingModule",
		Priority: 1,
		New: func() core.Module {
			return &bufferingModule{}
		},
	}
}

func (m *bufferingModule) Middleware(ctx core.RequestContext, next http.Handler) {
	w := ctx.ResponseWriter()

	bw := &capturingWriter{header: make(http.Header)}
	next.ServeHTTP(bw, ctx.Request())

	// Set a header proving how many bytes the buffer captured. If the writer
	// was not propagated, the engine writes to the real writer directly and
	// bw stays empty — the header will be "0".
	maps.Copy(w.Header(), bw.header)
	w.Header().Set("X-Buffer-Captured-Bytes", fmt.Sprintf("%d", bw.body.Len()))
	if bw.code != 0 {
		w.WriteHeader(bw.code)
	}
	_, _ = w.Write(bw.body.Bytes())
}

// passthroughModule is a no-op RouterMiddlewareHandler that simply forwards to
// the next handler. When placed after bufferingModule in the middleware chain,
// it exercises the code path where the router must propagate the writer to
// reqContext.responseWriter so that ctx.ResponseWriter() returns the buffered
// writer from the outer module rather than the original response writer.
type passthroughModule struct{}

func (m *passthroughModule) Module() core.ModuleInfo {
	return core.ModuleInfo{
		ID:       "passthroughModule",
		Priority: 2,
		New: func() core.Module {
			return &passthroughModule{}
		},
	}
}

func (m *passthroughModule) Middleware(ctx core.RequestContext, next http.Handler) {
	next.ServeHTTP(ctx.ResponseWriter(), ctx.Request())
}

type capturingWriter struct {
	header http.Header
	code   int
	body   bytes.Buffer
}

func (w *capturingWriter) Header() http.Header { return w.header }
func (w *capturingWriter) WriteHeader(code int) {
	if w.code == 0 {
		w.code = code
	}
}
func (w *capturingWriter) Write(b []byte) (int, error) {
	if w.code == 0 {
		w.code = http.StatusOK
	}
	return w.body.Write(b)
}

// secondPassthroughModule is another no-op RouterMiddlewareHandler used to test
// chains of 3+ modules.
type secondPassthroughModule struct{}

func (m *secondPassthroughModule) Module() core.ModuleInfo {
	return core.ModuleInfo{
		ID:       "secondPassthroughModule",
		Priority: 3,
		New: func() core.Module {
			return &secondPassthroughModule{}
		},
	}
}

func (m *secondPassthroughModule) Middleware(ctx core.RequestContext, next http.Handler) {
	next.ServeHTTP(ctx.ResponseWriter(), ctx.Request())
}

// bufferingOnRequestModule is a RouterOnRequestHandler that captures the
// response in a buffer, mirroring bufferingModule but for the OnRequest hook.
type bufferingOnRequestModule struct{}

func (m *bufferingOnRequestModule) Module() core.ModuleInfo {
	return core.ModuleInfo{
		ID:       "bufferingOnRequestModule",
		Priority: 1,
		New: func() core.Module {
			return &bufferingOnRequestModule{}
		},
	}
}

func (m *bufferingOnRequestModule) RouterOnRequest(ctx core.RequestContext, next http.Handler) {
	w := ctx.ResponseWriter()

	bw := &capturingWriter{header: make(http.Header)}
	next.ServeHTTP(bw, ctx.Request())

	maps.Copy(w.Header(), bw.header)
	w.Header().Set("X-Buffer-Captured-Bytes", fmt.Sprintf("%d", bw.body.Len()))
	if bw.code != 0 {
		w.WriteHeader(bw.code)
	}
	_, _ = w.Write(bw.body.Bytes())
}

// passthroughOnRequestModule is a no-op RouterOnRequestHandler.
type passthroughOnRequestModule struct{}

func (m *passthroughOnRequestModule) Module() core.ModuleInfo {
	return core.ModuleInfo{
		ID:       "passthroughOnRequestModule",
		Priority: 2,
		New: func() core.Module {
			return &passthroughOnRequestModule{}
		},
	}
}

func (m *passthroughOnRequestModule) RouterOnRequest(ctx core.RequestContext, next http.Handler) {
	next.ServeHTTP(ctx.ResponseWriter(), ctx.Request())
}

// transformingModule is a RouterMiddlewareHandler that captures the response and
// injects a "_buffered":true field into the JSON body before writing it out.
// If the buffer is bypassed (writer not propagated), the transformation does not
// happen and the body assertion fails — proving the bug purely via response body.
type transformingModule struct{}

func (m *transformingModule) Module() core.ModuleInfo {
	return core.ModuleInfo{
		ID:       "transformingModule",
		Priority: 1,
		New: func() core.Module {
			return &transformingModule{}
		},
	}
}

func (m *transformingModule) Middleware(ctx core.RequestContext, next http.Handler) {
	w := ctx.ResponseWriter()

	bw := &capturingWriter{header: make(http.Header)}
	next.ServeHTTP(bw, ctx.Request())

	// Inject "_buffered":true into the captured JSON body.
	var obj map[string]json.RawMessage
	body := bw.body.Bytes()
	if json.Unmarshal(body, &obj) == nil {
		obj["_buffered"] = json.RawMessage(`true`)
		body, _ = json.Marshal(obj)
	}

	maps.Copy(w.Header(), bw.header)
	w.Header().Del("Content-Length")
	if bw.code != 0 {
		w.WriteHeader(bw.code)
	}
	_, _ = w.Write(body)
}

// TestMultiModuleMiddlewareWriterPropagation verifies that the router correctly
// propagates the http.ResponseWriter through chained RouterMiddlewareHandler
// modules. Without this fix (router.go discarding the writer parameter), an
// inner module would use the original response writer instead of the buffered
// writer from the outer module, causing double-writes or lost buffering.
func TestMultiModuleMiddlewareWriterPropagation(t *testing.T) {
	t.Parallel()

	t.Run("buffering module captures response when a passthrough module is also registered", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithCustomModules(
					&bufferingModule{},
					&passthroughModule{},
				),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				Query: `query { employee(id: 1) { id } }`,
			})
			require.NoError(t, err)

			assert.Equal(t, http.StatusOK, res.Response.StatusCode)
			assert.Equal(t, `{"data":{"employee":{"id":1}}}`, res.Body)
			// Verify the response actually flowed through the buffer.
			// Without writer propagation the buffer stays empty ("0").
			assert.NotEmpty(t, res.Response.Header.Get("X-Buffer-Captured-Bytes"),
				"X-Buffer-Captured-Bytes header must be set by the buffering module")
			assert.NotEqual(t, "0", res.Response.Header.Get("X-Buffer-Captured-Bytes"),
				"buffer must have captured bytes — 0 means the engine bypassed the buffer")
		})
	})

	t.Run("single module without passthrough still works", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithCustomModules(&bufferingModule{}),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				Query: `query { employee(id: 1) { id } }`,
			})
			require.NoError(t, err)

			assert.Equal(t, http.StatusOK, res.Response.StatusCode)
			assert.Equal(t, `{"data":{"employee":{"id":1}}}`, res.Body)
			assert.NotEqual(t, "0", res.Response.Header.Get("X-Buffer-Captured-Bytes"),
				"buffer must have captured bytes")
		})
	})

	t.Run("three module deep chain propagates writer correctly", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithCustomModules(
					&bufferingModule{},
					&passthroughModule{},
					&secondPassthroughModule{},
				),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				Query: `query { employee(id: 1) { id } }`,
			})
			require.NoError(t, err)

			assert.Equal(t, http.StatusOK, res.Response.StatusCode)
			assert.Equal(t, `{"data":{"employee":{"id":1}}}`, res.Body)
			assert.NotEqual(t, "0", res.Response.Header.Get("X-Buffer-Captured-Bytes"),
				"buffer must have captured bytes")
		})
	})

	t.Run("transforming module modifies captured body proving buffer was used", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithCustomModules(
					&transformingModule{},
					&passthroughModule{},
				),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				Query: `query { employee(id: 1) { id } }`,
			})
			require.NoError(t, err)

			assert.Equal(t, http.StatusOK, res.Response.StatusCode)
			// The transforming module injects "_buffered":true into the JSON.
			// If the buffer was bypassed, the body would be the unmodified
			// engine response without this field.
			assert.JSONEq(t,
				`{"data":{"employee":{"id":1}},"_buffered":true}`,
				res.Body,
			)
		})
	})
}

// TestMultiModuleOnRequestWriterPropagation verifies writer propagation for
// RouterOnRequestHandler modules (the same fix as RouterMiddlewareHandler).
func TestMultiModuleOnRequestWriterPropagation(t *testing.T) {
	t.Parallel()

	t.Run("buffering on-request module captures response with passthrough", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithCustomModules(
					&bufferingOnRequestModule{},
					&passthroughOnRequestModule{},
				),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				Query: `query { employee(id: 1) { id } }`,
			})
			require.NoError(t, err)

			assert.Equal(t, http.StatusOK, res.Response.StatusCode)
			assert.Equal(t, `{"data":{"employee":{"id":1}}}`, res.Body)
			assert.NotEmpty(t, res.Response.Header.Get("X-Buffer-Captured-Bytes"),
				"X-Buffer-Captured-Bytes header must be set by the buffering module")
			assert.NotEqual(t, "0", res.Response.Header.Get("X-Buffer-Captured-Bytes"),
				"buffer must have captured bytes — 0 means the engine bypassed the buffer")
		})
	})

	t.Run("single on-request module without passthrough still works", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithCustomModules(&bufferingOnRequestModule{}),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				Query: `query { employee(id: 1) { id } }`,
			})
			require.NoError(t, err)

			assert.Equal(t, http.StatusOK, res.Response.StatusCode)
			assert.Equal(t, `{"data":{"employee":{"id":1}}}`, res.Body)
			assert.NotEqual(t, "0", res.Response.Header.Get("X-Buffer-Captured-Bytes"),
				"buffer must have captured bytes")
		})
	})
}

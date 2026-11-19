package requestid

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/wundergraph/cosmo/router/core"
)

type requestContext struct {
	core.RequestContext
	writer  http.ResponseWriter
	request *http.Request
}

func (c *requestContext) ResponseWriter() http.ResponseWriter { return c.writer }
func (c *requestContext) Request() *http.Request              { return c.request }

func serve(t *testing.T, request *http.Request, next http.HandlerFunc) *httptest.ResponseRecorder {
	t.Helper()
	recorder := httptest.NewRecorder()
	module := &RequestID{}
	module.RouterOnRequest(&requestContext{writer: recorder, request: request}, next)
	return recorder
}

func ok(w http.ResponseWriter, _ *http.Request) {
	w.WriteHeader(http.StatusOK)
}

func TestGeneratesOneRequestID(t *testing.T) {
	recorder := serve(t, httptest.NewRequest(http.MethodPost, "/graphql", nil), ok)

	values := recorder.Result().Header.Values("X-Request-ID")
	if len(values) != 1 {
		t.Fatalf("want exactly one X-Request-ID header, got %d: %v", len(values), values)
	}
	if len(values[0]) != 32 {
		t.Fatalf("want a 32 character generated ID, got %q", values[0])
	}
}

func TestGeneratedRequestIDsDiffer(t *testing.T) {
	first := serve(t, httptest.NewRequest(http.MethodPost, "/graphql", nil), ok)
	second := serve(t, httptest.NewRequest(http.MethodPost, "/graphql", nil), ok)

	if first.Header().Get("X-Request-ID") == second.Header().Get("X-Request-ID") {
		t.Fatalf("want a new ID for each request, got %q twice", first.Header().Get("X-Request-ID"))
	}
}

func TestKeepsTheCallersRequestID(t *testing.T) {
	request := httptest.NewRequest(http.MethodPost, "/graphql", nil)
	request.Header.Set("X-Request-ID", "from-caller")

	recorder := serve(t, request, ok)

	values := recorder.Result().Header.Values("X-Request-ID")
	if len(values) != 1 || values[0] != "from-caller" {
		t.Fatalf("want [from-caller], got %v", values)
	}
}

func TestCallsTheNextHandler(t *testing.T) {
	recorder := serve(t, httptest.NewRequest(http.MethodPost, "/graphql", nil), func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusTeapot)
	})

	if recorder.Code != http.StatusTeapot {
		t.Fatalf("want the next handler's status 418, got %d", recorder.Code)
	}
}

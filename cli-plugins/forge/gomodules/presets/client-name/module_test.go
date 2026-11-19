package clientname

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

func serve(t *testing.T, module *ClientName, request *http.Request) (*httptest.ResponseRecorder, bool) {
	t.Helper()
	if err := module.Provision(&core.ModuleContext{}); err != nil {
		t.Fatalf("provision: %v", err)
	}
	recorder := httptest.NewRecorder()
	reachedRouter := false
	module.RouterOnRequest(&requestContext{writer: recorder, request: request}, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		reachedRouter = true
		w.WriteHeader(http.StatusOK)
	}))
	return recorder, reachedRouter
}

func TestRejectsRequestWithoutClientName(t *testing.T) {
	recorder, reachedRouter := serve(t, &ClientName{}, httptest.NewRequest(http.MethodPost, "/graphql", nil))

	if reachedRouter {
		t.Fatal("want the request stopped before the router, but the next handler ran")
	}
	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("want status 400, got %d", recorder.Code)
	}
	want := `{"errors":[{"message":"Missing required header GraphQL-Client-Name. Send the name of your client in it."}]}` + "\n"
	if recorder.Body.String() != want {
		t.Fatalf("want body %q, got %q", want, recorder.Body.String())
	}
}

func TestPassesRequestWithClientName(t *testing.T) {
	request := httptest.NewRequest(http.MethodPost, "/graphql", nil)
	request.Header.Set("GraphQL-Client-Name", "web")

	recorder, reachedRouter := serve(t, &ClientName{}, request)

	if !reachedRouter || recorder.Code != http.StatusOK {
		t.Fatalf("want the request passed through with 200, got reached=%v status=%d", reachedRouter, recorder.Code)
	}
}

func TestUsesTheConfiguredHeader(t *testing.T) {
	withDefaultHeader := httptest.NewRequest(http.MethodPost, "/graphql", nil)
	withDefaultHeader.Header.Set("GraphQL-Client-Name", "web")
	recorder, reachedRouter := serve(t, &ClientName{Header: "X-Client"}, withDefaultHeader)
	if reachedRouter || recorder.Code != http.StatusBadRequest {
		t.Fatalf("want 400 when only the default header is sent, got reached=%v status=%d", reachedRouter, recorder.Code)
	}

	withConfiguredHeader := httptest.NewRequest(http.MethodPost, "/graphql", nil)
	withConfiguredHeader.Header.Set("X-Client", "web")
	recorder, reachedRouter = serve(t, &ClientName{Header: "X-Client"}, withConfiguredHeader)
	if !reachedRouter || recorder.Code != http.StatusOK {
		t.Fatalf("want 200 when the configured header is sent, got reached=%v status=%d", reachedRouter, recorder.Code)
	}
}

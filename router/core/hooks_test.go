package core

import (
	"testing"
	"fmt"
	"net/http"
	"io"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"
	"go.uber.org/zap/zaptest"
	"github.com/wundergraph/cosmo/router/internal/utils"
	"net/http/httptest"
)

func TestRouterHooksMiddleware(t *testing.T) {
	t.Parallel()

	t.Run("router_hooks_middleware_short_circuit_on_request_hook_error", func(t *testing.T) {
		fakeHooks := &hookRegistry{
			routerRequestHooks: utils.NewOrderedSet[RouterRequestHook](),
			routerResponseHooks: utils.NewOrderedSet[RouterResponseHook](),
		}

		fakeHooks.routerRequestHooks.Add(&routerRequestHookMock{
			fn: func(reqContext RequestContext, rp *RouterRequestParams) error {
			return fmt.Errorf("blocker")
		}})

		nextCalled := false
		nextHandler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			nextCalled = true
			w.WriteHeader(200)
			w.Write([]byte(`{"data":{"foo":"bar"}}`))
		})

		mw := RouterHooksMiddleware("/graphql", fakeHooks, zaptest.NewLogger(t))
		server := httptest.NewServer(mw(nextHandler))
		defer server.Close()
	
		resp, err := http.Get(server.URL + "/graphql")
		require.NoError(t, err)
		defer resp.Body.Close()
	
		require.False(t, nextCalled, "next.ServeHTTP should not have been called")
		assert.Equal(t, http.StatusForbidden, resp.StatusCode)
	
		bodyBytes, _ := io.ReadAll(resp.Body)
		assert.Contains(t, string(bodyBytes), "blocker")
	})

	t.Run("router_hooks_middleware_propagates_successful_request_to_next_and_runs_response_hook", func(t *testing.T) {
		fakeHooks := &hookRegistry{
			routerRequestHooks: utils.NewOrderedSet[RouterRequestHook](),
			routerResponseHooks: utils.NewOrderedSet[RouterResponseHook](),
		}

		fakeHooks.routerRequestHooks.Add(&routerRequestHookMock{
			fn: func(reqContext RequestContext, rp *RouterRequestParams) error {				
				rp.Logger.Info("request hook saw:", zap.String("path", rp.HttpRequest.URL.Path))
				return nil
			}})

		fakeHooks.routerResponseHooks.Add(&routerResponseHookMock{
			fn: func(reqContext RequestContext, rp *RouterResponseParams, exitErr *ExitError) error {
			rp.Controller.SetStatusCode(418)
			rp.Controller.SetHeader("Content-Type", "text/plain")
			rp.Controller.SetBody([]byte("testing"))
			return nil
		}})
	
		nextHandler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(200)
			w.Write([]byte(`{"data":{"foo":"bar"}}`))
		})
	
		mw := RouterHooksMiddleware("/graphql", fakeHooks, zaptest.NewLogger(t))
		server := httptest.NewServer(mw(nextHandler))
		defer server.Close()
	
		resp, err := http.Get(server.URL + "/graphql")
		require.NoError(t, err)
		defer resp.Body.Close()
	
		assert.Equal(t, 418, resp.StatusCode)
		bodyBytes, _ := io.ReadAll(resp.Body)
		assert.Equal(t, "testing", string(bodyBytes))
	})
}

type routerRequestHookMock struct {
	fn func(reqContext RequestContext, rp *RouterRequestParams) error
}

type routerResponseHookMock struct {
	fn func(reqContext RequestContext, rp *RouterResponseParams, exitErr *ExitError) error
}

func (m *routerRequestHookMock) OnRouterRequest(reqContext RequestContext, rp *RouterRequestParams) error {
	return m.fn(reqContext, rp)
}

func (m *routerResponseHookMock) OnRouterResponse(reqContext RequestContext, rp *RouterResponseParams, exitErr *ExitError) error {
	return m.fn(reqContext, rp, exitErr)
}

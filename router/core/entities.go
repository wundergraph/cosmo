package core

import (
	"net/http"

	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"go.uber.org/zap"
)

/* hook specific entities that are implemented by the open core module system */

// ApplicationParams is passed to ApplicationStartHook/ApplicationStopHook
type ApplicationParams struct {
	// the global configuration
	Config *config.Config
	Logger *zap.Logger
}

// GraphQLServerParams is passed to GraphQLServerStartHook/GraphQLServerStopHook
type GraphQLServerParams struct {
	// The HTTP Handler that actually serves /graphql
	Handler http.Handler

	// The router-level configuration
	Config *nodev1.RouterConfig

	Logger *zap.Logger
}

// RouterRequestParams is passed to RouterRequestHook
type RouterRequestParams struct {
	// the raw incoming HTTP request
	HttpRequest *http.Request

	Logger *zap.Logger
}

// RouterResponseParams is passed to RouterResponseHook
type RouterResponseParams struct {
	RouterRequestParams
	// the original HTTP response
	HttpResponse *http.Response
	// Use the controller to inspect or mutate the response
	// the mutated response will be the actual response sent to the client
	Controller RouterResponseController
}

// RouterResponseController defines the things the hook can do
type RouterResponseController interface {
	// Get the status code of the response
	GetStatusCode() int
	// Set the status code of the response
	SetStatusCode(newStatusCode int) error
	// Get the body of the response
	GetBody() []byte
	// Set the body of the response
	SetBody(body []byte) error
	// Get the header map of the response
	GetHeaderMap() http.Header
	// Add a key-value pair to the response header map
	AddHeader(key, value string) error
	// Set the value of a key in the response header map
	SetHeader(key, value string) error
}

type routerResponseController struct {
    recorder responseRecorder
}

type responseRecorder struct {
	HeaderMap http.Header
	Body []byte
	Code int
}

func (c *routerResponseController) GetStatusCode() int {
	return c.recorder.Code
}

func (c *routerResponseController) SetStatusCode(newCode int) error {
    c.recorder.Code = newCode
    return nil
}

func (c *routerResponseController) GetHeaderMap() http.Header {
	return c.recorder.HeaderMap
}

func (c *routerResponseController) AddHeader(key, value string) error {
    c.recorder.HeaderMap.Add(key, value)
    return nil
}

func (c *routerResponseController) SetHeader(key, value string) error {
	c.recorder.HeaderMap.Set(key, value)
	return nil
}

func (c *routerResponseController) GetBody() []byte {
	return c.recorder.Body
}

func (c *routerResponseController) SetBody(body []byte) error {
	c.recorder.Body = body
	return nil
}

/* common entities for the open core module system */

// ExitError is a struct for holding the exit code and error of the router
type ExitError struct {
	Code int
	Err  error
}

func (e *ExitError) Error() string { return e.Err.Error() }

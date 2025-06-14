package core

import (
	"net/http"
	"time"
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

// OperationRequestParams is passed to OperationRequestHook
type OperationRequestParams struct {
	OperationContextParams

	Request *http.Request

	Controller OperationRequestController

	Logger *zap.Logger
}

// OperationRequestController defines the things the hook can do
type OperationRequestController interface {
	SetClientInfo(clientInfo ClientInfo) error
	GetClientInfo() ClientInfo
}

type operationRequestController struct {
	recorder operationRequestRecorder
}

type operationRequestRecorder struct {
	ClientInfo ClientInfo
}

func (c *operationRequestController) SetClientInfo(clientInfo ClientInfo) error {
	c.recorder.ClientInfo = clientInfo
	return nil
}

func (c *operationRequestController) GetClientInfo() ClientInfo {
	return c.recorder.ClientInfo
}

// OperationResponseParams is passed to OperationResponseHook
type OperationResponseParams struct {
	OperationContextParams

	Logger *zap.Logger
}

// OperationPreParseParams is passed to OperationPreParseHook
type OperationPreParseParams struct {
	OperationContextParams
	// The controller defines the things the hook can do
	// - GetSkipParse: get the existing value of the skip parse flag
	// - SetSkipParse: set the new value of the skip parse flag
	Controller OperationParseController

	Logger *zap.Logger
}

type OperationParseController interface {
	GetSkipParse() bool
	SetSkipParse(skipParse bool) error
}

type operationParseController struct {
	recorder operationParseRecorder
}

type operationParseRecorder struct {
	SkipParse bool
}

func (c *operationParseController) GetSkipParse() bool {
	return c.recorder.SkipParse
}

func (c *operationParseController) SetSkipParse(skipParse bool) error {
	c.recorder.SkipParse = skipParse
	return nil
}

// OperationPostParseParams is passed to OperationPostParseHook
type OperationPostParseParams struct {
	OperationContextParams
	ParseLatency time.Duration

	Logger *zap.Logger
}

// OperationPreNormalizeParams is passed to OperationPreNormalizeHook
type OperationPreNormalizeParams struct {
	OperationContextParams

	Logger *zap.Logger
}

// OperationPostNormalizeParams is passed to OperationPostNormalizeHook
type OperationPostNormalizeParams struct {
	OperationContextParams
	NormalizeCacheHit bool
	NormalizeLatency time.Duration

	Logger *zap.Logger
}

// OperationPreValidateParams is passed to OperationPreValidateHook
type OperationPreValidateParams struct {
	OperationContextParams
	// The controller defines the things the hook can do
	// - GetComplexityLimits: get the default or previously set complexity limits
	// - SetComplexityLimits: set the new complexity limits if needed
	Controller OperationValidateController

	Logger *zap.Logger
}

type OperationValidateController interface {
	GetComplexityLimits() *config.ComplexityLimits
	SetComplexityLimits(complexityLimits *config.ComplexityLimits) error
}

type operationValidateController struct {
	recorder operationValidateRecorder
}

type operationValidateRecorder struct {
	ComplexityLimits *config.ComplexityLimits
}

func (c *operationValidateController) GetComplexityLimits() *config.ComplexityLimits {
	return c.recorder.ComplexityLimits
}

func (c *operationValidateController) SetComplexityLimits(complexityLimits *config.ComplexityLimits) error {
	c.recorder.ComplexityLimits = complexityLimits
	return nil
}

// OperationPostValidateParams is passed to OperationPostValidateHook
type OperationPostValidateParams struct {
	OperationContextParams
	ValidationLatency time.Duration
	ValidationCacheHit bool

	Logger *zap.Logger
}

// OperationPrePlanParams is passed to OperationPrePlanHook
type OperationPrePlanParams struct {
	OperationContextParams

	Logger *zap.Logger
}

// OperationPostPlanParams is passed to OperationPostPlanHook
type OperationPostPlanParams struct {
	OperationContextParams
	PlanCacheHit bool
	PrintedPlan string
	PlanLatency time.Duration

	Logger *zap.Logger
}

/* common entities for the open core module system */

// ExitError is a struct for holding the exit code and error of the router
type ExitError struct {
	Code int
	Err  error
}

func (e *ExitError) Error() string { return e.Err.Error() }

// OperationContextParams is passed to Operation Lifecycle Hooks
type OperationContextParams struct {
	PersistedID   string

	Name string
	OpType string

	Content string

	ClientInfo ClientInfo
}

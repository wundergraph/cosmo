// Package wire defines the JSON ABI shared between the router host and a WASM
// guest module. It is the single source of truth for the messages that cross
// the Extism boundary, so both the host (github.com/wundergraph/cosmo/router)
// and the guest SDK (github.com/wundergraph/cosmo/router-wasm-module/sdk)
// import it.
//
// The package intentionally depends only on encoding/json so it compiles both
// with the standard toolchain (host) and for the wasip1 target (guest).
package wire

import "encoding/json"

// Guest export (function) names. A guest exports the subset of these it wants
// the router to invoke. The host discovers which ones are implemented by
// calling the Capabilities export once at load time.
const (
	// HookCapabilities returns the list of hook names the guest implements.
	HookCapabilities = "capabilities"
	// HookProvision validates configuration and initializes the instance.
	HookProvision = "provision"

	HookOnOriginRequest  = "on_origin_request"
	HookOnOriginResponse = "on_origin_response"
	HookRouterOnRequest  = "router_on_request"

	HookSubscriptionOnStart  = "subscription_on_start"
	HookOnPublishEvents      = "on_publish_events"
	HookOnReceiveEvents      = "on_receive_events"
	HookSubscriptionOnCreate = "subscription_on_create"
)

// Operation type values, mirroring the router's operation types.
const (
	OperationTypeQuery        = "query"
	OperationTypeMutation     = "mutation"
	OperationTypeSubscription = "subscription"
)

// Provider type values for subscription/stream event configurations.
const (
	ProviderTypeNats  = "nats"
	ProviderTypeKafka = "kafka"
	ProviderTypeRedis = "redis"
)

// Header is a JSON-friendly representation of http.Header.
type Header map[string][]string

// Get returns the first value for the given (case-sensitive) key.
func (h Header) Get(key string) string {
	if v := h[key]; len(v) > 0 {
		return v[0]
	}
	return ""
}

// Set replaces any existing values for key with a single value.
func (h Header) Set(key, value string) {
	h[key] = []string{value}
}

// Add appends a value for key.
func (h Header) Add(key, value string) {
	h[key] = append(h[key], value)
}

// Del removes all values for key.
func (h Header) Del(key string) {
	delete(h, key)
}

// HTTPRequest is a serializable snapshot of an *http.Request. Body is
// base64-encoded by encoding/json.
type HTTPRequest struct {
	Method string `json:"method,omitempty"`
	URL    string `json:"url,omitempty"`
	Host   string `json:"host,omitempty"`
	Header Header `json:"header,omitempty"`
	Body   []byte `json:"body,omitempty"`
}

// HTTPResponse is a serializable snapshot / definition of an *http.Response.
type HTTPResponse struct {
	StatusCode int    `json:"statusCode,omitempty"`
	Header     Header `json:"header,omitempty"`
	Body       []byte `json:"body,omitempty"`
}

// Operation is the serializable subset of the GraphQL operation context. It is
// only populated for origin hooks; at router_on_request time the operation has
// not been parsed yet and the fields are empty.
type Operation struct {
	Name string `json:"name,omitempty"`
	Type string `json:"type,omitempty"`
	// Hash is the uint64 operation hash rendered as a decimal string to avoid
	// precision loss in JSON number handling.
	Hash       string          `json:"hash,omitempty"`
	Content    string          `json:"content,omitempty"`
	Sha256Hash string          `json:"sha256Hash,omitempty"`
	Variables  json.RawMessage `json:"variables,omitempty"`
}

// ClientInfo mirrors core.ClientInfo.
type ClientInfo struct {
	Name           string `json:"name,omitempty"`
	Version        string `json:"version,omitempty"`
	WGRequestToken string `json:"wgRequestToken,omitempty"`
}

// Subgraph mirrors the serializable fields of core.Subgraph.
type Subgraph struct {
	ID   string `json:"id,omitempty"`
	Name string `json:"name,omitempty"`
	URL  string `json:"url,omitempty"`
}

// ContextSnapshot is the serializable view of the router RequestContext handed
// to the guest for a single hook invocation. It is never cached across hooks.
type ContextSnapshot struct {
	Operation      *Operation  `json:"operation,omitempty"`
	ClientInfo     *ClientInfo `json:"clientInfo,omitempty"`
	ActiveSubgraph *Subgraph   `json:"activeSubgraph,omitempty"`
	// Error is the value of RequestContext.Error() (or the origin send error).
	Error string `json:"error,omitempty"`
	// Values is the JSON-encodable subset of the RequestContext key/value store.
	Values map[string]json.RawMessage `json:"values,omitempty"`
}

// RequestMutation describes changes the guest wants applied to an
// *http.Request. A nil field means "no change".
type RequestMutation struct {
	// Header, when non-nil, fully replaces the request header set. It is
	// serialized without omitempty so that an empty (but non-nil) map is
	// transmitted as {} and interpreted by the host as "clear all headers",
	// distinct from a nil map ("no change").
	Header Header `json:"header"`
	// Body, when non-nil, replaces the request body. Use an empty (non-nil)
	// slice to clear the body.
	Body *[]byte `json:"body,omitempty"`
}

// EventConfig is the serializable view of a subscription/publish event
// configuration. Raw carries the full provider-specific config as JSON so a
// guest can inspect or (for subscription_on_create) mutate provider fields.
type EventConfig struct {
	ProviderID    string          `json:"providerId,omitempty"`
	ProviderType  string          `json:"providerType,omitempty"`
	RootFieldName string          `json:"rootFieldName,omitempty"`
	Raw           json.RawMessage `json:"raw,omitempty"`
}

// --- Hook input/output messages ---

// ProvisionInput carries the arbitrary module config (the `config:` block of
// the wasm_modules entry) as raw JSON.
type ProvisionInput struct {
	Config json.RawMessage `json:"config,omitempty"`
}

// ProvisionOutput reports a provisioning error, if any. A non-empty Error
// aborts router startup, matching custom-module Provision semantics.
type ProvisionOutput struct {
	Error string `json:"error,omitempty"`
}

// CapabilitiesOutput lists the hooks the guest implements.
type CapabilitiesOutput struct {
	Hooks []string `json:"hooks,omitempty"`
}

type OnOriginRequestInput struct {
	Request HTTPRequest     `json:"request"`
	Context ContextSnapshot `json:"context"`
}

type OnOriginRequestOutput struct {
	Request     *RequestMutation           `json:"request,omitempty"`
	Response    *HTTPResponse              `json:"response,omitempty"`
	ContextSets map[string]json.RawMessage `json:"contextSets,omitempty"`
	Error       string                     `json:"error,omitempty"`
}

type OnOriginResponseInput struct {
	// Response is nil when the origin round trip failed; see SendError.
	Response  *HTTPResponse   `json:"response,omitempty"`
	SendError string          `json:"sendError,omitempty"`
	Context   ContextSnapshot `json:"context"`
}

type OnOriginResponseOutput struct {
	Response    *HTTPResponse              `json:"response,omitempty"`
	ContextSets map[string]json.RawMessage `json:"contextSets,omitempty"`
	Error       string                     `json:"error,omitempty"`
}

type RouterOnRequestInput struct {
	Request HTTPRequest     `json:"request"`
	Context ContextSnapshot `json:"context"`
}

type RouterOnRequestOutput struct {
	Request     *RequestMutation           `json:"request,omitempty"`
	Response    *HTTPResponse              `json:"response,omitempty"`
	ContextSets map[string]json.RawMessage `json:"contextSets,omitempty"`
	Error       string                     `json:"error,omitempty"`
}

type SubscriptionOnStartInput struct {
	Context     ContextSnapshot `json:"context"`
	EventConfig *EventConfig    `json:"eventConfig,omitempty"`
}

type SubscriptionOnStartOutput struct {
	// EmitEvents are JSON payloads to push into the client's stream.
	EmitEvents [][]byte `json:"emitEvents,omitempty"`
	Error      string   `json:"error,omitempty"`
}

// OnEventsInput is shared by on_publish_events and on_receive_events.
type OnEventsInput struct {
	Context     ContextSnapshot `json:"context"`
	EventConfig *EventConfig    `json:"eventConfig,omitempty"`
	// Events are the JSON payloads of the batch (StreamEvent.GetData()).
	Events [][]byte `json:"events,omitempty"`
}

// OnEventsOutput is shared by on_publish_events and on_receive_events. Events
// is the (possibly rewritten/filtered) batch to forward.
type OnEventsOutput struct {
	Events [][]byte `json:"events"`
	Error  string   `json:"error,omitempty"`
}

type SubscriptionOnCreateInput struct {
	Context     ContextSnapshot `json:"context"`
	EventConfig EventConfig     `json:"eventConfig"`
}

type SubscriptionOnCreateOutput struct {
	// EventConfig, when non-nil and carrying Raw, replaces the concrete config
	// (the host unmarshals Raw back into the provider config struct).
	EventConfig *EventConfig `json:"eventConfig,omitempty"`
	Error       string       `json:"error,omitempty"`
}

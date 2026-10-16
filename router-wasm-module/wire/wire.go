// Package wire defines the ABI shared between the router host and a WASM guest
// module. It is the single source of truth for the guest exports, the host
// functions the router provides, and the JSON messages that cross the Extism
// boundary, so both the host (github.com/wundergraph/cosmo/router) and the
// guest SDK (github.com/wundergraph/cosmo/router-wasm-module/sdk) import it.
//
// HTTP data (headers, bodies, status) and the request context are not copied
// into the guest. The guest reads and mutates the live router objects through
// host functions, only touching what it needs. JSON messages are only used for
// event batches, configuration and guest-built short-circuit responses.
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

// HostNamespace is the Wasm import module the router's host functions are
// exported under (the Extism default for user host functions).
const HostNamespace = "extism:host/user"

// Host function names. Strings and byte slices are passed as Extism memory
// offsets (i64). A returned offset of 0 means "empty" / "not present".
// Calling a host function that is not valid for the current hook (for example
// writing the request body in on_origin_response) traps the guest; the router
// logs the error and falls back to its default behavior for that request.
const (
	// HostRequestInfo () -> offset of a JSON RequestInfo.
	HostRequestInfo = "cosmo_request_info"
	// HostHeaderNames (kind i32) -> offset of a JSON []string.
	HostHeaderNames = "cosmo_header_names"
	// HostHeaderValues (kind i32, name offset) -> offset of a JSON []string.
	HostHeaderValues = "cosmo_header_values"
	// HostHeaderSet (kind i32, name offset, value offset).
	HostHeaderSet = "cosmo_header_set"
	// HostHeaderAdd (kind i32, name offset, value offset).
	HostHeaderAdd = "cosmo_header_add"
	// HostHeaderDel (kind i32, name offset).
	HostHeaderDel = "cosmo_header_del"
	// HostBodyRead (kind i32) -> offset of the raw body bytes.
	HostBodyRead = "cosmo_body_read"
	// HostBodyWrite (kind i32, body offset). Offset 0 clears the body.
	HostBodyWrite = "cosmo_body_write"
	// HostStatusGet () -> i32 response status code.
	HostStatusGet = "cosmo_status_get"
	// HostStatusSet (status i32).
	HostStatusSet = "cosmo_status_set"
	// HostContextInfo () -> offset of a JSON ContextInfo.
	HostContextInfo = "cosmo_context_info"
	// HostContextGet (key offset) -> offset of the JSON-encoded value, or 0
	// when the key is not set.
	HostContextGet = "cosmo_context_get"
	// HostContextSet (key offset, JSON value offset).
	HostContextSet = "cosmo_context_set"
)

// Message kinds selecting which HTTP message a header/body host function acts
// on.
const (
	KindRequest  int32 = 0
	KindResponse int32 = 1
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

// Header is a JSON-friendly representation of http.Header, used for
// guest-built responses.
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

// HTTPResponse is a guest-built response used to short-circuit a request or
// replace an origin response. Body is base64-encoded by encoding/json.
type HTTPResponse struct {
	StatusCode int    `json:"statusCode,omitempty"`
	Header     Header `json:"header,omitempty"`
	Body       []byte `json:"body,omitempty"`
}

// RequestInfo is the read-only request line returned by HostRequestInfo.
type RequestInfo struct {
	Method string `json:"method,omitempty"`
	URL    string `json:"url,omitempty"`
	Host   string `json:"host,omitempty"`
}

// Operation is the serializable subset of the GraphQL operation context. It is
// empty for router_on_request, which runs before the operation is parsed.
type Operation struct {
	Name string `json:"name,omitempty"`
	Type string `json:"type,omitempty"`
	// Hash is the uint64 operation hash rendered as a decimal string to avoid
	// precision loss in JSON number handling.
	Hash       string `json:"hash,omitempty"`
	Content    string `json:"content,omitempty"`
	Sha256Hash string `json:"sha256Hash,omitempty"`
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

// ContextInfo is the read-only part of the router RequestContext returned by
// HostContextInfo. The key/value store is accessed separately through
// HostContextGet / HostContextSet.
type ContextInfo struct {
	Operation      *Operation  `json:"operation,omitempty"`
	ClientInfo     *ClientInfo `json:"clientInfo,omitempty"`
	ActiveSubgraph *Subgraph   `json:"activeSubgraph,omitempty"`
	// Error is the request error, or for on_origin_response the error that
	// made the origin round trip fail.
	Error string `json:"error,omitempty"`
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

// OnOriginResponseInput tells the guest whether an origin response exists.
// When HasResponse is false the round trip failed and ContextInfo.Error holds
// the reason.
type OnOriginResponseInput struct {
	HasResponse bool `json:"hasResponse,omitempty"`
}

// HTTPHookOutput is returned by on_origin_request, on_origin_response and
// router_on_request. Mutations are applied to the live objects through host
// functions during the call; Response is only set to short-circuit the request
// (or, for on_origin_response, to replace the response).
type HTTPHookOutput struct {
	Response *HTTPResponse `json:"response,omitempty"`
}

type SubscriptionOnStartInput struct {
	EventConfig *EventConfig `json:"eventConfig,omitempty"`
}

type SubscriptionOnStartOutput struct {
	// EmitEvents are JSON payloads to push into the client's stream.
	EmitEvents [][]byte `json:"emitEvents,omitempty"`
	Error      string   `json:"error,omitempty"`
}

// OnEventsInput is shared by on_publish_events and on_receive_events.
type OnEventsInput struct {
	EventConfig *EventConfig `json:"eventConfig,omitempty"`
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
	EventConfig EventConfig `json:"eventConfig"`
}

type SubscriptionOnCreateOutput struct {
	// EventConfig, when non-nil and carrying Raw, replaces the concrete config
	// (the host unmarshals Raw back into the provider config struct).
	EventConfig *EventConfig `json:"eventConfig,omitempty"`
	Error       string       `json:"error,omitempty"`
}

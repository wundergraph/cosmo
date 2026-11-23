package routerconfig

import "slices"

// ExecutionConfig is a read-only snapshot of one graph's execution config.
// Requests served by the same graph share this pointer. A rebuilt graph has
// a distinct pointer, even when its schema and config version are unchanged.
// Modules may retain it as a cache key and read it concurrently. Callers must
// not overwrite the shared snapshot. All accessors accept a nil receiver.
type ExecutionConfig struct {
	schema       string
	clientSchema string
	subgraphs    []Subgraph
}

// Schema returns the exact composed router SDL from the execution config,
// including directives propagated by composition and inaccessible elements.
// It excludes introspection definitions added at runtime.
func (c *ExecutionConfig) Schema() string {
	if c == nil {
		return ""
	}
	return c.schema
}

// ClientSchema returns the SDL used for validation, normalization, and
// introspection, before runtime introspection definitions are added. A separate
// client schema excludes inaccessible elements and may omit composed type-system directives.
// When the config omits the client schema or supplies an empty string, it
// returns Schema(), matching the router's fallback.
func (c *ExecutionConfig) ClientSchema() string {
	if c == nil {
		return ""
	}
	return c.clientSchema
}

// Subgraphs returns this graph's subgraphs in configuration order.
// Each call returns a detached slice that the caller may retain or modify.
func (c *ExecutionConfig) Subgraphs() []Subgraph {
	if c == nil {
		return nil
	}
	return slices.Clone(c.subgraphs)
}

// Subgraph identifies a subgraph and its effective routing URL.
type Subgraph struct {
	// ID identifies the subgraph in the execution config.
	ID string
	// Name is the subgraph name supplied by composition.
	Name string
	// RoutingURL includes local routing overrides. It may be empty for a virtual subgraph.
	RoutingURL string
}

// NewExecutionConfig creates a snapshot for one graph using its composed SDL
// and its resolved subgraphs in configuration order.
func NewExecutionConfig(schema, clientSchema string, resolvedSubgraphs []Subgraph) *ExecutionConfig {
	if clientSchema == "" {
		clientSchema = schema
	}
	return &ExecutionConfig{
		schema:       schema,
		clientSchema: clientSchema,
		subgraphs:    slices.Clone(resolvedSubgraphs),
	}
}

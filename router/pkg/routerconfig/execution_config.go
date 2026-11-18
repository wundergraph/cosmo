package routerconfig

import "slices"

// ExecutionConfig is a read-only snapshot of one graph's execution config.
// Modules may retain it after a callback returns and read it concurrently.
// Subsequent config changes do not modify an existing snapshot.
type ExecutionConfig struct {
	version      string
	schema       string
	clientSchema string
	subgraphs    []Subgraph
}

// Version returns the version supplied by the execution config. It can be empty
// or shared by different configs. Local wgc router compose uses a constant version.
func (c ExecutionConfig) Version() string { return c.version }

// Schema returns the exact composed router SDL from the execution config,
// including directives propagated by composition and inaccessible elements.
// It excludes introspection definitions added at runtime.
func (c ExecutionConfig) Schema() string { return c.schema }

// ClientSchema returns the SDL used for validation, normalization, and
// introspection, before runtime introspection definitions are added. A separate
// client schema excludes inaccessible elements and may omit composed type-system directives.
// When the config omits the client schema or supplies an empty string, it
// returns Schema(), matching the router's fallback.
func (c ExecutionConfig) ClientSchema() string { return c.clientSchema }

// Subgraphs returns this graph's subgraphs in configuration order.
// Each call returns a detached slice that the caller may retain or modify.
func (c ExecutionConfig) Subgraphs() []Subgraph { return slices.Clone(c.subgraphs) }

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
func NewExecutionConfig(version, schema, clientSchema string, resolvedSubgraphs []Subgraph) ExecutionConfig {
	if clientSchema == "" {
		clientSchema = schema
	}
	return ExecutionConfig{
		version:      version,
		schema:       schema,
		clientSchema: clientSchema,
		subgraphs:    slices.Clone(resolvedSubgraphs),
	}
}

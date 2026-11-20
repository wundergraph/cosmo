// Package context This package contains context keys used throughout the router
// This is a separate package that does not import any other packages
// It is separate so that different packages can infer the context from here
// instead of being moved into core
package context

type CurrentSubgraphContextKey struct{}

type ContextKey int

const (
	RequestContextKey ContextKey = iota
	SubgraphResolverContextKey
	EngineLoaderHooksContextKey
	FetchTimingKey
)

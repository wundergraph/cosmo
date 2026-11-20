package metadata

import (
	"go.opentelemetry.io/collector/component"
)

var (
	Type      = component.MustNewType("jwtauthextension")
	ScopeName = "github.com/wundergraph/cosmo/otelcollector/extension/jwtauthextension"
)

const (
	ExtensionStability = component.StabilityLevelAlpha
)

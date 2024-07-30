package telemetry

import (
	"time"

	"go.opentelemetry.io/otel/attribute"
	semconv17 "go.opentelemetry.io/otel/semconv/v1.17.0"
)

const (
	DefaultBatchTimeout  = 10 * time.Second
	DefaultExportTimeout = 30 * time.Second
)

// SensitiveAttributes that should be redacted by the OTEL http instrumentation package.
// Take attention to the right version of the semconv package.
var SensitiveAttributes = []attribute.Key{
	// Both can contain external IP addresses
	semconv17.HTTPClientIPKey,
	semconv17.NetSockPeerAddrKey,
}

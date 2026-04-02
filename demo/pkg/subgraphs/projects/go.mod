module github.com/wundergraph/cosmo/demo/pkg/subgraphs/projects

go 1.25

require (
	github.com/hashicorp/go-hclog v1.6.3
	github.com/stretchr/testify v1.11.1
	github.com/wundergraph/cosmo/router-plugin v0.0.0-20250808194725-de123ba1c65e
	google.golang.org/grpc v1.79.3
	google.golang.org/protobuf v1.36.10
)

require (
	github.com/cenkalti/backoff/v4 v4.2.1 // indirect
	github.com/davecgh/go-spew v1.1.1 // indirect
	github.com/fatih/color v1.18.0 // indirect
	github.com/go-logr/logr v1.4.3 // indirect
	github.com/go-logr/stdr v1.2.2 // indirect
	github.com/golang/protobuf v1.5.4 // indirect
	github.com/google/uuid v1.6.0 // indirect
	github.com/grpc-ecosystem/grpc-gateway/v2 v2.19.0 // indirect
	github.com/hashicorp/go-plugin v1.6.3 // indirect
	github.com/hashicorp/yamux v0.1.1 // indirect
	github.com/mattn/go-colorable v0.1.13 // indirect
	github.com/mattn/go-isatty v0.0.20 // indirect
	github.com/oklog/run v1.0.0 // indirect
	github.com/pmezard/go-difflib v1.0.0 // indirect
	github.com/rogpeppe/go-internal v1.14.1 // indirect
	github.com/tonglil/opentelemetry-go-datadog-propagator v0.1.3 // indirect
	go.opentelemetry.io/contrib/propagators/b3 v1.23.0 // indirect
	go.opentelemetry.io/contrib/propagators/jaeger v1.23.0 // indirect
	go.opentelemetry.io/otel v1.40.0 // indirect
	go.opentelemetry.io/otel/exporters/otlp/otlptrace v1.23.1 // indirect
	go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracegrpc v1.23.1 // indirect
	go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp v1.23.1 // indirect
	go.opentelemetry.io/otel/metric v1.40.0 // indirect
	go.opentelemetry.io/otel/sdk v1.40.0 // indirect
	go.opentelemetry.io/otel/trace v1.40.0 // indirect
	go.opentelemetry.io/proto/otlp v1.1.0 // indirect
	golang.org/x/net v0.48.0 // indirect
	golang.org/x/sys v0.40.0 // indirect
	golang.org/x/text v0.32.0 // indirect
	google.golang.org/genproto/googleapis/api v0.0.0-20251202230838-ff82c1b0f217 // indirect
	google.golang.org/genproto/googleapis/rpc v0.0.0-20251202230838-ff82c1b0f217 // indirect
	gopkg.in/yaml.v3 v3.0.1 // indirect
)

// Do not upgrade, it renames attributes we rely on
replace (
	go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp => go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp v0.46.1
	go.opentelemetry.io/contrib/propagators/b3 => go.opentelemetry.io/contrib/propagators/b3 v1.23.0
	go.opentelemetry.io/contrib/propagators/jaeger => go.opentelemetry.io/contrib/propagators/jaeger v1.23.0
	go.opentelemetry.io/otel => go.opentelemetry.io/otel v1.28.0
	go.opentelemetry.io/otel/exporters/otlp/otlpmetric/otlpmetricgrpc => go.opentelemetry.io/otel/exporters/otlp/otlpmetric/otlpmetricgrpc v0.44.0
	go.opentelemetry.io/otel/exporters/otlp/otlpmetric/otlpmetrichttp => go.opentelemetry.io/otel/exporters/otlp/otlpmetric/otlpmetrichttp v0.44.0
	go.opentelemetry.io/otel/exporters/otlp/otlptrace => go.opentelemetry.io/otel/exporters/otlp/otlptrace v1.23.1
	go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracegrpc => go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracegrpc v1.23.1
	go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp => go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp v1.23.1
	go.opentelemetry.io/otel/exporters/prometheus => go.opentelemetry.io/otel/exporters/prometheus v0.50.0
	go.opentelemetry.io/otel/metric => go.opentelemetry.io/otel/metric v1.28.0
	go.opentelemetry.io/otel/sdk => go.opentelemetry.io/otel/sdk v1.28.0
	go.opentelemetry.io/otel/sdk/metric => go.opentelemetry.io/otel/sdk/metric v1.28.0
	go.opentelemetry.io/otel/trace => go.opentelemetry.io/otel/trace v1.28.0
	go.opentelemetry.io/proto/otlp => go.opentelemetry.io/proto/otlp v1.1.0
)

replace github.com/wundergraph/cosmo/router-plugin => ../../../../router-plugin

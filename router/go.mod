module github.com/wundergraph/cosmo/router

go 1.21

require (
	connectrpc.com/connect v1.11.1
	github.com/MicahParks/keyfunc/v2 v2.1.0
	github.com/alitto/pond v1.8.3
	github.com/buger/jsonparser v1.1.1
	github.com/cespare/xxhash/v2 v2.2.0
	github.com/cloudflare/backoff v0.0.0-20161212185259-647f3cdfc87a
	github.com/dgraph-io/ristretto v0.1.1
	github.com/dustin/go-humanize v1.0.1
	github.com/go-chi/chi v1.5.4
	github.com/go-playground/validator/v10 v10.15.5
	github.com/gobwas/ws v1.3.1
	github.com/goccy/go-yaml v1.11.0
	github.com/golang-jwt/jwt/v5 v5.0.0
	github.com/gorilla/websocket v1.5.1
	github.com/hashicorp/go-multierror v1.1.1
	github.com/hashicorp/go-retryablehttp v0.7.5
	github.com/jensneuse/abstractlogger v0.0.4
	github.com/joho/godotenv v1.5.1
	github.com/kelseyhightower/envconfig v1.4.0
	github.com/mattbaird/jsonpatch v0.0.0-20230413205102-771768614e91
	github.com/mitchellh/mapstructure v1.5.0
	github.com/nats-io/nats.go v1.31.0
	github.com/pkg/errors v0.9.1
	github.com/prometheus/client_golang v1.17.0
	github.com/stretchr/testify v1.8.4
	github.com/tidwall/gjson v1.14.4
	github.com/tidwall/sjson v1.2.5
	github.com/wundergraph/graphql-go-tools/v2 v2.0.0-rc.4.0.20240201111002-30ce207df180
	go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp v0.46.1
	go.opentelemetry.io/contrib/propagators/b3 v1.21.1
	go.opentelemetry.io/contrib/propagators/jaeger v1.21.1
	go.opentelemetry.io/otel v1.21.0
	go.opentelemetry.io/otel/exporters/otlp/otlpmetric/otlpmetricgrpc v0.44.0
	go.opentelemetry.io/otel/exporters/otlp/otlpmetric/otlpmetrichttp v0.44.0
	go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracegrpc v1.21.0
	go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp v1.21.0
	go.opentelemetry.io/otel/exporters/prometheus v0.44.0
	go.opentelemetry.io/otel/metric v1.21.0
	go.opentelemetry.io/otel/sdk v1.21.0
	go.opentelemetry.io/otel/sdk/metric v1.21.0
	go.opentelemetry.io/otel/trace v1.21.0
	go.uber.org/atomic v1.11.0
	go.uber.org/automaxprocs v1.5.3
	go.uber.org/zap v1.26.0
	go.withmatt.com/connect-brotli v0.4.0
	golang.org/x/sync v0.4.0
	golang.org/x/sys v0.15.0
	google.golang.org/grpc v1.59.0
	google.golang.org/protobuf v1.31.0
)

require (
	github.com/99designs/gqlgen v0.17.39 // indirect
	github.com/andybalholm/brotli v1.0.6 // indirect
	github.com/beorn7/perks v1.0.1 // indirect
	github.com/bytedance/sonic v1.10.0-rc // indirect
	github.com/cenkalti/backoff/v4 v4.2.1 // indirect
	github.com/chenzhuoyu/base64x v0.0.0-20230717121745-296ad89f973d // indirect
	github.com/davecgh/go-spew v1.1.1 // indirect
	github.com/evanphx/json-patch v0.5.2 // indirect
	github.com/fatih/color v1.15.0 // indirect
	github.com/felixge/httpsnoop v1.0.4 // indirect
	github.com/gabriel-vasile/mimetype v1.4.3 // indirect
	github.com/gin-gonic/gin v1.9.1 // indirect
	github.com/go-logr/logr v1.4.1 // indirect
	github.com/go-logr/stdr v1.2.2 // indirect
	github.com/go-playground/locales v0.14.1 // indirect
	github.com/go-playground/universal-translator v0.18.1 // indirect
	github.com/gobwas/httphead v0.1.0 // indirect
	github.com/gobwas/pool v0.2.1 // indirect
	github.com/golang/glog v1.1.2 // indirect
	github.com/golang/protobuf v1.5.3 // indirect
	github.com/google/uuid v1.4.0 // indirect
	github.com/grpc-ecosystem/grpc-gateway/v2 v2.16.0 // indirect
	github.com/hashicorp/errwrap v1.1.0 // indirect
	github.com/hashicorp/go-cleanhttp v0.5.2 // indirect
	github.com/hashicorp/golang-lru v0.5.4 // indirect
	github.com/hashicorp/golang-lru/v2 v2.0.7 // indirect
	github.com/jensneuse/byte-template v0.0.0-20200214152254-4f3cf06e5c68 // indirect
	github.com/klauspost/compress v1.17.4 // indirect
	github.com/klauspost/cpuid/v2 v2.2.5 // indirect
	github.com/leodido/go-urn v1.2.4 // indirect
	github.com/mattn/go-colorable v0.1.13 // indirect
	github.com/mattn/go-isatty v0.0.19 // indirect
	github.com/matttproud/golang_protobuf_extensions v1.0.4 // indirect
	github.com/nats-io/nkeys v0.4.6 // indirect
	github.com/nats-io/nuid v1.0.1 // indirect
	github.com/pelletier/go-toml/v2 v2.0.9 // indirect
	github.com/pmezard/go-difflib v1.0.0 // indirect
	github.com/prometheus/client_model v0.5.0 // indirect
	github.com/prometheus/common v0.44.0 // indirect
	github.com/prometheus/procfs v0.11.1 // indirect
	github.com/r3labs/sse/v2 v2.8.1 // indirect
	github.com/santhosh-tekuri/jsonschema/v5 v5.3.0 // indirect
	github.com/sirupsen/logrus v1.9.0 // indirect
	github.com/tidwall/match v1.1.1 // indirect
	github.com/tidwall/pretty v1.2.1 // indirect
	github.com/vektah/gqlparser/v2 v2.5.10 // indirect
	go.opentelemetry.io/otel/exporters/otlp/otlptrace v1.21.0 // indirect
	go.opentelemetry.io/proto/otlp v1.0.0 // indirect
	go.uber.org/multierr v1.11.0 // indirect
	golang.org/x/arch v0.4.0 // indirect
	golang.org/x/crypto v0.16.0 // indirect
	golang.org/x/net v0.17.0 // indirect
	golang.org/x/text v0.14.0 // indirect
	golang.org/x/xerrors v0.0.0-20220907171357-04be3eba64a2 // indirect
	google.golang.org/genproto/googleapis/api v0.0.0-20230822172742-b8732ec3820d // indirect
	google.golang.org/genproto/googleapis/rpc v0.0.0-20230822172742-b8732ec3820d // indirect
	gopkg.in/cenkalti/backoff.v1 v1.1.0 // indirect
	gopkg.in/yaml.v3 v3.0.1 // indirect
	nhooyr.io/websocket v1.8.7 // indirect
)

//replace github.com/wundergraph/graphql-go-tools/v2 => ../../graphql-go-tools/v2

// Remove once new SDK 1.22 is released
replace (
	go.opentelemetry.io/otel v1.21.0 => github.com/open-telemetry/opentelemetry-go v1.21.1-0.20231225192138-1cfd83a1eeaa
	go.opentelemetry.io/otel/metric v1.21.0 => github.com/open-telemetry/opentelemetry-go/metric v1.21.1-0.20231225192138-1cfd83a1eeaa
	go.opentelemetry.io/otel/sdk v1.21.0 => github.com/open-telemetry/opentelemetry-go/sdk v1.21.1-0.20231225192138-1cfd83a1eeaa
	go.opentelemetry.io/otel/sdk/metric v1.21.0 => github.com/open-telemetry/opentelemetry-go/sdk/metric v1.21.1-0.20231225192138-1cfd83a1eeaa
	go.opentelemetry.io/otel/trace v1.21.0 => github.com/open-telemetry/opentelemetry-go/trace v1.21.1-0.20231225192138-1cfd83a1eeaa
)

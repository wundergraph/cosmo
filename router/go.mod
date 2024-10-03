module github.com/wundergraph/cosmo/router

go 1.21.5

toolchain go1.22.0

require (
	connectrpc.com/connect v1.16.2
	github.com/MicahParks/keyfunc/v2 v2.1.0
	github.com/andybalholm/brotli v1.1.0 // indirect
	github.com/buger/jsonparser v1.1.1
	github.com/cespare/xxhash/v2 v2.3.0
	github.com/cloudflare/backoff v0.0.0-20161212185259-647f3cdfc87a
	// References to main that includes the fix for the race with ristretto.Close()
	// Link: https://github.com/dgraph-io/ristretto/pull/384
	github.com/dgraph-io/ristretto v0.1.2-0.20240723054643-f5997484152c
	github.com/dustin/go-humanize v1.0.1
	github.com/go-chi/chi/v5 v5.0.11
	github.com/go-redis/redis_rate/v10 v10.0.1
	github.com/gobwas/ws v1.3.1
	github.com/goccy/go-json v0.10.3
	github.com/goccy/go-yaml v1.12.0
	github.com/golang-jwt/jwt/v5 v5.2.0
	github.com/gorilla/websocket v1.5.1
	github.com/hashicorp/go-multierror v1.1.1
	github.com/hashicorp/go-retryablehttp v0.7.7
	github.com/jensneuse/abstractlogger v0.0.4
	github.com/joho/godotenv v1.5.1
	github.com/mitchellh/mapstructure v1.5.0
	github.com/nats-io/nats.go v1.35.0
	github.com/nats-io/nuid v1.0.1
	github.com/pkg/errors v0.9.1
	github.com/prometheus/client_golang v1.19.1
	github.com/redis/go-redis/v9 v9.4.0
	github.com/sebdah/goldie/v2 v2.5.3
	github.com/shirou/gopsutil/v3 v3.24.3
	github.com/stretchr/testify v1.9.0
	github.com/tidwall/gjson v1.18.0
	github.com/tidwall/sjson v1.2.5
	github.com/twmb/franz-go v1.16.1
	github.com/wundergraph/graphql-go-tools/v2 v2.0.0-rc.95
	// Do not upgrade, it renames attributes we rely on
	go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp v0.46.1
	go.opentelemetry.io/contrib/propagators/b3 v1.23.0
	go.opentelemetry.io/contrib/propagators/jaeger v1.23.0
	go.opentelemetry.io/otel v1.28.0
	go.opentelemetry.io/otel/exporters/otlp/otlpmetric/otlpmetricgrpc v0.44.0
	go.opentelemetry.io/otel/exporters/otlp/otlpmetric/otlpmetrichttp v0.44.0
	go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracegrpc v1.23.1
	go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp v1.23.1
	go.opentelemetry.io/otel/exporters/prometheus v0.50.0
	go.opentelemetry.io/otel/metric v1.28.0
	go.opentelemetry.io/otel/sdk v1.28.0
	go.opentelemetry.io/otel/sdk/metric v1.28.0
	go.opentelemetry.io/otel/trace v1.28.0
	go.uber.org/atomic v1.11.0
	go.uber.org/automaxprocs v1.5.3
	go.uber.org/zap v1.27.0
	go.withmatt.com/connect-brotli v0.4.0
	golang.org/x/sync v0.8.0
	golang.org/x/sys v0.25.0
	google.golang.org/grpc v1.61.0
	google.golang.org/protobuf v1.34.2
)

require (
	github.com/KimMachineGun/automemlimit v0.6.1
	github.com/bep/debounce v1.2.1
	github.com/caarlos0/env/v11 v11.1.0
	github.com/fsnotify/fsnotify v1.7.0
	github.com/klauspost/compress v1.17.9
	github.com/minio/minio-go/v7 v7.0.74
	github.com/pquerna/cachecontrol v0.2.0
	github.com/santhosh-tekuri/jsonschema/v6 v6.0.1
	github.com/tonglil/opentelemetry-go-datadog-propagator v0.1.3
	github.com/wundergraph/astjson v0.0.0-20240910140849-bb15f94bd362
	golang.org/x/exp v0.0.0-20240613232115-7f521ea00fb8
	golang.org/x/text v0.16.0
)

require (
	github.com/99designs/gqlgen v0.17.49 // indirect
	github.com/beorn7/perks v1.0.1 // indirect
	github.com/cenkalti/backoff/v4 v4.2.1 // indirect
	github.com/cilium/ebpf v0.9.1 // indirect
	github.com/containerd/cgroups/v3 v3.0.2 // indirect
	github.com/coreos/go-systemd/v22 v22.5.0 // indirect
	github.com/davecgh/go-spew v1.1.1 // indirect
	github.com/dgryski/go-rendezvous v0.0.0-20200823014737-9f7001d12a5f // indirect
	github.com/docker/go-units v0.5.0 // indirect
	github.com/fatih/color v1.16.0 // indirect
	github.com/felixge/httpsnoop v1.0.4 // indirect
	github.com/go-ini/ini v1.67.0 // indirect
	github.com/go-logr/logr v1.4.2 // indirect
	github.com/go-logr/stdr v1.2.2 // indirect
	github.com/go-ole/go-ole v1.2.6 // indirect
	github.com/go-playground/validator/v10 v10.20.0 // indirect
	github.com/gobwas/httphead v0.1.0 // indirect
	github.com/gobwas/pool v0.2.1 // indirect
	github.com/godbus/dbus/v5 v5.1.0 // indirect
	github.com/golang/protobuf v1.5.3 // indirect
	github.com/google/uuid v1.6.0 // indirect
	github.com/grpc-ecosystem/grpc-gateway/v2 v2.19.0 // indirect
	github.com/hashicorp/errwrap v1.1.0 // indirect
	github.com/hashicorp/go-cleanhttp v0.5.2 // indirect
	github.com/jensneuse/byte-template v0.0.0-20231025215717-69252eb3ed56 // indirect
	github.com/kingledion/go-tools v0.6.0 // indirect
	github.com/klauspost/cpuid/v2 v2.2.8 // indirect
	github.com/lufia/plan9stats v0.0.0-20211012122336-39d0f177ccd0 // indirect
	github.com/mattn/go-colorable v0.1.13 // indirect
	github.com/mattn/go-isatty v0.0.20 // indirect
	github.com/minio/md5-simd v1.1.2 // indirect
	github.com/munnerz/goautoneg v0.0.0-20191010083416-a7dc8b61c822 // indirect
	github.com/nats-io/nkeys v0.4.7 // indirect
	github.com/opencontainers/runtime-spec v1.1.0 // indirect
	github.com/pbnjay/memory v0.0.0-20210728143218-7b4eea64cf58 // indirect
	github.com/phf/go-queue v0.0.0-20170504031614-9abe38d0371d // indirect
	github.com/pierrec/lz4/v4 v4.1.21 // indirect
	github.com/pmezard/go-difflib v1.0.0 // indirect
	github.com/power-devops/perfstat v0.0.0-20210106213030-5aafc221ea8c // indirect
	github.com/prometheus/client_model v0.6.1 // indirect
	github.com/prometheus/common v0.55.0 // indirect
	github.com/prometheus/procfs v0.15.1 // indirect
	github.com/r3labs/sse/v2 v2.8.1 // indirect
	github.com/rs/xid v1.5.0 // indirect
	github.com/sergi/go-diff v1.3.1 // indirect
	github.com/shoenig/go-m1cpu v0.1.6 // indirect
	github.com/sirupsen/logrus v1.9.3 // indirect
	github.com/tidwall/match v1.1.1 // indirect
	github.com/tidwall/pretty v1.2.1 // indirect
	github.com/tklauser/go-sysconf v0.3.12 // indirect
	github.com/tklauser/numcpus v0.6.1 // indirect
	github.com/twmb/franz-go/pkg/kmsg v1.7.0 // indirect
	github.com/vektah/gqlparser/v2 v2.5.16 // indirect
	github.com/yusufpapurcu/wmi v1.2.4 // indirect
	go.opentelemetry.io/otel/exporters/otlp/otlptrace v1.23.1 // indirect
	go.opentelemetry.io/proto/otlp v1.1.0 // indirect
	go.uber.org/multierr v1.11.0 // indirect
	golang.org/x/crypto v0.24.0 // indirect
	golang.org/x/net v0.26.0 // indirect
	golang.org/x/xerrors v0.0.0-20220907171357-04be3eba64a2 // indirect
	google.golang.org/genproto/googleapis/api v0.0.0-20240102182953-50ed04b92917 // indirect
	google.golang.org/genproto/googleapis/rpc v0.0.0-20240102182953-50ed04b92917 // indirect
	gopkg.in/cenkalti/backoff.v1 v1.1.0 // indirect
	gopkg.in/yaml.v3 v3.0.1 // indirect
	nhooyr.io/websocket v1.8.11 // indirect
)

//replace github.com/wundergraph/graphql-go-tools/v2 => ../../graphql-go-tools/v2

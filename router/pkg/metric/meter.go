package metric

import (
	"context"
	"fmt"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/collectors"
	"github.com/wundergraph/cosmo/router/pkg/otel/otelconfig"
	"go.opentelemetry.io/otel/attribute"
	otelprom "go.opentelemetry.io/otel/exporters/prometheus"
	"net/url"
	"regexp"
	"time"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/exporters/otlp/otlpmetric/otlpmetricgrpc"
	"go.opentelemetry.io/otel/exporters/otlp/otlpmetric/otlpmetrichttp"
	sdkmetric "go.opentelemetry.io/otel/sdk/metric"
	"go.opentelemetry.io/otel/sdk/metric/metricdata"
	"go.opentelemetry.io/otel/sdk/resource"
	semconv "go.opentelemetry.io/otel/semconv/v1.21.0"
	"go.uber.org/zap"
	_ "google.golang.org/grpc/encoding/gzip" // Required for gzip support over grpc
)

var (
	mp *sdkmetric.MeterProvider

	// Please version the used meters if you change the buckets.

	// 0kb-20MB
	bytesBucketBounds = []float64{
		0, 50, 100, 300, 500, 1000, 3000, 5000, 10000, 15000,
		30000, 50000, 70000, 90000, 150000, 300000, 600000,
		800000, 1000000, 5000000, 10000000, 20000000,
	}

	// Please version the used meters if you change the buckets.

	// 0ms-10s
	msBucketsBounds = []float64{
		0, 5, 7, 10, 15, 25, 50, 75, 100, 125, 150, 175, 200, 225,
		250, 275, 300, 350, 400, 450, 500, 600, 700, 800, 900, 1000, 1250,
		1500, 1750, 2000, 2250, 2500, 2750, 3000, 3500, 4000, 5000, 10000,
	}
)

const (
	defaultExportTimeout  = 30 * time.Second
	defaultExportInterval = 15 * time.Second
)

var (
	//
	// Short story about when we choose delta and when we choose cumulative temporality:
	//
	// Delta temporalities are reported as completed intervals. They don't build upon each other.
	// This makes them easier to query and aggregate because we don't have to think about resets.
	// See here for more information: https://opentelemetry.io/docs/specs/otel/metrics/data-model/#resets-and-gaps
	//
	// The downside is that missing data points will result in data loss and can't be averaged from the previous value.
	// Delta temporality is more memory efficient for synchronous instruments because we don't have to store the last value.
	// On the other hand, delta temporality is more expensive for asynchronous instruments because we have to store the last
	// value of every permutation to calculate the delta.
	//
	// We choose delta temporality for synchronous instruments because we can easily sum the values over a time range.
	// We choose cumulative temporality for asynchronous instruments because we can query the last cumulative value without extra work.
	// See https://opentelemetry.io/docs/specs/otel/metrics/supplementary-guidelines/#aggregation-temporality for more information.
	//
	temporalitySelector = func(kind sdkmetric.InstrumentKind) metricdata.Temporality {
		switch kind {
		case sdkmetric.InstrumentKindCounter,
			sdkmetric.InstrumentKindUpDownCounter,
			sdkmetric.InstrumentKindHistogram:
			return metricdata.DeltaTemporality
		case
			sdkmetric.InstrumentKindObservableGauge,
			sdkmetric.InstrumentKindObservableCounter,
			sdkmetric.InstrumentKindObservableUpDownCounter:
			return metricdata.CumulativeTemporality
		}
		panic("unknown instrument kind")
	}
)

func NewPrometheusMeterProvider(ctx context.Context, c *Config, serviceInstanceID string) (*sdkmetric.MeterProvider, *prometheus.Registry, error) {
	registry := prometheus.NewRegistry()
	registry.MustRegister(collectors.NewGoCollector())
	registry.MustRegister(collectors.NewProcessCollector(collectors.ProcessCollectorOpts{}))

	promExporter, err := otelprom.New(
		otelprom.WithoutUnits(),
		otelprom.WithRegisterer(registry),
	)

	if err != nil {
		return nil, nil, err
	}

	opts, err := defaultPrometheusMetricOptions(
		ctx,
		c.Name,
		c.Version,
		serviceInstanceID,
		c.Prometheus.ExcludeMetrics,
		c.Prometheus.ExcludeMetricLabels,
	)
	if err != nil {
		return nil, nil, err
	}
	opts = append(opts, sdkmetric.WithReader(promExporter))

	mp = sdkmetric.NewMeterProvider(opts...)

	return mp, registry, nil
}

func createOTELExporter(log *zap.Logger, exp *OpenTelemetryExporter) (sdkmetric.Exporter, error) {
	u, err := url.Parse(exp.Endpoint)
	if err != nil {
		return nil, fmt.Errorf("invalid OpenTelemetry endpoint %q: %w", exp.Endpoint, err)
	}

	var exporter sdkmetric.Exporter
	switch exp.Exporter {
	case otelconfig.ExporterOLTPHTTP:
		opts := []otlpmetrichttp.Option{
			// Includes host and port
			otlpmetrichttp.WithEndpoint(u.Host),
			otlpmetrichttp.WithCompression(otlpmetrichttp.GzipCompression),
			otlpmetrichttp.WithTemporalitySelector(temporalitySelector),
		}

		if u.Scheme != "https" {
			opts = append(opts, otlpmetrichttp.WithInsecure())
		}

		if len(exp.Headers) > 0 {
			opts = append(opts, otlpmetrichttp.WithHeaders(exp.Headers))
		}
		if len(exp.HTTPPath) > 0 {
			opts = append(opts, otlpmetrichttp.WithURLPath(exp.HTTPPath))
		}

		exporter, err = otlpmetrichttp.New(
			context.Background(),
			opts...,
		)
	case otelconfig.ExporterOLTPGRPC:
		opts := []otlpmetricgrpc.Option{
			// Includes host and port
			otlpmetricgrpc.WithEndpoint(u.Host),
			otlpmetricgrpc.WithCompressor("gzip"),
			otlpmetricgrpc.WithTemporalitySelector(temporalitySelector),
		}

		if u.Scheme != "https" {
			opts = append(opts, otlpmetricgrpc.WithInsecure())
		}

		if len(exp.Headers) > 0 {
			opts = append(opts, otlpmetricgrpc.WithHeaders(exp.Headers))
		}
		if len(exp.HTTPPath) > 0 {
			log.Warn("Otlpmetricgrpc exporter doesn't support arbitrary paths", zap.String("path", exp.HTTPPath))
		}

		exporter, err = otlpmetricgrpc.New(
			context.Background(),
			opts...,
		)
	default:
		return nil, fmt.Errorf("unknown metrics exporter %s", exp.Exporter)
	}
	if err != nil {
		return nil, err
	}
	log.Info("Metrics enabled", zap.String("exporter", string(exp.Exporter)), zap.String("endpoint", exp.Endpoint), zap.String("path", exp.HTTPPath))
	return exporter, nil
}

func NewOtlpMeterProvider(ctx context.Context, log *zap.Logger, c *Config, serviceInstanceID string) (*sdkmetric.MeterProvider, error) {
	opts, err := defaultOtlpMetricOptions(ctx, c.Name, c.Version, serviceInstanceID)
	if err != nil {
		return nil, err
	}

	if c.OpenTelemetry.Enabled {
		for _, exp := range c.OpenTelemetry.Exporters {
			if exp.Disabled {
				continue
			}

			exporter, err := createOTELExporter(log, exp)
			if err != nil {
				log.Error("creating OTEL metrics exporter", zap.Error(err))
				return nil, err
			}

			opts = append(opts, sdkmetric.WithReader(
				sdkmetric.NewPeriodicReader(exporter,
					sdkmetric.WithTimeout(defaultExportTimeout),
					sdkmetric.WithInterval(defaultExportInterval),
				),
			))
		}
	}

	mp = sdkmetric.NewMeterProvider(opts...)
	// Set the global MeterProvider to the SDK metric provider.
	otel.SetMeterProvider(mp)

	return mp, nil
}

func getResource(ctx context.Context, serviceName, serviceVersion string, serviceInstanceID string) (*resource.Resource, error) {
	r, err := resource.New(ctx,
		resource.WithAttributes(semconv.ServiceNameKey.String(serviceName)),
		resource.WithAttributes(semconv.ServiceVersionKey.String(serviceVersion)),
		resource.WithAttributes(semconv.ServiceInstanceID(serviceInstanceID)),
		resource.WithProcessPID(),
		resource.WithHostID(),
		resource.WithOSType(),
		resource.WithTelemetrySDK(),
		resource.WithHost(),
	)
	if err != nil {
		return nil, err
	}

	return r, nil
}

func defaultPrometheusMetricOptions(ctx context.Context, serviceName, serviceVersion string, serviceInstanceID string, excludeMetrics, excludeMetricAttributes []*regexp.Regexp) ([]sdkmetric.Option, error) {
	r, err := getResource(ctx, serviceName, serviceVersion, serviceInstanceID)
	if err != nil {
		return nil, err
	}

	var opts []sdkmetric.Option

	// Exclude attributes from metrics

	attributeFilter := func(value attribute.KeyValue) bool {
		if isKeyInSlice(value.Key, defaultExcludedOtelKeys) {
			return false
		}
		name := sanitizeName(string(value.Key))
		for _, re := range excludeMetricAttributes {
			if re.MatchString(name) {
				return false
			}
		}
		return true
	}

	msBucketHistogram := sdkmetric.AggregationExplicitBucketHistogram{
		Boundaries: msBucketsBounds,
	}
	bytesBucketHistogram := sdkmetric.AggregationExplicitBucketHistogram{
		Boundaries: bytesBucketBounds,
	}

	var view sdkmetric.View = func(i sdkmetric.Instrument) (sdkmetric.Stream, bool) {
		// In a custom View function, we need to explicitly copy the name, description, and unit.
		s := sdkmetric.Stream{Name: i.Name, Description: i.Description, Unit: i.Unit}

		// Filter out metrics that match the excludeMetrics regexes
		for _, re := range excludeMetrics {
			promName := sanitizeName(i.Name)
			if re.MatchString(promName) {
				// Drop the metric
				s.Aggregation = sdkmetric.AggregationDrop{}
				return s, true
			}
		}

		// Filter out attributes that match the excludeMetricAttributes regexes
		s.AttributeFilter = attributeFilter

		// Use different histogram buckets for Prometheus
		if i.Unit == unitBytes && i.Kind == sdkmetric.InstrumentKindHistogram {
			s.Aggregation = bytesBucketHistogram
		} else if i.Unit == unitMilliseconds && i.Kind == sdkmetric.InstrumentKindHistogram {
			s.Aggregation = msBucketHistogram
		}

		return s, true
	}

	opts = append(opts, sdkmetric.WithView(view))

	opts = append(opts, // Record information about this application in a Resource.
		sdkmetric.WithResource(r),
	)

	return opts, nil
}

func defaultOtlpMetricOptions(ctx context.Context, serviceName, serviceVersion string, serviceInstanceID string) ([]sdkmetric.Option, error) {
	r, err := getResource(ctx, serviceName, serviceVersion, serviceInstanceID)
	if err != nil {
		return nil, err
	}

	msBucketHistogram := sdkmetric.AggregationExplicitBucketHistogram{
		Boundaries: msBucketsBounds,
	}
	bytesBucketHistogram := sdkmetric.AggregationExplicitBucketHistogram{
		Boundaries: bytesBucketBounds,
	}

	// Info: There can be only a single view per instrument. A view with less restriction might override a view.

	return []sdkmetric.Option{
		// Record information about this application in a Resource.
		sdkmetric.WithResource(r),
		// Use different histogram buckets for Prometheus and OTLP
		sdkmetric.WithView(sdkmetric.NewView(
			sdkmetric.Instrument{
				Kind: sdkmetric.InstrumentKindHistogram,
				Unit: unitMilliseconds,
			},
			sdkmetric.Stream{
				Aggregation: msBucketHistogram,
			},
		)),
		sdkmetric.WithView(sdkmetric.NewView(
			sdkmetric.Instrument{
				Kind: sdkmetric.InstrumentKindHistogram,
				Unit: unitBytes,
			},
			sdkmetric.Stream{
				Aggregation: bytesBucketHistogram,
			},
		)),
	}, nil
}

func isKeyInSlice(key attribute.Key, keys []attribute.Key) bool {
	for _, k := range keys {
		if k == key {
			return true
		}
	}
	return false
}

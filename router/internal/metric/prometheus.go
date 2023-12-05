package metric

import (
	prom "github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/collectors"
	otelprom "go.opentelemetry.io/otel/exporters/prometheus"
	"regexp"
)

func createPromExporter(excludeMetrics, excludeMetricLabels []*regexp.Regexp) (*otelprom.Exporter, *PromRegistry, error) {
	excludeMetricLabels = append(excludeMetricLabels, defaultExcludedPromMetricLabels...)
	registry, err := NewPromRegistry(prom.NewRegistry(), excludeMetrics, excludeMetricLabels)
	if err != nil {
		return nil, nil, err
	}
	registry.MustRegister(collectors.NewGoCollector())
	registry.MustRegister(collectors.NewProcessCollector(collectors.ProcessCollectorOpts{}))

	prometheusExporter, err := otelprom.New(
		otelprom.WithoutUnits(),
		otelprom.WithRegisterer(registry),
	)
	if err != nil {
		return nil, nil, err
	}
	return prometheusExporter, registry, nil
}

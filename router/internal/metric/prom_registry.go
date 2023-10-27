package metric

import (
	"fmt"
	prom "github.com/prometheus/client_golang/prometheus"
	dto "github.com/prometheus/client_model/go"
	"regexp"
)

type PromRegistry struct {
	promRegistry   *prom.Registry
	excludeMetrics []regexp.Regexp
	excludeLabels  []regexp.Regexp
}

// NewPromRegistry creates a new Prometheus registry with the given exclude metrics and exclude metric labels.
func NewPromRegistry(promRegistry *prom.Registry, excludeMetrics, excludeLabels []string) (*PromRegistry, error) {

	excludeMetricsRegexp, err := stringArrayToRegexpArray(excludeMetrics)
	if err != nil {
		return nil, fmt.Errorf("invalid regex for exclude metrics: %w", err)
	}

	excludeLabelsRegexp, err := stringArrayToRegexpArray(excludeLabels)
	if err != nil {
		return nil, fmt.Errorf("invalid regex for exclude metric labels: %w", err)
	}

	return &PromRegistry{
		promRegistry:   promRegistry,
		excludeMetrics: excludeMetricsRegexp,
		excludeLabels:  excludeLabelsRegexp,
	}, nil
}

// Gather returns all metrics in the registry. It is called every time the Prometheus endpoint is scraped.
func (wr *PromRegistry) Gather() ([]*dto.MetricFamily, error) {
	return wr.Filter()
}

func (wr *PromRegistry) Filter() ([]*dto.MetricFamily, error) {
	var metrics []*dto.MetricFamily
	families, err := wr.promRegistry.Gather()
	if err != nil {
		return nil, err
	}

	for _, f := range families {
		excludeMetric := false
		for _, regMetric := range wr.excludeMetrics {
			if regMetric.MatchString(f.GetName()) {
				excludeMetric = true
				break
			}
		}

		if excludeMetric {
			continue
		}

		for _, m := range f.GetMetric() {
			var labels []*dto.LabelPair
			for _, l := range m.GetLabel() {
				excludeLabel := false

				for _, regLabel := range wr.excludeLabels {
					if regLabel.MatchString(l.GetName()) {
						excludeLabel = true
						break
					}
				}

				if excludeLabel {
					continue
				}

				labels = append(labels, l)
			}
			m.Label = labels
		}

		metrics = append(metrics, f)
	}

	return metrics, nil
}

func (wr *PromRegistry) Register(collector prom.Collector) error {
	return wr.promRegistry.Register(collector)
}

func (wr *PromRegistry) MustRegister(collector ...prom.Collector) {
	wr.promRegistry.MustRegister(collector...)
}

func (wr *PromRegistry) Unregister(collector prom.Collector) bool {
	return wr.promRegistry.Unregister(collector)
}

func stringArrayToRegexpArray(stringArray []string) ([]regexp.Regexp, error) {
	var regexpArray []regexp.Regexp
	for _, s := range stringArray {
		if s == "" {
			continue
		}
		r, err := regexp.Compile(s)
		if err != nil {
			return nil, fmt.Errorf("invalid regex '%s': %w", s, err)
		}
		regexpArray = append(regexpArray, *r)
	}
	return regexpArray, nil
}

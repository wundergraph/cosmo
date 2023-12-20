package metric

import (
	"fmt"
	"github.com/cespare/xxhash/v2"
	"github.com/go-chi/chi"
	"github.com/go-chi/chi/middleware"
	"github.com/prometheus/client_golang/prometheus/collectors"
	"github.com/prometheus/client_golang/prometheus/promhttp"
	"github.com/wundergraph/cosmo/router/internal/otel"
	"go.uber.org/zap"
	"net/http"
	"regexp"
	"slices"
	"sort"
	"strings"
	"sync"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/prometheus/client_golang/prometheus"
	"go.opentelemetry.io/otel/attribute"
)

const (
	targetInfoMetricName  = "target_info"
	targetInfoDescription = "Target metadata"
)

// Excluded by default from Prometheus export because of high cardinality
// This would produce a metric series for each unique operation
// Metric must be in snake case because that's how the Prometheus exporter converts them
var defaultExcludedPromMetricLabels = []*regexp.Regexp{
	regexp.MustCompile(sanitizeLabelName(string(otel.WgOperationHash))),
}

type PromClient interface {
	AddCounter(name string, help string, val float64, attr ...attribute.KeyValue)
	AddGauge(name string, help string, val float64, attr ...attribute.KeyValue)
	AddHistogram(name string, help string, val float64, buckets []float64, attr ...attribute.KeyValue)
	AddInfoMetric(attr ...attribute.KeyValue)
	Registry() *prometheus.Registry
	Serve(listenAddr, path string) *http.Server
}

func NewPromClient(logger *zap.Logger, excludeLabels []*regexp.Regexp, excludeMetrics []*regexp.Regexp) PromClient {
	registry := prometheus.NewRegistry()
	registry.MustRegister(collectors.NewGoCollector())
	registry.MustRegister(collectors.NewProcessCollector(collectors.ProcessCollectorOpts{}))

	excludeLabels = append(excludeLabels, defaultExcludedPromMetricLabels...)

	return &prometheusStore{
		logger:    logger,
		registry:  registry,
		namespace: "",
		counter:   make(map[string]*prometheus.CounterVec),
		histogram: make(map[string]*prometheus.HistogramVec),
		gauge:     make(map[string]*prometheus.GaugeVec),

		excludeLabels:  excludeLabels,
		excludeMetrics: excludeMetrics,
	}
}

// prometheusStore is a store to simplify the creation of Prometheus instruments.
// You have to ensure that labels won't change once an instrument is created.
type prometheusStore struct {
	// mu protects all members below from the concurrent access.
	mu        sync.Mutex
	logger    *zap.Logger
	registry  *prometheus.Registry
	namespace string
	counter   map[string]*prometheus.CounterVec
	histogram map[string]*prometheus.HistogramVec
	gauge     map[string]*prometheus.GaugeVec

	excludeLabels  []*regexp.Regexp
	excludeMetrics []*regexp.Regexp
}

func (h *prometheusStore) Registry() *prometheus.Registry {
	return h.registry
}

func (h *prometheusStore) filterLabels(kv attribute.KeyValue) bool {
	for _, re := range h.excludeLabels {
		// filter on the exported prometheus label name
		labelName := sanitizeLabelName(string(kv.Key))
		if re.MatchString(labelName) {
			return false
		}
	}
	return true
}

func (h *prometheusStore) ignoreMetric(name string) bool {
	for _, re := range h.excludeMetrics {
		if re.MatchString(name) {
			return true
		}
	}
	return false

}

func (h *prometheusStore) AddInfoMetric(attr ...attribute.KeyValue) {
	keys, values := getAttrs(h.filterLabels, attr...)

	g := prometheus.NewGaugeVec(prometheus.GaugeOpts{
		Name: targetInfoMetricName,
		Help: targetInfoDescription,
	}, keys)
	if err := h.registry.Register(g); err != nil {
		h.logger.Error("failed to register prometheus gauge", zap.Error(err))
	}
	g.WithLabelValues(values...).Set(1)
}

func (h *prometheusStore) AddGauge(name string, help string, val float64, attr ...attribute.KeyValue) {
	name = getName(name, h.namespace, false)
	if h.ignoreMetric(name) {
		return
	}

	keys, values := getAttrs(h.filterLabels, attr...)
	hash := metricLabelsToSignature(name, keys)

	h.mu.Lock()
	defer h.mu.Unlock()

	if _, ok := h.gauge[hash]; !ok {
		h.gauge[hash] = prometheus.NewGaugeVec(prometheus.GaugeOpts{
			Name: name,
			Help: help,
		}, keys)
		if err := h.registry.Register(h.gauge[hash]); err != nil {
			h.logger.Error("failed to register prometheus gauge", zap.Error(err))
		}
		h.gauge[hash].WithLabelValues(values...).Add(val)
	} else {
		h.gauge[hash].WithLabelValues(values...).Add(val)
	}
}

func (h *prometheusStore) AddCounter(name string, help string, val float64, attr ...attribute.KeyValue) {
	name = getName(name, h.namespace, true)
	if h.ignoreMetric(name) {
		return
	}

	keys, values := getAttrs(h.filterLabels, attr...)
	hash := metricLabelsToSignature(name, keys)

	h.mu.Lock()
	defer h.mu.Unlock()

	if _, ok := h.counter[hash]; !ok {
		h.counter[hash] = prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: name,
			Help: help,
		}, keys)
		if err := h.registry.Register(h.counter[hash]); err != nil {
			h.logger.Error("failed to register prometheus counter", zap.Error(err))
		}
		h.counter[hash].WithLabelValues(values...).Add(val)
	} else {
		h.counter[hash].WithLabelValues(values...).Add(val)
	}
}

func (h *prometheusStore) AddHistogram(name string, help string, val float64, buckets []float64, attr ...attribute.KeyValue) {
	name = getName(name, h.namespace, false)
	if h.ignoreMetric(name) {
		return
	}

	keys, values := getAttrs(h.filterLabels, attr...)
	hash := metricLabelsToSignature(name, keys)

	h.mu.Lock()
	defer h.mu.Unlock()

	if _, ok := h.histogram[hash]; !ok {
		h.histogram[hash] = prometheus.NewHistogramVec(prometheus.HistogramOpts{
			Name:    name,
			Help:    help,
			Buckets: buckets,
		}, keys)
		if err := h.registry.Register(h.histogram[hash]); err != nil {
			h.logger.Error("failed to register prometheus histogram", zap.Error(err))
		}
		h.histogram[hash].WithLabelValues(values...).Observe(val)
	} else {
		h.histogram[hash].WithLabelValues(values...).Observe(val)
	}
}

func (h *prometheusStore) Serve(listenAddr, path string) *http.Server {
	r := chi.NewRouter()
	r.Use(middleware.Recoverer)
	r.Handle(path, promhttp.HandlerFor(h.registry, promhttp.HandlerOpts{
		EnableOpenMetrics: true,
		ErrorLog:          zap.NewStdLog(h.logger),
		Registry:          h.registry,
		Timeout:           0,
	}))

	svr := &http.Server{
		Addr:              listenAddr,
		ReadTimeout:       1 * time.Minute,
		WriteTimeout:      2 * time.Minute,
		ReadHeaderTimeout: 20 * time.Second,
		ErrorLog:          zap.NewStdLog(h.logger),
		Handler:           r,
	}

	h.logger.Info("Prometheus metrics enabled", zap.String("listen_addr", svr.Addr), zap.String("endpoint", path))

	return svr
}

// prometheus counters MUST have a _total suffix by default
const counterSuffix = "_total"

func sanitizeLabelName(name string) string {
	return strings.Map(sanitizeRune, name)
}

// getAttrs filters and sort the KeyValue pairs and returns two arrays.
// The first array contains the sanitized keys and the second the values.
func getAttrs(re attribute.Filter, attr ...attribute.KeyValue) ([]string, []string) {
	s := attribute.NewSet(attr...)
	fs, _ := s.Filter(re)
	return getSanitizedSortedAttrs(fs)
}

// getAttrs parses the attribute.Set to two lists of matching Prometheus-style
// keys and values. It sanitizes invalid characters and handles duplicate keys
// (due to sanitization) by sorting and concatenating the values following the spec.
func getSanitizedSortedAttrs(attrs attribute.Set) ([]string, []string) {
	keysMap := make(map[string][]string)
	itr := attrs.Iter()
	for itr.Next() {
		kv := itr.Attribute()
		key := sanitizeLabelName(string(kv.Key))
		if _, ok := keysMap[key]; !ok {
			keysMap[key] = []string{kv.Value.Emit()}
		} else {
			// if the sanitized key is a duplicate, append to the list of keys
			keysMap[key] = append(keysMap[key], kv.Value.Emit())
		}
	}

	// Sort values

	keys := make([]string, 0, attrs.Len())
	values := make([]string, 0, attrs.Len())
	for key, vals := range keysMap {
		keys = append(keys, key)
		sort.Slice(vals, func(i, j int) bool {
			return i < j
		})
		values = append(values, strings.Join(vals, ";"))
	}

	// Create a map to store the old position

	keyValMap := make(map[string]string, len(keys))

	for idx := range keys {
		keyValMap[keys[idx]] = values[idx]
	}

	// Sort the keys and values to ensure that the order is deterministic

	slices.Sort(keys)

	newKeys := make([]string, 0, len(keys))
	newValues := make([]string, 0, len(values))

	for idx := range keys {
		newKeys = append(newKeys, keys[idx])
		newValues = append(newValues, keyValMap[keys[idx]])
	}

	return newKeys, newValues
}

func sanitizeRune(r rune) rune {
	if unicode.IsLetter(r) || unicode.IsDigit(r) || r == ':' || r == '_' {
		return r
	}
	return '_'
}

func getName(name string, namespace string, addCounterSuffix bool) string {
	name = sanitizeName(name)
	if addCounterSuffix {
		// Remove the _total suffix here, as we will re-add the total suffix
		// later, and it needs to come after the unit suffix.
		name = strings.TrimSuffix(name, counterSuffix)
	}
	if namespace != "" {
		name = namespace + name
	}
	if addCounterSuffix {
		name += counterSuffix
	}

	return name
}

func sanitizeName(n string) string {
	// This algorithm is based on strings.Map from Go 1.19.
	const replacement = '_'

	valid := func(i int, r rune) bool {
		// Taken from
		// https://github.com/prometheus/common/blob/dfbc25bd00225c70aca0d94c3c4bb7744f28ace0/model/metric.go#L92-L102
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || r == '_' || r == ':' || (r >= '0' && r <= '9' && i > 0) {
			return true
		}
		return false
	}

	// This output buffer b is initialized on demand, the first time a
	// character needs to be replaced.
	var b strings.Builder
	for i, c := range n {
		if valid(i, c) {
			continue
		}

		if i == 0 && c >= '0' && c <= '9' {
			// Prefix leading number with replacement character.
			b.Grow(len(n) + 1)
			_ = b.WriteByte(byte(replacement))
			break
		}
		b.Grow(len(n))
		_, _ = b.WriteString(n[:i])
		_ = b.WriteByte(byte(replacement))
		width := utf8.RuneLen(c)
		n = n[i+width:]
		break
	}

	// Fast path for unchanged input.
	if b.Cap() == 0 { // b.Grow was not called above.
		return n
	}

	for _, c := range n {
		// Due to inlining, it is more performant to invoke WriteByte rather then
		// WriteRune.
		if valid(1, c) { // We are guaranteed to not be at the start.
			_ = b.WriteByte(byte(c))
		} else {
			_ = b.WriteByte(byte(replacement))
		}
	}

	return b.String()
}

// metricLabelsToSignature returns a unique signature for a metric name labels combination.
// This is used to uniquely identify a metric in the instrumentation store.
func metricLabelsToSignature(metricName string, labels []string) string {
	if len(labels) == 0 {
		return metricName
	}

	h := xxhash.New()
	h.WriteString(metricName)

	for i := range labels {
		h.WriteString(labels[i])
	}
	return fmt.Sprintf("%x", h.Sum(nil))
}

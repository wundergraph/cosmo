package metric

import (
	"context"
	"errors"
	"fmt"
	"github.com/shirou/gopsutil/v3/process"
	"go.opentelemetry.io/otel/attribute"
	otelmetric "go.opentelemetry.io/otel/metric"
	"go.opentelemetry.io/otel/sdk/metric"
	"go.uber.org/zap"
	"os"
	goruntime "runtime"
	"sync"
	"time"
)

const (
	cosmoRouterRuntimeMeterName        = "cosmo.router.runtime"
	cosmoRouterRuntimeMeterVersion     = "0.0.1"
	DefaultMinimumReadMemStatsInterval = 15 * time.Second

	AttributeGoInfoVersion = attribute.Key("version")
)

type RuntimeMetrics struct {
	meter                   otelmetric.Meter
	baseAttributes          []attribute.KeyValue
	instrumentRegistrations []otelmetric.Registration
	processStartTime        time.Time
	logger                  *zap.Logger
}

// NewRuntimeMetrics creates a new instance of RuntimeMetrics. Runtime metrics are metrics that are collected from the Go and process runtime.
// These metrics are shared across feature flags.
func NewRuntimeMetrics(logger *zap.Logger, meterProvider *metric.MeterProvider, baseAttributes []attribute.KeyValue, processStartTime time.Time) *RuntimeMetrics {
	// Calling meter with the same name and version will return the same instance of the meter.
	meter := meterProvider.Meter(cosmoRouterRuntimeMeterName,
		otelmetric.WithInstrumentationVersion(cosmoRouterRuntimeMeterVersion),
	)

	return &RuntimeMetrics{
		meter:            meter,
		baseAttributes:   baseAttributes,
		logger:           logger,
		processStartTime: processStartTime,
	}
}

func (r *RuntimeMetrics) Start() error {

	// lock prevents a race between batch observer and instrument registration.
	var (
		lock            sync.Mutex
		processCPUUsage otelmetric.Float64ObservableGauge
		heapAlloc       otelmetric.Int64ObservableUpDownCounter
		heapIdle        otelmetric.Int64ObservableUpDownCounter
		heapInuse       otelmetric.Int64ObservableUpDownCounter
		heapObjects     otelmetric.Int64ObservableUpDownCounter
		heapReleased    otelmetric.Int64ObservableUpDownCounter
		heapSys         otelmetric.Int64ObservableUpDownCounter
		liveObjects     otelmetric.Int64ObservableUpDownCounter
		goroutinesCount otelmetric.Int64ObservableUpDownCounter
		goVersion       otelmetric.Int64ObservableUpDownCounter

		gcCount      otelmetric.Int64ObservableCounter
		pauseTotalNs otelmetric.Int64ObservableCounter
		gcPauseNs    otelmetric.Int64Histogram

		lastNumGC    uint32
		lastMemStats time.Time
		memStats     goruntime.MemStats
	)

	lock.Lock()
	defer lock.Unlock()

	runtimeUptime, err := r.meter.Int64ObservableGauge(
		"process.uptime",
		otelmetric.WithUnit("s"),
		otelmetric.WithDescription("Seconds since application was initialized"),
	)
	if err != nil {
		return err
	}

	if processCPUUsage, err = r.meter.Float64ObservableGauge(
		"process.cpu.usage",
		otelmetric.WithUnit("percent"),
		otelmetric.WithDescription(
			"Total CPU usage of this process in percentage of host total CPU capacity",
		),
	); err != nil {
		return err
	}

	if heapAlloc, err = r.meter.Int64ObservableUpDownCounter(
		"process.runtime.go.mem.heap_alloc",
		otelmetric.WithUnit("By"),
		otelmetric.WithDescription("Bytes of allocated heap objects"),
	); err != nil {
		return err
	}

	if heapIdle, err = r.meter.Int64ObservableUpDownCounter(
		"process.runtime.go.mem.heap_idle",
		otelmetric.WithUnit("By"),
		otelmetric.WithDescription("Bytes in idle (unused) spans"),
	); err != nil {
		return err
	}

	if heapInuse, err = r.meter.Int64ObservableUpDownCounter(
		"process.runtime.go.mem.heap_inuse",
		otelmetric.WithUnit("By"),
		otelmetric.WithDescription("Bytes in in-use spans"),
	); err != nil {
		return err
	}

	if heapObjects, err = r.meter.Int64ObservableUpDownCounter(
		"process.runtime.go.mem.heap_objects",
		otelmetric.WithDescription("Number of allocated heap objects"),
	); err != nil {
		return err
	}

	// FYI see https://github.com/golang/go/issues/32284 to help
	// understand the meaning of this value.
	if heapReleased, err = r.meter.Int64ObservableUpDownCounter(
		"process.runtime.go.mem.heap_released",
		otelmetric.WithUnit("By"),
		otelmetric.WithDescription("Bytes of idle spans whose physical memory has been returned to the OS"),
	); err != nil {
		return err
	}

	if heapSys, err = r.meter.Int64ObservableUpDownCounter(
		"process.runtime.go.mem.heap_sys",
		otelmetric.WithUnit("By"),
		otelmetric.WithDescription("Bytes of heap memory obtained from the OS"),
	); err != nil {
		return err
	}

	if liveObjects, err = r.meter.Int64ObservableUpDownCounter(
		"process.runtime.go.mem.live_objects",
		otelmetric.WithDescription("Number of live objects is the number of cumulative Mallocs - Frees"),
	); err != nil {
		return err
	}

	if gcCount, err = r.meter.Int64ObservableCounter(
		"process.runtime.go.gc.count",
		otelmetric.WithDescription("Number of completed garbage collection cycles"),
	); err != nil {
		return err
	}

	if goroutinesCount, err = r.meter.Int64ObservableUpDownCounter(
		"process.runtime.go.goroutines.count",
		otelmetric.WithDescription("Number of goroutines that currently exist"),
	); err != nil {
		return err
	}

	if goVersion, err = r.meter.Int64ObservableUpDownCounter(
		"process.runtime.go.info",
		otelmetric.WithDescription("Information about the Go runtime environment"),
	); err != nil {
		return err
	}

	// Note that the following could be derived as a sum of
	// individual pauses, but we may lose individual pauses if the
	// observation interval is too slow.
	if pauseTotalNs, err = r.meter.Int64ObservableCounter(
		"process.runtime.go.gc.pause_total",
		otelmetric.WithUnit("ns"),
		otelmetric.WithDescription("Cumulative nanoseconds in GC stop-the-world pauses since the program started"),
	); err != nil {
		return err
	}

	if gcPauseNs, err = r.meter.Int64Histogram(
		"process.runtime.go.gc.pause",
		otelmetric.WithUnit("ns"),
		otelmetric.WithDescription("Amount of nanoseconds in GC stop-the-world pauses"),
	); err != nil {
		return err
	}

	serverUptime, err := r.meter.Int64ObservableGauge(
		"server.uptime",
		otelmetric.WithUnit("s"),
		otelmetric.WithDescription("Seconds since the server started. Resets between router config changes."),
	)
	if err != nil {
		return err
	}

	p, err := process.NewProcess(int32(os.Getpid()))
	if err != nil {
		return err
	}

	now := time.Now()

	rc, err := r.meter.RegisterCallback(
		func(ctx context.Context, o otelmetric.Observer) error {
			lock.Lock()
			defer lock.Unlock()

			/**
			* Process CPU usage. Support on Linux, Mac, and Windows but not on BSD.
			 */

			processCpuUsageInPercent, err := p.PercentWithContext(ctx, 0)

			// If the process CPU usage is not available, we just skip the observation.
			if err == nil {
				o.ObserveFloat64(processCPUUsage,
					processCpuUsageInPercent,
					otelmetric.WithAttributes(r.baseAttributes...),
				)
			}

			/**
			* Server uptime. Everytime the store is reloaded, the server uptime is reset.
			 */

			o.ObserveInt64(serverUptime,
				int64(time.Since(now).Seconds()),
				otelmetric.WithAttributes(r.baseAttributes...),
			)

			/*
			* Process uptime
			 */
			o.ObserveInt64(runtimeUptime, int64(time.Since(r.processStartTime).Seconds()),
				otelmetric.WithAttributes(r.baseAttributes...),
			)

			/**
			* Go runtime metrics
			 */

			o.ObserveInt64(goVersion, 1,
				otelmetric.WithAttributes(AttributeGoInfoVersion.String(goruntime.Version())),
				otelmetric.WithAttributes(r.baseAttributes...),
			)
			o.ObserveInt64(goroutinesCount, int64(goruntime.NumGoroutine()), otelmetric.WithAttributes(r.baseAttributes...))

			/**
			* Go runtime memory stats
			 */

			now := time.Now()
			if now.Sub(lastMemStats) >= DefaultMinimumReadMemStatsInterval {
				goruntime.ReadMemStats(&memStats)
				lastMemStats = now
			}

			o.ObserveInt64(heapAlloc, int64(memStats.HeapAlloc), otelmetric.WithAttributes(r.baseAttributes...))
			o.ObserveInt64(heapIdle, int64(memStats.HeapIdle), otelmetric.WithAttributes(r.baseAttributes...))
			o.ObserveInt64(heapInuse, int64(memStats.HeapInuse), otelmetric.WithAttributes(r.baseAttributes...))
			o.ObserveInt64(heapObjects, int64(memStats.HeapObjects), otelmetric.WithAttributes(r.baseAttributes...))
			o.ObserveInt64(heapReleased, int64(memStats.HeapReleased), otelmetric.WithAttributes(r.baseAttributes...))
			o.ObserveInt64(heapSys, int64(memStats.HeapSys), otelmetric.WithAttributes(r.baseAttributes...))
			o.ObserveInt64(liveObjects, int64(memStats.Mallocs-memStats.Frees), otelmetric.WithAttributes(r.baseAttributes...))
			o.ObserveInt64(gcCount, int64(memStats.NumGC), otelmetric.WithAttributes(r.baseAttributes...))
			o.ObserveInt64(pauseTotalNs, int64(memStats.PauseTotalNs), otelmetric.WithAttributes(r.baseAttributes...))

			computeGCPauses(ctx, gcPauseNs, memStats.PauseNs[:], lastNumGC, memStats.NumGC)

			lastNumGC = memStats.NumGC

			return nil
		},
		heapAlloc,
		heapIdle,
		heapInuse,
		heapObjects,
		heapReleased,
		heapSys,
		liveObjects,
		goroutinesCount,
		goVersion,

		gcCount,
		pauseTotalNs,

		processCPUUsage,
		runtimeUptime,
		serverUptime,
	)

	if err != nil {
		return err
	}

	r.instrumentRegistrations = append(r.instrumentRegistrations, rc)

	return nil
}

func (r *RuntimeMetrics) Shutdown() error {
	var err error

	for _, reg := range r.instrumentRegistrations {
		if regErr := reg.Unregister(); regErr != nil {
			err = errors.Join(regErr)
		}
	}

	if err != nil {
		return fmt.Errorf("shutdown runtime metrics: %w", err)
	}

	return nil
}

func computeGCPauses(
	ctx context.Context,
	recorder otelmetric.Int64Histogram,
	circular []uint64,
	lastNumGC, currentNumGC uint32,
) {
	delta := int(int64(currentNumGC) - int64(lastNumGC))

	if delta == 0 {
		return
	}

	if delta >= len(circular) {
		// There were > 256 collections, some may have been lost.
		recordGCPauses(ctx, recorder, circular)
		return
	}

	length := uint32(len(circular))

	i := lastNumGC % length
	j := currentNumGC % length

	if j < i { // wrap around the circular buffer
		recordGCPauses(ctx, recorder, circular[i:])
		recordGCPauses(ctx, recorder, circular[:j])
		return
	}

	recordGCPauses(ctx, recorder, circular[i:j])
}

func recordGCPauses(
	ctx context.Context,
	recorder otelmetric.Int64Histogram,
	pauses []uint64,
) {
	for _, pause := range pauses {
		recorder.Record(ctx, int64(pause))
	}
}

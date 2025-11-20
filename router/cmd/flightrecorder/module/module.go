package module

import (
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"runtime/trace"
	"time"

	"github.com/wundergraph/cosmo/router/core"
	"go.uber.org/zap"
)

const flightRecorderID = "flightRecorder"

func init() {
	// Register your module here
	core.RegisterModule(&FlightRecorder{})
}

type FlightRecorder struct {
	OutputPath                    string `mapstructure:"outputPath"`
	RecordMultiple                bool   `mapstructure:"recordMultiple"`
	RequestLatencyRecordThreshold uint64 `mapstructure:"requestLatencyRecordThreshold"`

	requestLatencyRecordThresholdDuration time.Duration

	// Add a new property here
	fl *trace.FlightRecorder

	Logger *zap.Logger
}

func (m *FlightRecorder) Provision(ctx *core.ModuleContext) error {
	// Assign the logger to the module for non-request related logging
	m.Logger = ctx.Logger

	m.Logger.Info("Setting up flight recorder")

	if m.RequestLatencyRecordThreshold <= 0 {
		return fmt.Errorf("request latency threshold must be greater than 0")
	}

	if m.OutputPath == "" {
		return fmt.Errorf("output path must be specified")
	}

	m.requestLatencyRecordThresholdDuration = time.Duration(m.RequestLatencyRecordThreshold) * time.Millisecond

	// Create output directory if it doesn't exist
	if err := os.MkdirAll(m.OutputPath, 0755); err != nil {
		return fmt.Errorf("failed to create output directory: %w", err)
	}

	// 10MB minimum
	var maxBytes uint64 = 10 * 1024 * 1024

	// We actually want ~10MB/s of MinAge
	// 1000ms = 1 second, 1000 is close enough to 1024
	// sub in the uint milliseconds count for one of the factors
	// if it would result in a value greater than default maxBytes
	if m.RequestLatencyRecordThreshold*2 > 1024 {
		maxBytes = (m.RequestLatencyRecordThreshold * 2) * 1024 * 10
	}

	m.fl = trace.NewFlightRecorder(trace.FlightRecorderConfig{
		MinAge:   m.requestLatencyRecordThresholdDuration,
		MaxBytes: maxBytes,
	})

	m.fl.Start()

	return nil
}

func (m *FlightRecorder) Cleanup() error {
	m.fl.Stop()

	return nil
}

func (m *FlightRecorder) RouterOnRequest(ctx core.RequestContext, next http.Handler) {
	start := time.Now()

	next.ServeHTTP(ctx.ResponseWriter(), ctx.Request())

	requestDuration := time.Since(start)

	if m.fl.Enabled() && requestDuration > m.requestLatencyRecordThresholdDuration {
		operation := ctx.Operation()

		m.Logger.Warn("Request took longer than threshold", zap.Duration("duration", requestDuration), zap.String("operation", operation.Name()))

		m.RecordTrace(operation.Name())
	}
}

func (m *FlightRecorder) RecordTrace(operationName string) {
	// Generate timestamped filename
	filename := fmt.Sprintf("trace-%s-%s.out", operationName, time.Now().Format("2006-01-02-15-04-05"))

	// Create the file
	file, err := os.Create(filepath.Join(m.OutputPath, filename))
	if err != nil {
		m.Logger.Error("failed to create trace file: %w", zap.Error(err))
		return
	}
	defer file.Close()

	_, err = m.fl.WriteTo(file)
	if err != nil {
		m.Logger.Error("Failed to record request", zap.Error(err))
	}

	if !m.RecordMultiple {
		m.fl.Stop()
	}
}

func (m *FlightRecorder) Module() core.ModuleInfo {
	return core.ModuleInfo{
		ID:       flightRecorderID,
		Priority: 1,
		New: func() core.Module {
			return &FlightRecorder{}
		},
	}
}

// Interface guard
var (
	_ core.RouterOnRequestHandler = (*FlightRecorder)(nil)
	_ core.Provisioner            = (*FlightRecorder)(nil)
	_ core.Cleaner                = (*FlightRecorder)(nil)
)

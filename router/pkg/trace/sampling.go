package trace

import (
	"context"

	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.uber.org/zap"
)

// ExporterSamplingRate returns the sampling rate of exp. Exporters without
// their own rate receive every trace the router records.
func ExporterSamplingRate(exp *ExporterConfig) float64 {
	if exp.SamplingRate != nil {
		return *exp.SamplingRate
	}
	return 1
}

// headSamplingRate returns the rate at which the router samples traces itself.
// It lowers the global rate to the highest exporter rate, so the router does not
// record traces, or mark subgraph requests as sampled, when no exporter receives them.
func headSamplingRate(config *ProviderConfig) float64 {
	rate := config.Config.Sampler
	if !config.Config.Enabled || config.MemoryExporter != nil {
		return rate
	}

	highest := -1.0
	for _, exp := range config.Config.Exporters {
		if !exp.Disabled {
			highest = max(highest, ExporterSamplingRate(exp))
		}
	}
	if highest < 0 || highest >= rate {
		return rate
	}

	config.Logger.Debug("Lowering the trace sampling rate to the highest exporter sampling rate",
		zap.Float64("sampling_rate", rate),
		zap.Float64("exporter_sampling_rate", highest),
	)
	return highest
}

// traceIDSamplingProcessor forwards to the wrapped processor only the spans of
// traces selected by a trace ID ratio. It uses the same decision as the head
// sampler, so an exporter receives at most the traces the head sampler records,
// the traces it receives are a subset of those received by an exporter with a
// higher rate, and every exporter receives complete traces.
type traceIDSamplingProcessor struct {
	sdktrace.SpanProcessor
	sampler sdktrace.Sampler
}

func newTraceIDSamplingProcessor(next sdktrace.SpanProcessor, rate float64) *traceIDSamplingProcessor {
	return &traceIDSamplingProcessor{
		SpanProcessor: next,
		sampler:       sdktrace.TraceIDRatioBased(rate),
	}
}

func (p *traceIDSamplingProcessor) sampled(span sdktrace.ReadOnlySpan) bool {
	result := p.sampler.ShouldSample(sdktrace.SamplingParameters{
		ParentContext: context.Background(),
		TraceID:       span.SpanContext().TraceID(),
	})
	return result.Decision == sdktrace.RecordAndSample
}

func (p *traceIDSamplingProcessor) OnStart(parent context.Context, s sdktrace.ReadWriteSpan) {
	if p.sampled(s) {
		p.SpanProcessor.OnStart(parent, s)
	}
}

func (p *traceIDSamplingProcessor) OnEnd(s sdktrace.ReadOnlySpan) {
	if p.sampled(s) {
		p.SpanProcessor.OnEnd(s)
	}
}

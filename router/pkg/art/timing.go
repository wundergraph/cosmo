package art

import (
	"context"
	"time"

	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"
)

type TraceTimings struct {
	ctx            context.Context
	ParseStart     int64
	ParseEnd       int64
	NormalizeStart int64
	NormalizeEnd   int64
	ValidateStart  int64
	ValidateEnd    int64
	PlanningStart  int64
	PlanningEnd    int64
}

func NewTraceTimings(ctx context.Context) *TraceTimings {
	return &TraceTimings{
		ctx: ctx,
	}
}

func (tt *TraceTimings) StartParse() {
	tt.ParseStart = resolve.GetDurationNanoSinceTraceStart(tt.ctx)
}

func (tt *TraceTimings) EndParse() {
	tt.ParseEnd = resolve.GetDurationNanoSinceTraceStart(tt.ctx)
}

// StartNormalize starts the timing for the normalization step
func (tt *TraceTimings) StartNormalize() {
	tt.NormalizeStart = resolve.GetDurationNanoSinceTraceStart(tt.ctx)
}

func (tt *TraceTimings) EndNormalize() {
	tt.NormalizeEnd = resolve.GetDurationNanoSinceTraceStart(tt.ctx)
}

func (tt *TraceTimings) StartValidate() {
	tt.ValidateStart = resolve.GetDurationNanoSinceTraceStart(tt.ctx)
}

func (tt *TraceTimings) EndValidate() {
	tt.ValidateEnd = resolve.GetDurationNanoSinceTraceStart(tt.ctx)
}

func (tt *TraceTimings) StartPlanning() {
	tt.PlanningStart = resolve.GetDurationNanoSinceTraceStart(tt.ctx)
}

func (tt *TraceTimings) EndPlanning() {
	tt.PlanningEnd = resolve.GetDurationNanoSinceTraceStart(tt.ctx)
}

func (tt *TraceTimings) DurationParse() int64 {
	return tt.ParseEnd - tt.ParseStart
}

func (tt *TraceTimings) DurationNormalize() int64 {
	return tt.NormalizeEnd - tt.NormalizeStart
}

func (tt *TraceTimings) DurationValidate() int64 {
	return tt.ValidateEnd - tt.ValidateStart
}

func (tt *TraceTimings) DurationPlanning() int64 {
	return tt.PlanningEnd - tt.PlanningStart
}

func SetRequestTracingStats(ctx context.Context, traceOptions resolve.TraceOptions, traceTimings *TraceTimings) {
	if !traceOptions.ExcludeParseStats {
		resolve.SetParseStats(ctx, resolve.PhaseStats{
			DurationSinceStartNano:   traceTimings.ParseStart,
			DurationSinceStartPretty: time.Duration(traceTimings.ParseStart).String(),
			DurationNano:             traceTimings.DurationParse(),
			DurationPretty:           time.Duration(traceTimings.DurationParse()).String(),
		})
	}
	if !traceOptions.ExcludeNormalizeStats {
		resolve.SetNormalizeStats(ctx, resolve.PhaseStats{
			DurationSinceStartNano:   traceTimings.NormalizeStart,
			DurationSinceStartPretty: time.Duration(traceTimings.NormalizeStart).String(),
			DurationNano:             traceTimings.DurationNormalize(),
			DurationPretty:           time.Duration(traceTimings.DurationNormalize()).String(),
		})
	}
	if !traceOptions.ExcludeValidateStats {
		resolve.SetValidateStats(ctx, resolve.PhaseStats{
			DurationSinceStartNano:   traceTimings.ValidateStart,
			DurationSinceStartPretty: time.Duration(traceTimings.ValidateStart).String(),
			DurationNano:             traceTimings.DurationValidate(),
			DurationPretty:           time.Duration(traceTimings.DurationValidate()).String(),
		})
	}
	if !traceOptions.ExcludePlannerStats {
		resolve.SetPlannerStats(ctx, resolve.PhaseStats{
			DurationSinceStartNano:   traceTimings.PlanningStart,
			DurationSinceStartPretty: time.Duration(traceTimings.PlanningStart).String(),
			DurationNano:             traceTimings.DurationPlanning(),
			DurationPretty:           time.Duration(traceTimings.DurationPlanning()).String(),
		})
	}
}

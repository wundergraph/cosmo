package core

import (
	"context"
	"crypto/ecdsa"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"go.uber.org/zap"
)

const (
	deferAdvisorMaxConcurrentAnalyses = 2
	deferAdvisorDefaultTotalTimeout   = 2 * time.Minute
)

type DeferAdvisorOptions struct {
	EnableRequestTracing               bool
	DevelopmentMode                    bool
	ForceUnauthenticatedRequestTracing bool
	RouterPublicKey                    *ecdsa.PublicKey
	Logger                             *zap.Logger
}

type deferAdvisorPhases interface {
	fetchPlanModel(parent *http.Request, body []byte) ([]*advisorFetch, error)
	runBaseline(parent *http.Request, body []byte, runs int, fetches []*advisorFetch) (*advisorBaselinePhaseResult, error)
	runMaxSplit(parent *http.Request, request graphqlRequestBody, query string, runs int, fetches []*advisorFetch) error
	runOptimized(parent *http.Request, request graphqlRequestBody, query string, runs int) ([]*advisorDeferRun, error)
}

// DeferAdvisor profiles a query through the regular graph pipeline and only
// publishes an actionable rewrite after the complete optimized stream has been
// measured repeatedly and passed the conservative validation gate.
type DeferAdvisor struct {
	authorizer    requestTracingAuthorizer
	logger        *zap.Logger
	target        http.Handler
	phases        deferAdvisorPhases
	analysisSlots chan struct{}
	totalTimeout  time.Duration
}

func NewDeferAdvisor(opts DeferAdvisorOptions) *DeferAdvisor {
	logger := opts.Logger
	if logger == nil {
		logger = zap.NewNop()
	}
	return &DeferAdvisor{
		authorizer: requestTracingAuthorizer{
			enabled:           opts.EnableRequestTracing,
			allowWithoutToken: opts.DevelopmentMode || opts.ForceUnauthenticatedRequestTracing,
			publicKey:         opts.RouterPublicKey,
		},
		logger:        logger,
		analysisSlots: make(chan struct{}, deferAdvisorMaxConcurrentAnalyses),
		totalTimeout:  deferAdvisorDefaultTotalTimeout,
	}
}

// SetTarget is an initialization-only hook. The graph server calls it before
// publishing the middleware; callers must not replace the target while
// requests are in flight.
func (a *DeferAdvisor) SetTarget(target http.Handler) {
	a.target = target
	if target == nil {
		a.phases = nil
		return
	}
	executor := newDeferAdvisorReplayExecutor(target)
	a.phases = executor
}

func (a *DeferAdvisor) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get(DeferAdvisorHeader) == "" {
			next.ServeHTTP(w, r)
			return
		}
		authorized, err := a.authorizer.authorize(r.Header.Get("X-WG-Token"))
		if err != nil {
			a.logger.Debug("defer advisor request tracing authorization failed", zap.Error(err))
		}
		if !authorized {
			writeDeferAdvisorError(w, http.StatusForbidden, "defer advisor is not authorized for request tracing")
			return
		}
		if r.Method != http.MethodPost {
			w.Header().Set("Allow", http.MethodPost)
			writeDeferAdvisorError(w, http.StatusMethodNotAllowed, "defer advisor only supports POST requests")
			return
		}
		if a.target == nil || a.phases == nil {
			writeDeferAdvisorError(w, http.StatusInternalServerError, "defer advisor is not initialized")
			return
		}
		a.advise(w, r)
	})
}

func writeDeferAdvisorError(w http.ResponseWriter, status int, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]any{
		"errors": []map[string]any{{"message": message}},
	})
}

type advisorResponseEnvelope struct {
	Data       json.RawMessage `json:"data"`
	Errors     json.RawMessage `json:"errors,omitempty"`
	Extensions struct {
		Trace     json.RawMessage `json:"trace,omitempty"`
		QueryPlan json.RawMessage `json:"queryPlan,omitempty"`
	} `json:"extensions"`
}

func (a *DeferAdvisor) advise(w http.ResponseWriter, r *http.Request) {
	if err := validateDeferAdvisorContentType(r.Header.Get("Content-Type")); err != nil {
		writeDeferAdvisorError(w, http.StatusUnsupportedMediaType, err.Error())
		return
	}
	runs, err := parseDeferAdvisorRuns(r.Header.Get(DeferAdvisorRunsHeader))
	if err != nil {
		writeDeferAdvisorError(w, http.StatusBadRequest, err.Error())
		return
	}

	select {
	case a.analysisSlots <- struct{}{}:
		defer func() { <-a.analysisSlots }()
	default:
		writeDeferAdvisorError(w, http.StatusTooManyRequests, "defer advisor has reached its concurrent analysis limit")
		return
	}
	totalTimeout := a.totalTimeout
	if totalTimeout <= 0 {
		totalTimeout = deferAdvisorDefaultTotalTimeout
	}
	ctx, cancel := context.WithTimeout(r.Context(), totalTimeout)
	defer cancel()
	ctx = withDeferAdvisorReplayBudget(ctx, newDeferAdvisorReplayBudget(uint32(1+3*runs)))
	r = r.WithContext(ctx)
	stopBodyClose := context.AfterFunc(ctx, func() {
		_ = r.Body.Close()
	})
	defer stopBodyClose()

	body, err := readDeferAdvisorRequestBody(w, r)
	if err != nil {
		if contextErr := ctx.Err(); contextErr != nil {
			writeDeferAdvisorPhaseError(w, contextErr)
			return
		}
		status := http.StatusBadRequest
		if errors.Is(err, errDeferAdvisorRequestTooLarge) {
			status = http.StatusRequestEntityTooLarge
		}
		writeDeferAdvisorError(w, status, err.Error())
		return
	}
	request, body, err := prepareDeferAdvisorRequest(body)
	if err != nil {
		writeDeferAdvisorError(w, http.StatusBadRequest, err.Error())
		return
	}
	if err := ctx.Err(); err != nil {
		writeDeferAdvisorPhaseError(w, err)
		return
	}

	fetches, err := a.phases.fetchPlanModel(r, body)
	if err != nil {
		writeDeferAdvisorPhaseError(w, err)
		return
	}
	baseline, err := a.phases.runBaseline(r, body, runs, fetches)
	if err != nil {
		writeDeferAdvisorPhaseError(w, err)
		return
	}
	envelope := &advisorResponseEnvelope{
		Data:   baseline.lastResponse.data,
		Errors: baseline.lastResponse.errors,
	}
	if baseline.inconclusiveReason != "" {
		result := emptyDeferAdvisorResult(0)
		reason := "Baseline execution returned GraphQL errors, so no optimization was evaluated."
		if err := finalizeAdvisorResult(result, "", nil, deferAdvisorOutcomeInconclusive, reason); err != nil {
			writeDeferAdvisorError(w, http.StatusInternalServerError, err.Error())
			return
		}
		writeDeferAdvisorResponse(w, envelope, result)
		return
	}

	splitGroups := maxSplitGroups(fetches)
	if len(splitGroups) != 0 {
		splitQuery, rewriteErr := rewriteOperationWithDefer(request.Query, request.OperationName, splitGroups)
		if rewriteErr != nil {
			a.writeInconclusiveAdvisorResult(w, envelope, runs, baseline.totalsMs, fetches,
				fmt.Sprintf("The max-split profiling query could not be rewritten safely: %v", rewriteErr))
			return
		}
		if err := a.phases.runMaxSplit(r, request, splitQuery, runs, fetches); err != nil {
			if isDeferAdvisorOperationalPhaseError(err) {
				writeDeferAdvisorPhaseError(w, err)
				return
			}
			a.writeInconclusiveAdvisorResult(w, envelope, runs, baseline.totalsMs, fetches, err.Error())
			return
		}
	}

	result, err := buildAdvisorResult(runs, baseline.totalsMs, fetches)
	if err != nil {
		writeDeferAdvisorError(w, http.StatusInternalServerError, fmt.Sprintf("defer advisor produced invalid measurements: %v", err))
		return
	}
	if len(result.Suggestions) == 0 {
		if err := finalizeAdvisorResult(result, "", nil, deferAdvisorOutcomeNoCandidates, ""); err != nil {
			writeDeferAdvisorError(w, http.StatusInternalServerError, err.Error())
			return
		}
		writeDeferAdvisorResponse(w, envelope, result)
		return
	}

	suggestionGroups, expectedLabels := advisorSuggestionGroups(result.Suggestions)
	optimizedQuery, err := rewriteOperationWithDefer(request.Query, request.OperationName, suggestionGroups)
	if err != nil {
		if finalizeErr := finalizeAdvisorResult(result, "", nil, deferAdvisorOutcomeInconclusive,
			fmt.Sprintf("The optimized query could not be rewritten safely: %v", err)); finalizeErr != nil {
			writeDeferAdvisorError(w, http.StatusInternalServerError, finalizeErr.Error())
			return
		}
		writeDeferAdvisorResponse(w, envelope, result)
		return
	}
	if r.Header.Get(DeferAdvisorSkipValidationHeader) != "" {
		if err := finalizeAdvisorResult(result, "", nil, deferAdvisorOutcomeUnvalidated, ""); err != nil {
			writeDeferAdvisorError(w, http.StatusInternalServerError, err.Error())
			return
		}
		writeDeferAdvisorResponse(w, envelope, result)
		return
	}

	optimizedRuns, err := a.phases.runOptimized(r, request, optimizedQuery, runs)
	if err != nil {
		if isDeferAdvisorOperationalPhaseError(err) {
			writeDeferAdvisorPhaseError(w, err)
			return
		}
		if finalizeErr := finalizeAdvisorResult(result, "", nil, deferAdvisorOutcomeInconclusive, err.Error()); finalizeErr != nil {
			writeDeferAdvisorError(w, http.StatusInternalServerError, finalizeErr.Error())
			return
		}
		writeDeferAdvisorResponse(w, envelope, result)
		return
	}
	validation, outcome, err := aggregateAdvisorValidation(runs, baseline.totalsMs, optimizedRuns, expectedLabels)
	if err != nil {
		if finalizeErr := finalizeAdvisorResult(result, "", nil, deferAdvisorOutcomeInconclusive,
			fmt.Sprintf("Optimized stream validation was inconclusive: %v", err)); finalizeErr != nil {
			writeDeferAdvisorError(w, http.StatusInternalServerError, finalizeErr.Error())
			return
		}
		writeDeferAdvisorResponse(w, envelope, result)
		return
	}
	if err := finalizeAdvisorResult(result, optimizedQuery, validation, outcome, ""); err != nil {
		writeDeferAdvisorError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeDeferAdvisorResponse(w, envelope, result)
}

func isDeferAdvisorOperationalPhaseError(err error) bool {
	return errors.Is(err, context.DeadlineExceeded) ||
		errors.Is(err, context.Canceled) ||
		errors.Is(err, errDeferAdvisorReplayTimeout) ||
		errors.Is(err, errDeferAdvisorReplayBudgetExhausted)
}

func (a *DeferAdvisor) writeInconclusiveAdvisorResult(w http.ResponseWriter, envelope *advisorResponseEnvelope, runs int, totalsMs []float64, fetches []*advisorFetch, reason string) {
	result, err := buildAdvisorResult(runs, totalsMs, fetches)
	if err != nil {
		writeDeferAdvisorError(w, http.StatusInternalServerError, fmt.Sprintf("defer advisor produced invalid measurements: %v", err))
		return
	}
	if err := finalizeAdvisorResult(result, "", nil, deferAdvisorOutcomeInconclusive, reason); err != nil {
		writeDeferAdvisorError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeDeferAdvisorResponse(w, envelope, result)
}

func advisorSuggestionGroups(suggestions []deferAdvisorSuggestion) ([]deferGroup, []string) {
	groups := make([]deferGroup, 0, len(suggestions))
	labels := make([]string, 0, len(suggestions))
	for _, suggestion := range suggestions {
		var parentPath []string
		if suggestion.Path != "" {
			parentPath = strings.Split(suggestion.Path, ".")
		}
		groups = append(groups, deferGroup{
			ParentPath: parentPath,
			Fields:     suggestion.Fields,
			Label:      suggestion.Label,
		})
		labels = append(labels, suggestion.Label)
	}
	return groups, labels
}

func emptyDeferAdvisorResult(runs int) *deferAdvisorResult {
	return &deferAdvisorResult{
		Runs:        runs,
		Fetches:     make([]deferAdvisorFetchStats, 0),
		Fields:      make([]deferAdvisorFieldStats, 0),
		Suggestions: make([]deferAdvisorSuggestion, 0),
	}
}

func writeDeferAdvisorPhaseError(w http.ResponseWriter, err error) {
	status := http.StatusBadGateway
	switch {
	case errors.Is(err, context.DeadlineExceeded), errors.Is(err, errDeferAdvisorReplayTimeout):
		status = http.StatusGatewayTimeout
	case errors.Is(err, context.Canceled):
		status = http.StatusRequestTimeout
	case errors.Is(err, errDeferAdvisorReplayBudgetExhausted):
		status = http.StatusInternalServerError
	}
	writeDeferAdvisorError(w, status, err.Error())
}

func writeDeferAdvisorResponse(w http.ResponseWriter, envelope *advisorResponseEnvelope, result *deferAdvisorResult) {
	response := map[string]any{
		"data": envelope.Data,
		"extensions": map[string]any{
			"deferAdvisor": result,
		},
	}
	if len(envelope.Errors) != 0 {
		response["errors"] = envelope.Errors
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(response)
}

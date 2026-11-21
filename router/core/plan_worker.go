package core

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"reflect"
	"runtime/debug"
	"sync"
	"time"

	"go.uber.org/zap"
	"google.golang.org/protobuf/proto"

	"github.com/wundergraph/graphql-go-tools/v2/pkg/astprinter"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/datasource/staticdatasource"

	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
	"github.com/wundergraph/cosmo/router/internal/graphcodec"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"github.com/wundergraph/cosmo/router/pkg/metric"
	"github.com/wundergraph/cosmo/router/pkg/planworker"
)

// planWorkerSettings are the router settings that influence how operations are planned.
// Together with the execution config of a graph, they are all a plan worker needs to
// plan exactly like the router.
type planWorkerSettings struct {
	Introspection  bool
	TrackUsageInfo bool
	PluginsEnabled bool
	// Execution is passed on as a whole rather than as the handful of options the
	// planner reads today, so that a new option can't be forgotten here.
	Execution config.EngineExecutionConfiguration
}

// planWorkerConfig is the payload of a planworker.Config.
type planWorkerConfig struct {
	Settings planWorkerSettings
	// RouterConfig is a serialized nodev1.RouterConfig carrying the engine config and
	// the subgraphs of a single graph.
	RouterConfig []byte
}

// planWorkerConfigCodec encodes planWorkerConfig. The settings are plain data, but not
// all of their types survive a round trip through JSON.
var planWorkerConfigCodec = sync.OnceValue(func() *graphcodec.Codec {
	return graphcodec.NewBuilder().Build(reflect.TypeFor[planWorkerConfig]())
})

// planWorkerFormat identifies everything router and plan workers have to agree on to
// understand each other.
func planWorkerFormat() string {
	return planCodec().Fingerprint() + "-" + planWorkerConfigCodec().Fingerprint()
}

func newPlanWorkerConfig(settings planWorkerSettings, engineConfig *nodev1.EngineConfiguration, subgraphs []*nodev1.Subgraph) (*planworker.Config, error) {
	// Deterministic, so that the same graph always gets the same ID.
	routerConfig, err := proto.MarshalOptions{Deterministic: true}.Marshal(&nodev1.RouterConfig{
		EngineConfig: engineConfig,
		Subgraphs:    subgraphs,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to serialize execution config: %w", err)
	}
	payload, err := planWorkerConfigCodec().Marshal(&planWorkerConfig{Settings: settings, RouterConfig: routerConfig})
	if err != nil {
		return nil, fmt.Errorf("failed to serialize settings: %w", err)
	}
	id := sha256.Sum256(payload)
	return &planworker.Config{
		ID:      hex.EncodeToString(id[:16]),
		Payload: payload,
	}, nil
}

// planWorkerHandler is the worker side of remote planning: it plans operations with the
// regular planner and returns the encoded plans.
type planWorkerHandler struct {
	ctx      context.Context
	logger   *zap.Logger
	planners map[string]*OperationPlanner
}

func newPlanWorkerHandler(ctx context.Context, logger *zap.Logger) *planWorkerHandler {
	return &planWorkerHandler{
		ctx:      ctx,
		logger:   logger,
		planners: make(map[string]*OperationPlanner),
	}
}

func (h *planWorkerHandler) Configure(cfg *planworker.Config) error {
	if _, ok := h.planners[cfg.ID]; ok {
		return nil
	}

	var payload planWorkerConfig
	if _, err := planWorkerConfigCodec().Unmarshal(cfg.Payload, &payload); err != nil {
		return fmt.Errorf("failed to read settings: %w", err)
	}
	var routerConfig nodev1.RouterConfig
	if err := proto.Unmarshal(payload.RouterConfig, &routerConfig); err != nil {
		return fmt.Errorf("failed to read execution config: %w", err)
	}

	builder := &ExecutorConfigurationBuilder{
		introspection:  payload.Settings.Introspection,
		trackUsageInfo: payload.Settings.TrackUsageInfo,
		logger:         h.logger,
		// Without transports, the data sources of the plans can't reach a subgraph.
		// They don't have to, the router replaces them with its own.
		factoryResolver: &DefaultFactoryResolver{
			engineCtx: h.ctx,
			static:    &staticdatasource.Factory[staticdatasource.Configuration]{},
		},
	}
	executor, _, err := builder.buildPlanningExecutor(
		h.ctx,
		&ExecutorBuildOptions{
			EngineConfig: routerConfig.GetEngineConfig(),
			Subgraphs:    routerConfig.GetSubgraphs(),
			RouterEngineConfig: &RouterEngineConfiguration{
				Execution: payload.Settings.Execution,
				// The worker never talks to an event provider, it only has to know
				// that they exist.
				Events:            planningEventsConfiguration(routerConfig.GetEngineConfig()),
				StreamMetricStore: metric.NewNoopStreamMetricStore(),
			},
			PluginsEnabled: payload.Settings.PluginsEnabled,
		},
	)
	if err != nil {
		return err
	}

	h.planners[cfg.ID] = &OperationPlanner{executor: executor}

	h.logger.Debug("Loaded configuration", zap.String("config_id", cfg.ID))

	return nil
}

func (h *planWorkerHandler) Release(configID string) {
	delete(h.planners, configID)
	h.logger.Debug("Released configuration", zap.String("config_id", configID))
}

func (h *planWorkerHandler) Plan(request *planworker.Request) (result *planworker.Result) {
	defer func() {
		if r := recover(); r != nil {
			h.logger.Error("Panic while planning operation",
				zap.String("operation_name", request.OperationName),
				zap.Any("panic", r),
				zap.ByteString("stack", debug.Stack()),
			)
			result = &planworker.Result{
				Status:  planworker.StatusFailed,
				Message: fmt.Sprintf("panic while planning: %v", r),
			}
		}
	}()

	planner, ok := h.planners[request.ConfigID]
	if !ok {
		return &planworker.Result{
			Status:  planworker.StatusFailed,
			Message: fmt.Sprintf("configuration %q is not loaded", request.ConfigID),
		}
	}

	start := time.Now()
	planned, err := planner.planOperation(request.Content, request.OperationName, request.IncludeQueryPlan)
	planningDuration := time.Since(start)
	if err != nil {
		return &planworker.Result{Status: planworker.StatusFailed, Message: err.Error()}
	}

	encoded, err := encodePlan(planned.preparedPlan)
	if err != nil {
		var unsupported *graphcodec.UnsupportedError
		if errors.As(err, &unsupported) {
			return &planworker.Result{Status: planworker.StatusUnsupported, Message: err.Error()}
		}
		return &planworker.Result{Status: planworker.StatusFailed, Message: err.Error()}
	}

	operationDocument, err := astprinter.PrintString(planned.operationDocument)
	if err != nil {
		return &planworker.Result{
			Status:  planworker.StatusFailed,
			Message: fmt.Sprintf("failed to print planned operation: %s", err),
		}
	}

	return &planworker.Result{
		Status:            planworker.StatusOK,
		OperationDocument: operationDocument,
		PlanningDuration:  planningDuration,
		Plan:              encoded,
	}
}

// RunPlanWorker plans operations for the router at the other end of the given stream.
// It returns once the router closes the stream.
func RunPlanWorker(ctx context.Context, r io.Reader, w io.Writer, logger *zap.Logger, disconnected func()) error {
	return planworker.Serve(r, w, newPlanWorkerHandler(ctx, logger), planworker.ServeOptions{
		Version:      Version,
		PlanFormat:   planWorkerFormat(),
		Disconnected: disconnected,
	})
}

package core

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"slices"
	"sync/atomic"

	"github.com/buger/jsonparser"
	"go.uber.org/zap"

	"github.com/wundergraph/graphql-go-tools/v2/pkg/astparser"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/datasource/httpclient"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"

	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"github.com/wundergraph/cosmo/router/pkg/planworker"
)

// PlanWorkerCommand is the argument that makes the router binary run as a plan worker.
const PlanWorkerCommand = "plan-worker"

// errPlanLocally is returned by the remote planner for operations the router has to
// plan itself.
var errPlanLocally = errors.New("operation has to be planned by the router")

// newPlanWorkerPool creates the pool of plan workers shared by all graphs of a graph server.
// By default, the workers are child processes running the binary of the router.
func newPlanWorkerPool(cfg config.EnginePlanWorkersConfiguration, launcher planworker.Launcher, logger *zap.Logger) (*planworker.Pool, error) {
	if launcher == nil {
		executable, err := os.Executable()
		if err != nil {
			return nil, fmt.Errorf("failed to locate the router binary to start plan workers: %w", err)
		}
		launcher = &planworker.ProcessLauncher{
			Command: []string{executable, PlanWorkerCommand, "-log-level", logger.Level().String()},
		}
	}
	return planworker.NewPool(planworker.Options{
		Workers:      cfg.Count,
		QueueSize:    cfg.QueueSize,
		Timeout:      cfg.PlanTimeout,
		StartTimeout: cfg.StartTimeout,
		Version:      Version,
		PlanFormat:   planWorkerFormat(),
		Launcher:     launcher,
		Logger:       logger,
	})
}

// remotePlanner plans the operations of one graph on the plan workers.
type remotePlanner struct {
	pool     *planworker.Pool
	configID string
	executor *Executor
	// dataSources are the data sources the router attaches to the fetches of plans it
	// receives, by data source ID.
	dataSources map[string]resolve.DataSource
	logger      *zap.Logger

	planned, fallbacks atomic.Uint64
}

func newRemotePlanner(
	pool *planworker.Pool,
	settings planWorkerSettings,
	engineConfig *nodev1.EngineConfiguration,
	subgraphs []*nodev1.Subgraph,
	executor *Executor,
	logger *zap.Logger,
) (*remotePlanner, error) {
	cfg, err := newPlanWorkerConfig(settings, engineConfig, subgraphs)
	if err != nil {
		return nil, err
	}
	pool.Register(cfg)

	dataSources := make(map[string]resolve.DataSource, len(executor.subgraphFetchClients))
	for id, client := range executor.subgraphFetchClients {
		dataSources[id] = &subgraphFetchSource{httpClient: client}
	}

	return &remotePlanner{
		pool:        pool,
		configID:    cfg.ID,
		executor:    executor,
		dataSources: dataSources,
		logger:      logger,
	}, nil
}

// close releases the configuration of the graph on the workers.
func (r *remotePlanner) close() {
	r.pool.Unregister(r.configID)
}

// plan has a plan worker plan the operation. It returns errPlanLocally when the router
// has to plan the operation itself. Any other error means that the workers could not
// answer in time. Those operations are not planned by the router: a planning run that
// brought a worker down is exactly what we want to keep out of the router.
func (r *remotePlanner) plan(content, operationName string, includeQueryPlan bool) (*planWithMetaData, error) {
	// The request context is deliberately not used. Plans are shared between all
	// requests waiting for the same operation, the first of them going away must not
	// fail the others. The pool enforces its own timeout.
	result, err := r.pool.Plan(context.Background(), &planworker.Request{
		ConfigID:         r.configID,
		Content:          content,
		OperationName:    operationName,
		IncludeQueryPlan: includeQueryPlan,
	})
	if err != nil {
		switch {
		case errors.Is(err, planworker.ErrTimeout):
			return nil, &httpGraphqlError{message: "Query planning timed out", statusCode: http.StatusGatewayTimeout}
		case errors.Is(err, planworker.ErrQueueFull):
			return nil, &httpGraphqlError{message: "Too many operations are waiting to be planned", statusCode: http.StatusServiceUnavailable}
		}
		return nil, fmt.Errorf("failed to plan operation on a plan worker: %w", err)
	}

	if result.Status != planworker.StatusOK {
		// Failed plans are planned again by the router, so that errors are reported
		// exactly like they are without workers.
		return nil, r.planLocally(operationName, string(result.Status), result.Message)
	}

	preparedPlan, dataSources, err := decodePlan(result.Plan)
	if err != nil {
		r.logger.Error("Failed to decode the plan of a plan worker", zap.String("operation_name", operationName), zap.Error(err))
		return nil, r.planLocally(operationName, "undecodable", err.Error())
	}
	err = restorePlanDataSources(preparedPlan, dataSources, func(id string) (resolve.DataSource, bool) {
		ds, ok := r.dataSources[id]
		return ds, ok
	})
	if err != nil {
		// The worker considered the plan transferable, but we can't make it executable.
		// That points to a difference between router and worker that should not exist.
		r.logger.Warn("Failed to restore the data sources of a plan from a plan worker", zap.String("operation_name", operationName), zap.Error(err))
		return nil, r.planLocally(operationName, "unrestorable", err.Error())
	}

	operationDocument, report := astparser.ParseGraphqlDocumentString(result.OperationDocument)
	if report.HasErrors() {
		r.logger.Error("Failed to parse the operation planned by a plan worker", zap.String("operation_name", operationName), zap.Error(&report))
		return nil, r.planLocally(operationName, "unparsable", report.Error())
	}

	r.planned.Add(1)
	r.logger.Debug("Operation planned by a plan worker",
		zap.String("operation_name", operationName),
		zap.Duration("planning_duration", result.PlanningDuration),
		zap.Int("plan_size_bytes", len(result.Plan)),
	)

	return &planWithMetaData{
		preparedPlan:      preparedPlan,
		operationDocument: &operationDocument,
		schemaDocument:    r.executor.RouterSchema,
	}, nil
}

func (r *remotePlanner) planLocally(operationName, reason, message string) error {
	r.fallbacks.Add(1)
	r.logger.Debug("Operation is planned by the router instead of a plan worker",
		zap.String("operation_name", operationName),
		zap.String("reason", reason),
		zap.String("message", message),
	)
	return errPlanLocally
}

// subgraphFetchSource fetches from a GraphQL subgraph over HTTP. The router attaches it
// to the fetches of plans that were planned by a plan worker.
//
// It has to behave exactly like graphql_datasource.Source, the data source of plans the
// router plans itself. We can't use that type because the engine offers no way to create
// one outside of the planner, so its request preparation is replicated here.
// TestSubgraphFetchSourceMatchesEngine keeps the two in sync.
type subgraphFetchSource struct {
	httpClient *http.Client
}

func (s *subgraphFetchSource) Load(ctx context.Context, headers http.Header, input []byte) ([]byte, error) {
	input = s.compactAndUnNullVariables(input)
	return httpclient.Do(s.httpClient, ctx, headers, input)
}

func (s *subgraphFetchSource) LoadWithFiles(ctx context.Context, headers http.Header, input []byte, files []*httpclient.FileUpload) ([]byte, error) {
	input = s.compactAndUnNullVariables(input)
	return httpclient.DoMultipartForm(s.httpClient, ctx, headers, input, files)
}

func (s *subgraphFetchSource) compactAndUnNullVariables(input []byte) []byte {
	undefinedVariables := httpclient.UndefinedVariables(input)
	variables, _, _, err := jsonparser.Get(input, "body", "variables")
	if err != nil {
		return input
	}

	// if variables are null or empty object, do nothing
	if bytes.Equal(variables, []byte("null")) || bytes.Equal(variables, []byte("{}")) {
		return input
	}

	// remove null variables which actually was undefined in the original user request
	variables = s.cleanupVariables(variables, undefinedVariables)

	// compact
	if !bytes.ContainsAny(variables, " \t\n\r") {
		buf := bytes.NewBuffer(make([]byte, 0, len(variables)))
		if err := json.Compact(buf, variables); err != nil {
			return variables
		}
		variables = buf.Bytes()
	}

	input, _ = jsonparser.Set(input, variables, "body", "variables")
	return input
}

// cleanupVariables removes null variables which are listed in undefinedVariables
func (s *subgraphFetchSource) cleanupVariables(variables []byte, undefinedVariables []string) []byte {
	if len(undefinedVariables) == 0 {
		return variables
	}
	_ = jsonparser.ObjectEach(variables, func(key []byte, value []byte, dataType jsonparser.ValueType, offset int) error {
		if dataType == jsonparser.Null {
			stringKey := string(key)
			if slices.Contains(undefinedVariables, stringKey) {
				variables = jsonparser.Delete(variables, stringKey)
			}
		}
		return nil
	})
	return variables
}

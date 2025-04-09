package core

import (
	"context"
	"errors"
	"time"

	"go.uber.org/ratelimit"
	"go.uber.org/zap"
	"google.golang.org/protobuf/encoding/protojson"

	"github.com/wundergraph/astjson"

	"github.com/wundergraph/graphql-go-tools/v2/pkg/ast"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"

	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
	"github.com/wundergraph/cosmo/router/pkg/config"
)

type CacheWarmupItem struct {
	Request GraphQLRequest
	Client  *ClientInfo
}

type CacheWarmupSource interface {
	LoadItems(ctx context.Context, log *zap.Logger) ([]*nodev1.Operation, error)
}

type CacheWarmupProcessor interface {
	ProcessOperation(ctx context.Context, item *nodev1.Operation) (*CacheWarmupOperationPlanResult, error)
}

type CacheWarmupConfig struct {
	Log            *zap.Logger
	Source         CacheWarmupSource
	Workers        int
	ItemsPerSecond int
	Timeout        time.Duration
	Processor      CacheWarmupProcessor
	AfterOperation func(item *CacheWarmupOperationPlanResult)
}

func WarmupCaches(ctx context.Context, cfg *CacheWarmupConfig) (err error) {
	w := &cacheWarmup{
		log:            cfg.Log.With(zap.String("component", "cache_warmup")),
		source:         cfg.Source,
		workers:        cfg.Workers,
		itemsPerSecond: cfg.ItemsPerSecond,
		timeout:        cfg.Timeout,
		processor:      cfg.Processor,
		afterOperation: cfg.AfterOperation,
	}
	if cfg.Workers < 1 {
		w.workers = 4
	}
	if cfg.ItemsPerSecond < 1 {
		w.itemsPerSecond = 0
	}
	if cfg.Timeout <= 0 {
		w.timeout = time.Second * 30
	}
	w.log.Info("Warmup started",
		zap.Int("workers", cfg.Workers),
		zap.Int("items_per_second", cfg.ItemsPerSecond),
		zap.Duration("timeout", cfg.Timeout),
	)
	start := time.Now()
	completed, err := w.run(ctx)
	if err != nil {
		if errors.Is(err, context.DeadlineExceeded) {
			w.log.Error("Warmup timeout",
				zap.Error(err),
				zap.Int("processed_items", completed),
				zap.String("tip", "Consider to increase the timeout, increase the number of workers, increase the items per second limit, or reduce the number of items to process"),
			)
			return err
		}
		w.log.Error("Warmup error",
			zap.Error(err),
			zap.Int("processed_items", completed),
		)
		return err
	}
	w.log.Info("Warmup completed",
		zap.Int("processed_items", completed),
		zap.Duration("duration", time.Since(start)),
	)
	return nil
}

type cacheWarmup struct {
	log            *zap.Logger
	source         CacheWarmupSource
	workers        int
	itemsPerSecond int
	timeout        time.Duration
	processor      CacheWarmupProcessor
	afterOperation func(item *CacheWarmupOperationPlanResult)
}

func (w *cacheWarmup) run(ctx context.Context) (int, error) {

	ctx, cancel := context.WithTimeout(ctx, w.timeout)
	defer cancel()

	items, err := w.source.LoadItems(ctx, w.log)
	if err != nil {
		return 0, err
	}

	if len(items) == 0 {
		w.log.Debug("No items to process")
		return 0, nil
	}

	w.log.Info("Starting processing",
		zap.Int("items", len(items)),
	)

	defaultClientInfo := &nodev1.ClientInfo{}

	done := ctx.Done()
	index := make(chan int, len(items))
	defer close(index)
	itemCompleted := make(chan struct{})

	for i, item := range items {
		if item.Client == nil {
			item.Client = defaultClientInfo
		}
		index <- i
	}

	var (
		rl ratelimit.Limiter
	)

	if w.itemsPerSecond > 0 {
		rl = ratelimit.New(w.itemsPerSecond)
	} else {
		rl = ratelimit.NewUnlimited()
	}

	for i := 0; i < w.workers; i++ {
		go func(i int) {
			for {
				select {
				case <-done:
					return
				case idx, ok := <-index:
					if !ok {
						return
					}
					rl.Take()
					item := items[idx]

					res, err := w.processor.ProcessOperation(ctx, item)
					if err != nil {
						w.log.Warn("Failed to process operation, skipping",
							zap.Error(err),
							zap.String("client_name", item.Client.Name),
							zap.String("client_version", item.Client.Version),
							zap.String("query", item.Request.Query),
							zap.String("operation_name", item.Request.OperationName),
						)
					}

					if err == nil && w.afterOperation != nil {
						w.afterOperation(res)
					}

					select {
					case <-done:
						return
					case itemCompleted <- struct{}{}:
					}
				}
			}
		}(i)
	}

	for i := 0; i < len(items); i++ {
		processed := i + 1
		select {
		case <-done:
			return processed, ctx.Err()
		case <-itemCompleted:
			if processed%100 == 0 {
				w.log.Info("Processing completed",
					zap.Int("processed_items", processed),
				)
			}
		}
	}

	return len(items), nil
}

type CacheWarmupPlanningProcessorOptions struct {
	OperationProcessor        *OperationProcessor
	OperationPlanner          *OperationPlanner
	ComplexityLimits          *config.ComplexityLimits
	RouterSchema              *ast.Document
	TrackSchemaUsage          bool
	DisableVariablesRemapping bool
}

func NewCacheWarmupPlanningProcessor(options *CacheWarmupPlanningProcessorOptions) *CacheWarmupPlanningProcessor {
	return &CacheWarmupPlanningProcessor{
		operationProcessor:        options.OperationProcessor,
		operationPlanner:          options.OperationPlanner,
		complexityLimits:          options.ComplexityLimits,
		routerSchema:              options.RouterSchema,
		trackSchemaUsage:          options.TrackSchemaUsage,
		disableVariablesRemapping: options.DisableVariablesRemapping,
	}
}

type CacheWarmupOperationPlanResult struct {
	OperationHash string
	OperationName string
	OperationType string
	ClientName    string
	ClientVersion string
	PlanningTime  time.Duration
}

type CacheWarmupPlanningProcessor struct {
	operationProcessor        *OperationProcessor
	operationPlanner          *OperationPlanner
	complexityLimits          *config.ComplexityLimits
	routerSchema              *ast.Document
	trackSchemaUsage          bool
	disableVariablesRemapping bool
}

func (c *CacheWarmupPlanningProcessor) ProcessOperation(ctx context.Context, operation *nodev1.Operation) (*CacheWarmupOperationPlanResult, error) {

	var (
		isAPQ bool
	)

	k, err := c.operationProcessor.NewIndependentKit()
	if err != nil {
		return nil, err
	}

	var s []byte
	if operation.Request.GetExtensions() != nil {
		s, err = protojson.Marshal(operation.Request.GetExtensions())
		if err != nil {
			return nil, err
		}
	}

	item := &CacheWarmupItem{
		Request: GraphQLRequest{
			Query:         operation.Request.GetQuery(),
			OperationName: operation.Request.GetOperationName(),
			Extensions:    s,
		},
		Client: &ClientInfo{
			Name:    operation.GetClient().GetName(),
			Version: operation.GetClient().GetVersion(),
		},
	}

	k.parsedOperation.Request = item.Request

	err = k.unmarshalOperation()
	if err != nil {
		return nil, err
	}

	err = k.ComputeOperationSha256()
	if err != nil {
		return nil, err
	}

	if k.parsedOperation.IsPersistedOperation && k.parsedOperation.Request.Query == "" {
		_, isAPQ, err = k.FetchPersistedOperation(ctx, item.Client)
		if err != nil {
			return nil, err
		}
	}

	err = k.Parse()
	if err != nil {
		return nil, err
	}

	_, err = k.NormalizeOperation(item.Client.Name, isAPQ)
	if err != nil {
		return nil, err
	}

	_, err = k.NormalizeVariables()
	if err != nil {
		return nil, err
	}

	err = k.RemapVariables(c.disableVariablesRemapping)
	if err != nil {
		return nil, err
	}

	_, err = k.Validate(true, k.parsedOperation.RemapVariables, nil)
	if err != nil {
		return nil, err
	}

	if c.complexityLimits != nil {
		_, _, _ = k.ValidateQueryComplexity(c.complexityLimits, k.kit.doc, c.routerSchema, k.parsedOperation.IsPersistedOperation)
	}

	planOptions := PlanOptions{
		ClientInfo: item.Client,
		TraceOptions: resolve.TraceOptions{
			Enable: false,
		},
		ExecutionOptions: resolve.ExecutionOptions{
			SkipLoader:                 true,
			IncludeQueryPlanInResponse: false,
			SendHeartbeat:              false,
		},
		TrackSchemaUsageInfo: c.trackSchemaUsage,
	}

	opContext := &operationContext{
		clientInfo:   item.Client,
		name:         k.parsedOperation.Request.OperationName,
		opType:       k.parsedOperation.Type,
		hash:         k.parsedOperation.ID,
		content:      k.parsedOperation.NormalizedRepresentation,
		internalHash: k.parsedOperation.InternalID,
	}

	opContext.variables, err = astjson.ParseBytes(k.parsedOperation.Request.Variables)
	if err != nil {
		return nil, err
	}

	planningStart := time.Now()

	err = c.operationPlanner.plan(opContext, planOptions)
	if err != nil {
		return nil, err
	}

	return &CacheWarmupOperationPlanResult{
		OperationHash: k.parsedOperation.IDString(),
		OperationName: k.parsedOperation.Request.OperationName,
		OperationType: k.parsedOperation.Type,
		ClientName:    item.Client.Name,
		ClientVersion: item.Client.Version,
		PlanningTime:  time.Since(planningStart),
	}, nil
}

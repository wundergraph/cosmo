package core

import (
	"context"
	"errors"
	"time"

	"github.com/wundergraph/astjson"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/ast"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"
	"go.uber.org/ratelimit"
	"go.uber.org/zap"
)

type CacheWarmupItem struct {
	Request GraphQLRequest `json:"request"`
	Client  *ClientInfo    `json:"client"`
}

type CacheWarmupSource interface {
	LoadItems(ctx context.Context, log *zap.Logger) ([]*CacheWarmupItem, error)
}

type CacheWarmupProcessor interface {
	ProcessOperation(ctx context.Context, item *CacheWarmupItem) error
}

type CacheWarmupConfig struct {
	Log            *zap.Logger
	Source         CacheWarmupSource
	Workers        int
	ItemsPerSecond int
	Timeout        time.Duration
	Processor      CacheWarmupProcessor
}

func WarmupCaches(ctx context.Context, cfg *CacheWarmupConfig) (err error) {
	w := &cacheWarmup{
		log:            cfg.Log,
		source:         cfg.Source,
		workers:        cfg.Workers,
		itemsPerSecond: cfg.ItemsPerSecond,
		timeout:        cfg.Timeout,
		processor:      cfg.Processor,
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
	cfg.Log.Info("Cache warmup - start",
		zap.Int("workers", cfg.Workers),
		zap.Int("items_per_second", cfg.ItemsPerSecond),
		zap.Duration("timeout", cfg.Timeout),
	)
	start := time.Now()
	completed, err := w.run(ctx)
	if err != nil {
		if errors.Is(err, context.DeadlineExceeded) {
			cfg.Log.Error("Cache warmup - timeout",
				zap.Error(err),
				zap.Int("processed_items", completed),
				zap.String("tip", "Consider to increase the timeout, increase the number of workers, increase the items per second limit, or reduce the number of items to process"),
			)
			return err
		}
		cfg.Log.Error("Cache warmup - error",
			zap.Error(err),
			zap.Int("processed_items", completed),
		)
		return err
	}
	cfg.Log.Info("Cache warmup - completed",
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
}

func (w *cacheWarmup) run(ctx context.Context) (int, error) {

	ctx, cancel := context.WithTimeout(ctx, w.timeout)
	defer cancel()

	items, err := w.source.LoadItems(ctx, w.log)
	if err != nil {
		return 0, err
	}

	if len(items) == 0 {
		w.log.Info("Cache warmup - no items to process")
		return 0, nil
	}

	w.log.Info("Cache warmup - items loaded, starting processing",
		zap.Int("items", len(items)),
	)

	defaultClientInfo := &ClientInfo{}

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
					err := w.processor.ProcessOperation(ctx, item)
					if err != nil {
						w.log.Error("Failed to process operation, skipping",
							zap.Error(err),
							zap.String("client_name", item.Client.Name),
							zap.String("client_version", item.Client.Version),
							zap.String("query", item.Request.Query),
							zap.String("operation_name", item.Request.OperationName),
						)
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
				w.log.Info("Cache warmup - processed items",
					zap.Int("processed_items", processed),
				)
			}
		}
	}

	return len(items), nil
}

type CacheWarmupPlanningProcessorOptions struct {
	OperationProcessor *OperationProcessor
	OperationPlanner   *OperationPlanner
	ComplexityLimits   *config.ComplexityLimits
	RouterSchema       *ast.Document
	TrackSchemaUsage   bool
}

func NewCacheWarmupPlanningProcessor(options *CacheWarmupPlanningProcessorOptions) *CacheWarmupPlanningProcessor {
	return &CacheWarmupPlanningProcessor{
		operationProcessor: options.OperationProcessor,
		operationPlanner:   options.OperationPlanner,
		complexityLimits:   options.ComplexityLimits,
		routerSchema:       options.RouterSchema,
		trackSchemaUsage:   options.TrackSchemaUsage,
	}
}

type CacheWarmupPlanningProcessor struct {
	operationProcessor *OperationProcessor
	operationPlanner   *OperationPlanner
	complexityLimits   *config.ComplexityLimits
	routerSchema       *ast.Document
	trackSchemaUsage   bool
}

func (c *CacheWarmupPlanningProcessor) ProcessOperation(ctx context.Context, item *CacheWarmupItem) error {

	var (
		isAPQ bool
	)

	k, err := c.operationProcessor.NewIndependentKit()
	if err != nil {
		return err
	}

	k.parsedOperation.Request = item.Request

	err = k.unmarshalOperation()
	if err != nil {
		return err
	}

	err = k.ComputeOperationSha256()
	if err != nil {
		return err
	}

	if k.parsedOperation.IsPersistedOperation {
		_, isAPQ, err = k.FetchPersistedOperation(ctx, item.Client)
		if err != nil {
			return err
		}
	}

	err = k.Parse()
	if err != nil {
		return err
	}

	_, err = k.NormalizeOperation(item.Client.Name, isAPQ)
	if err != nil {
		return err
	}

	err = k.NormalizeVariables()
	if err != nil {
		return err
	}

	_, err = k.Validate(true)
	if err != nil {
		return err
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
		return err
	}

	err = c.operationPlanner.plan(opContext, planOptions)
	if err != nil {
		return err
	}

	return nil
}

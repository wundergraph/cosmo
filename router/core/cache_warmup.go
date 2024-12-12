package core

import (
	"context"
	"sync"
	"time"

	"github.com/wundergraph/astjson"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/ast"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"
	"go.uber.org/zap"
)

type CacheWarmupItem struct {
	Request GraphQLRequest `json:"request"`
	Client  *ClientInfo    `json:"client"`
}

type CacheWarmupSource interface {
	LoadItems(ctx context.Context, log *zap.Logger) ([]*CacheWarmupItem, error)
}

type CacheWarmupConfig struct {
	Log                *zap.Logger
	OperationProcessor *OperationProcessor
	OperationPlanner   *OperationPlanner
	ComplexityLimits   *config.ComplexityLimits
	RouterSchema       *ast.Document
	Source             CacheWarmupSource
	Workers            int
	Throttle           time.Duration
}

func WarmupCaches(ctx context.Context, cfg *CacheWarmupConfig) error {
	w := &cacheWarmup{
		log:                cfg.Log,
		operationProcessor: cfg.OperationProcessor,
		operationPlanner:   cfg.OperationPlanner,
		complexityLimits:   cfg.ComplexityLimits,
		routerSchema:       cfg.RouterSchema,
		source:             cfg.Source,
		workers:            cfg.Workers,
		throttle:           cfg.Throttle,
	}
	if cfg.Workers < 1 {
		cfg.Workers = 1
	}
	return w.run(ctx)
}

type cacheWarmup struct {
	log                *zap.Logger
	operationProcessor *OperationProcessor
	operationPlanner   *OperationPlanner
	complexityLimits   *config.ComplexityLimits
	routerSchema       *ast.Document
	source             CacheWarmupSource
	workers            int
	throttle           time.Duration
}

func (w *cacheWarmup) run(ctx context.Context) error {

	items, err := w.source.LoadItems(ctx, w.log)
	if err != nil {
		return err
	}

	defaultClientInfo := &ClientInfo{
		Name:           "",
		Version:        "",
		WGRequestToken: "",
	}

	for _, item := range items {
		if item.Client == nil {
			item.Client = defaultClientInfo
		}
	}

	// split operations into chunks for workers
	chunkSize := len(items) / w.workers
	chunks := make([][]*CacheWarmupItem, 0, w.workers)
	for i := 0; i < len(items); i += chunkSize {
		end := i + chunkSize
		if end > len(items) {
			end = len(items)
		}
		chunks = append(chunks, items[i:end])
	}

	sg := &sync.WaitGroup{}
	sg.Add(w.workers)
	for i := 0; i < w.workers; i++ {
		go func(i int) {
			defer sg.Done()
			for _, item := range chunks[i] {
				err := w.processOperation(ctx, item)
				if err != nil {
					w.log.Error("cache warmup process operation failed, skipping",
						zap.Error(err),
						zap.String("clientName", item.Client.Name),
						zap.String("clientVersion", item.Client.Version),
						zap.String("query", item.Request.Query),
						zap.String("operationName", item.Request.OperationName),
					)
				}
				if w.throttle > 0 {
					time.Sleep(w.throttle)
				}
				if ctx.Err() != nil {
					return
				}
			}
		}(i)
	}

	return nil
}

func (w *cacheWarmup) processOperation(ctx context.Context, item *CacheWarmupItem) error {

	var (
		isAPQ bool
	)

	k, err := w.operationProcessor.NewKit()
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

	if w.complexityLimits != nil {
		_, _, _ = k.ValidateQueryComplexity(w.complexityLimits, k.kit.doc, w.routerSchema, k.parsedOperation.IsPersistedOperation)
	}

	planOptions := PlanOptions{
		Protocol:   OperationProtocolHTTP,
		ClientInfo: item.Client,
		TraceOptions: resolve.TraceOptions{
			Enable: false,
		},
		ExecutionOptions: resolve.ExecutionOptions{
			SkipLoader:                 true,
			IncludeQueryPlanInResponse: false,
			SendHeartbeat:              false,
		},
		TrackSchemaUsageInfo: true,
	}

	opContext := &operationContext{
		clientInfo: item.Client,
		name:       k.parsedOperation.Request.OperationName,
		opType:     k.parsedOperation.Type,
		hash:       k.parsedOperation.ID,
		content:    k.parsedOperation.NormalizedRepresentation,
	}

	opContext.variables, err = astjson.ParseBytes(k.parsedOperation.Request.Variables)
	if err != nil {
		return err
	}

	err = w.operationPlanner.plan(opContext, planOptions)
	if err != nil {
		return err
	}

	return nil
}

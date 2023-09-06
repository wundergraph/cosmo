package pool

import (
	"bytes"
	"context"
	"hash"
	"net/http"
	"sync"

	"github.com/cespare/xxhash/v2"

	"github.com/wundergraph/graphql-go-tools/v2/pkg/ast"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/astnormalization"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/astparser"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/astprinter"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/astvalidation"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/plan"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/postprocess"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/operationreport"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/pool"
)

func GetBytesBuffer() *bytes.Buffer {
	buf := pool.BytesBuffer.Get()
	buf.Reset()
	return buf
}

func PutBytesBuffer(buf *bytes.Buffer) {
	pool.BytesBuffer.Put(buf)
}

type Config struct {
	RenameTypeNames []resolve.RenameTypeName
}

type Pool struct {
	pool sync.Pool
}

func New() *Pool {
	return &Pool{}
}

type Shared struct {
	Doc         *ast.Document
	Planner     *plan.Planner
	Parser      *astparser.Parser
	Printer     *astprinter.Printer
	Hash        hash.Hash64
	Validation  *astvalidation.OperationValidator
	Normalizer  *astnormalization.OperationNormalizer
	Postprocess postprocess.PostProcessor
	Report      *operationreport.Report
	Ctx         *resolve.Context
}

func (s *Shared) Reset() {
	s.Doc.Reset()
	s.Hash.Reset()
	s.Report.Reset()
	s.Ctx.Free()
}

func (p *Pool) GetShared(ctx context.Context, planConfig plan.Configuration, cfg Config) *Shared {
	shared := p.pool.Get()
	if shared != nil {
		s := shared.(*Shared)
		s.Planner.SetConfig(planConfig)
		s.Ctx = s.Ctx.WithContext(ctx)
		s.Ctx.RenameTypeNames = cfg.RenameTypeNames
		return s
	}
	resolveCtx := resolve.NewContext(ctx)
	resolveCtx.RenameTypeNames = cfg.RenameTypeNames
	return &Shared{
		Doc:         ast.NewDocument(),
		Planner:     plan.NewPlanner(ctx, planConfig),
		Parser:      astparser.NewParser(),
		Printer:     &astprinter.Printer{},
		Hash:        xxhash.New(),
		Validation:  astvalidation.DefaultOperationValidator(),
		Normalizer:  astnormalization.NewNormalizer(true, true),
		Postprocess: postprocess.DefaultProcessor(),
		Report:      &operationreport.Report{},
		Ctx:         resolveCtx,
	}
}

func (p *Pool) GetSharedFromRequest(clientRequest *http.Request, planConfig plan.Configuration, cfg Config) *Shared {
	ctx := clientRequest.Context()
	shared := p.pool.Get()
	if shared != nil {
		s := shared.(*Shared)
		s.Planner.SetConfig(planConfig)
		s.Ctx.Request.Header = clientRequest.Header
		s.Ctx.RenameTypeNames = cfg.RenameTypeNames
		return s
	}
	resolveCtx := resolve.NewContext(ctx)
	resolveCtx.Request.Header = clientRequest.Header
	resolveCtx.RenameTypeNames = cfg.RenameTypeNames
	return &Shared{
		Doc:         ast.NewDocument(),
		Planner:     plan.NewPlanner(ctx, planConfig),
		Parser:      astparser.NewParser(),
		Printer:     &astprinter.Printer{},
		Hash:        xxhash.New(),
		Validation:  astvalidation.DefaultOperationValidator(),
		Normalizer:  astnormalization.NewNormalizer(true, true),
		Postprocess: postprocess.DefaultProcessor(),
		Report:      &operationreport.Report{},
		Ctx:         resolveCtx,
	}
}

func (p *Pool) PutShared(shared *Shared) {
	shared.Reset()
	p.pool.Put(shared)
}

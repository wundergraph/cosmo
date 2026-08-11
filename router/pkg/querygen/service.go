package querygen

import (
	"context"
	"encoding/json"
	"errors"

	"connectrpc.com/connect"

	yokov1 "github.com/wundergraph/cosmo/router/gen/proto/yoko/v1"
)

// Symbol is one schema element.
//
// The service returns the full record as a JSON encoded string. This package
// decodes it, so a caller never parses a string inside a string.
type Symbol struct {
	Coordinate string          `json:"coordinate"`
	Score      float64         `json:"score,omitempty"`
	Record     json.RawMessage `json:"record,omitempty"`
}

// SearchResult holds the ranked hits of a schema search.
type SearchResult struct {
	Hits []Symbol `json:"hits"`
}

// SymbolsResult holds the full records for the requested coordinates.
type SymbolsResult struct {
	Symbols []Symbol `json:"symbols"`
}

// GeneratedQuery is one operation that the service built and validated against
// the schema.
type GeneratedQuery struct {
	Description   string `json:"description,omitempty"`
	Document      string `json:"document"`
	OperationName string `json:"operationName"`
	OperationType string `json:"operationType"`
	// VariablesSchema is a JSON Schema for the variables of the operation.
	VariablesSchema json.RawMessage `json:"variablesSchema,omitempty"`
}

// GenerateResult holds the outcome of a prompt.
//
// A result with no queries and one unsatisfied reason is correct. It means that
// the schema cannot answer the request.
type GenerateResult struct {
	Queries     []GeneratedQuery `json:"queries"`
	Unsatisfied []string         `json:"unsatisfied,omitempty"`
	Truncated   bool             `json:"truncated,omitempty"`
	Guidance    *Guidance        `json:"guidance,omitempty"`
}

// Guidance tells the caller what to do with a generated operation.
type Guidance struct {
	Endpoint  string   `json:"endpoint"`
	NextSteps []string `json:"nextSteps"`
}

// SearchInput holds the arguments of a schema search.
type SearchInput struct {
	Query     string   `json:"query"`
	Kinds     []string `json:"kinds,omitempty"`
	Limit     int32    `json:"limit,omitempty"`
	Parent    string   `json:"parent,omitempty"`
	Paginated *bool    `json:"paginated,omitempty"`
}

// Service is the tool facing API of this package.
type Service struct {
	indexer *Indexer
	// graphqlEndpoint is the router endpoint that runs a generated operation.
	graphqlEndpoint string
}

// NewService builds the tool facing API. The caller must call Validate on the
// config first.
func NewService(cfg Config, graphqlEndpoint string) *Service {
	return &Service{
		indexer:         NewIndexer(cfg),
		graphqlEndpoint: graphqlEndpoint,
	}
}

// Sync makes the discovery service hold an index for this schema. It never
// blocks on the network.
func (s *Service) Sync(ctx context.Context, sdl string) {
	s.indexer.Sync(ctx, sdl)
}

// SearchSchema ranks schema elements against a query.
func (s *Service) SearchSchema(ctx context.Context, in SearchInput) (*SearchResult, error) {
	address, err := s.indexer.CurrentAddress()
	if err != nil {
		return nil, err
	}

	req := &yokov1.SearchSchemaRequest{
		IndexId:   address,
		Query:     in.Query,
		Limit:     in.Limit,
		Kinds:     in.Kinds,
		Parent:    in.Parent,
		Paginated: in.Paginated,
	}

	res, err := s.indexer.client.SearchSchema(ctx, connect.NewRequest(req))
	if err != nil {
		return nil, s.handle(err)
	}

	return &SearchResult{Hits: toSymbols(res.Msg.GetHits())}, nil
}

// GetSymbols reads the full record for each coordinate.
//
// The response omits a coordinate that the index does not hold. A short
// response is not an error.
func (s *Service) GetSymbols(ctx context.Context, coordinates []string) (*SymbolsResult, error) {
	address, err := s.indexer.CurrentAddress()
	if err != nil {
		return nil, err
	}

	req := &yokov1.GetSymbolsRequest{IndexId: address, Coordinates: coordinates}

	res, err := s.indexer.client.GetSymbols(ctx, connect.NewRequest(req))
	if err != nil {
		return nil, s.handle(err)
	}

	return &SymbolsResult{Symbols: toSymbols(res.Msg.GetSymbols())}, nil
}

// GenerateQuery turns a prompt into one or more validated operations.
func (s *Service) GenerateQuery(ctx context.Context, prompt string) (*GenerateResult, error) {
	address, err := s.indexer.CurrentAddress()
	if err != nil {
		return nil, err
	}

	req := &yokov1.GenerateQueryRequest{IndexId: address, Prompt: prompt}

	res, err := s.indexer.client.GenerateQuery(ctx, connect.NewRequest(req))
	if err != nil {
		return nil, s.handle(err)
	}

	resolution := res.Msg.GetResolution()

	out := &GenerateResult{
		Queries:   make([]GeneratedQuery, 0, len(resolution.GetQueries())),
		Truncated: resolution.GetTruncated(),
	}

	for _, q := range resolution.GetQueries() {
		out.Queries = append(out.Queries, GeneratedQuery{
			Description:     q.GetDescription(),
			Document:        q.GetDocument(),
			OperationName:   q.GetOperationName(),
			OperationType:   q.GetOperationType(),
			VariablesSchema: decodeJSON(q.GetVariablesSchema()),
		})
	}

	for _, u := range resolution.GetUnsatisfied() {
		out.Unsatisfied = append(out.Unsatisfied, u.GetReason())
	}

	if len(out.Queries) > 0 {
		out.Guidance = &Guidance{
			Endpoint: s.graphqlEndpoint,
			NextSteps: []string{
				"Run the operation against the endpoint. Send the document as \"query\" and the values as \"variables\".",
				"Read variablesSchema to find the name, the type, and the allowed values of each variable.",
				"Or save the document as a persisted operation. Deploy it to expose the operation as its own tool.",
			},
		}
	}

	return out, nil
}

// toSymbols converts service hits and decodes the JSON encoded record of each
// one.
func toSymbols(hits []*yokov1.SymbolHit) []Symbol {
	out := make([]Symbol, 0, len(hits))
	for _, h := range hits {
		out = append(out, Symbol{
			Coordinate: h.GetCoordinate(),
			Score:      h.GetScore(),
			Record:     decodeJSON(h.GetPayload()),
		})
	}
	return out
}

// decodeJSON turns a JSON encoded string into raw JSON.
//
// It returns nil when the string is empty. It returns the string as a JSON
// string when the content does not parse, so a caller still sees the value.
func decodeJSON(s string) json.RawMessage {
	if s == "" {
		return nil
	}
	if json.Valid([]byte(s)) {
		return json.RawMessage(s)
	}
	quoted, err := json.Marshal(s)
	if err != nil {
		return nil
	}
	return quoted
}

// handle maps a service error to an error that a caller can act on.
//
// A not_found means that the index expired. The service deletes an index that
// nothing uses for 30 days. The indexer rebuilds it at the same address.
func (s *Service) handle(err error) error {
	var connectErr *connect.Error
	if !errors.As(err, &connectErr) {
		return err
	}

	if connectErr.Code() == connect.CodeNotFound {
		s.indexer.Resync()
	}

	return err
}

// UserMessage turns an error into text for a tool caller.
//
// The text tells the caller whether to retry, and never names the token or any
// other secret.
func UserMessage(err error) string {
	if errors.Is(err, ErrIndexNotReady) {
		return "The schema index is still building. Retry in a few seconds."
	}

	var connectErr *connect.Error
	if !errors.As(err, &connectErr) {
		return "The schema discovery service is unreachable. " + err.Error()
	}

	switch connectErr.Code() {
	case connect.CodeNotFound:
		return "The schema index expired. It is being rebuilt. Retry in a few seconds."
	case connect.CodeFailedPrecondition:
		return "The schema index is not ready. Retry in a few seconds."
	case connect.CodeUnauthenticated, connect.CodePermissionDenied:
		return "Schema discovery is not configured correctly. Contact the router operator."
	case connect.CodeInvalidArgument:
		return "The request is not valid. " + connectErr.Message()
	default:
		return "The schema discovery service returned an error. " + connectErr.Message()
	}
}

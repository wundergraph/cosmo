package entity_splitter

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"sync"
	"sync/atomic"

	"github.com/wundergraph/astjson"
	"github.com/wundergraph/cosmo/router/core"
	"github.com/wundergraph/go-arena"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/propagation"
	"go.uber.org/zap"
)

const moduleID = "entitySplitter"

// Hop-by-hop headers that must not be forwarded when we relay the request.
// Content-Type and Content-Length are re-set per sub-request.
var hopByHopHeaders = map[string]struct{}{
	"Connection":          {},
	"Keep-Alive":          {},
	"Proxy-Authenticate":  {},
	"Proxy-Authorization": {},
	"Te":                  {},
	"Trailer":             {},
	"Transfer-Encoding":   {},
	"Upgrade":             {},
	"Content-Length":      {},
	"Content-Type":        {},
}

// EntitySplitterModule intercepts subgraph `_entities` fetches that exceed
// SplitThreshold bytes and splits them into BatchSize-sized chunks that are
// fetched concurrently, then merged back into a single synthetic response.
type EntitySplitterModule struct {
	BatchSize      int `mapstructure:"batch_size"`
	SplitThreshold int `mapstructure:"split_threshold"`

	Client *http.Client `mapstructure:"-"`
	Logger *zap.Logger  `mapstructure:"-"`

	SubFetchCount     atomic.Int64 `mapstructure:"-"`
	SplitRequestCount atomic.Int64 `mapstructure:"-"`
}

var (
	parserPool = &sync.Pool{New: func() any { return &astjson.Parser{} }}
	arenaPool  = arena.NewArenaPool()
)

func (m *EntitySplitterModule) Provision(ctx *core.ModuleContext) error {
	if m.BatchSize <= 0 {
		m.BatchSize = 10
	}
	if m.SplitThreshold <= 0 {
		m.SplitThreshold = 2048
	}
	if m.Client == nil {
		m.Client = http.DefaultClient
	}
	m.Logger = ctx.Logger
	return nil
}

func (m *EntitySplitterModule) Module() core.ModuleInfo {
	return core.ModuleInfo{
		ID:       moduleID,
		Priority: 1,
		New: func() core.Module {
			return m
		},
	}
}

// parsedRequest holds the per-chunk-independent pieces extracted from the
// original subgraph request body. All byte slices are heap-allocated (copied
// out of the arena) so they outlive the arena's Release.
type parsedRequest struct {
	queryRaw         []byte // JSON-encoded string value (including quotes)
	operationNameRaw []byte // JSON-encoded string value, or nil
	extensionsRaw    []byte // raw JSON value, or nil
	otherVarsPrefix  []byte // "k":<v>, ... ready to prepend inside the variables object, or empty
	representations  [][]byte
}

func parseSubgraphBody(body []byte) (*parsedRequest, error) {
	parser := parserPool.Get().(*astjson.Parser)
	item := arenaPool.Acquire(0)
	defer func() {
		arenaPool.Release(item) // Release also calls Arena.Reset()
		parserPool.Put(parser)
	}()

	root, err := parser.ParseBytesWithArena(item.Arena, body)
	if err != nil {
		return nil, fmt.Errorf("parse body: %w", err)
	}
	variables := root.Get("variables")
	if variables == nil {
		return nil, fmt.Errorf("no variables")
	}
	repsVal := variables.Get("representations")
	if repsVal == nil {
		return nil, fmt.Errorf("no representations")
	}
	repsArr, err := repsVal.Array()
	if err != nil {
		return nil, fmt.Errorf("representations not an array: %w", err)
	}

	pr := &parsedRequest{
		representations: make([][]byte, len(repsArr)),
	}
	for i, r := range repsArr {
		pr.representations[i] = append([]byte(nil), r.MarshalTo(nil)...)
	}
	if q := root.Get("query"); q != nil {
		pr.queryRaw = append([]byte(nil), q.MarshalTo(nil)...)
	}
	if op := root.Get("operationName"); op != nil {
		pr.operationNameRaw = append([]byte(nil), op.MarshalTo(nil)...)
	}
	if ext := root.Get("extensions"); ext != nil {
		pr.extensionsRaw = append([]byte(nil), ext.MarshalTo(nil)...)
	}

	varsObj, err := variables.Object()
	if err != nil {
		return nil, fmt.Errorf("variables not an object: %w", err)
	}
	var prefix bytes.Buffer
	varsObj.Visit(func(key []byte, v *astjson.Value) {
		if bytes.Equal(key, []byte("representations")) {
			return
		}
		prefix.WriteByte('"')
		prefix.Write(key)
		prefix.WriteString(`":`)
		prefix.Write(v.MarshalTo(nil))
		prefix.WriteByte(',')
	})
	pr.otherVarsPrefix = append([]byte(nil), prefix.Bytes()...)

	return pr, nil
}

// buildChunkBody constructs a sub-request body using pre-extracted raw pieces
// from parsedRequest plus the chunk of representations.
func buildChunkBody(pr *parsedRequest, chunk [][]byte) []byte {
	var buf bytes.Buffer
	buf.Grow(len(pr.queryRaw) + len(pr.operationNameRaw) + len(pr.otherVarsPrefix) + 64 + repsChunkSize(chunk))
	buf.WriteByte('{')
	if len(pr.queryRaw) > 0 {
		buf.WriteString(`"query":`)
		buf.Write(pr.queryRaw)
		buf.WriteByte(',')
	}
	if len(pr.operationNameRaw) > 0 {
		buf.WriteString(`"operationName":`)
		buf.Write(pr.operationNameRaw)
		buf.WriteByte(',')
	}
	buf.WriteString(`"variables":{`)
	buf.Write(pr.otherVarsPrefix)
	buf.WriteString(`"representations":[`)
	for i, rep := range chunk {
		if i > 0 {
			buf.WriteByte(',')
		}
		buf.Write(rep)
	}
	buf.WriteString(`]}`)
	if len(pr.extensionsRaw) > 0 {
		buf.WriteString(`,"extensions":`)
		buf.Write(pr.extensionsRaw)
	}
	buf.WriteByte('}')
	return buf.Bytes()
}

func repsChunkSize(chunk [][]byte) int {
	n := len(chunk) + 2
	for _, r := range chunk {
		n += len(r)
	}
	return n
}

func (m *EntitySplitterModule) OnOriginRequest(req *http.Request, ctx core.RequestContext) (*http.Request, *http.Response) {
	if req.Body == nil || req.Method != http.MethodPost {
		return req, nil
	}

	bodyBytes, err := io.ReadAll(req.Body)
	_ = req.Body.Close()
	if err != nil {
		return req, nil
	}
	req.Body = io.NopCloser(bytes.NewReader(bodyBytes))

	// Size-based threshold: cheapest possible filter first.
	if len(bodyBytes) <= m.SplitThreshold {
		return req, nil
	}
	// Second cheap filter before parsing.
	if !bytes.Contains(bodyBytes, []byte("_entities")) {
		return req, nil
	}

	pr, err := parseSubgraphBody(bodyBytes)
	if err != nil || len(pr.representations) < 2 {
		return req, nil
	}

	resp := m.fanOut(req, pr)
	m.SplitRequestCount.Add(1)
	return nil, resp
}

// chunkResult captures a single sub-fetch's outcome along with the absolute
// index of the first representation in that chunk. Used for order-preserving
// merging and error-path reindexing.
type chunkResult struct {
	absStart int
	chunkLen int
	entities []json.RawMessage
	errors   []json.RawMessage
	fetchErr error
}

func (m *EntitySplitterModule) fanOut(req *http.Request, pr *parsedRequest) *http.Response {
	chunks := chunkRepresentations(pr.representations, m.BatchSize)
	results := make([]chunkResult, len(chunks))

	var wg sync.WaitGroup
	wg.Add(len(chunks))
	absStart := 0
	for i, chunk := range chunks {
		results[i].absStart = absStart
		results[i].chunkLen = len(chunk)
		absStart += len(chunk)
		go func(idx int, chunkReps [][]byte) {
			defer wg.Done()
			m.SubFetchCount.Add(1)
			m.runSubFetch(req, pr, chunkReps, &results[idx])
		}(i, chunk)
	}
	wg.Wait()

	return m.mergeResults(req, len(pr.representations), results)
}

func chunkRepresentations(reps [][]byte, batchSize int) [][][]byte {
	if batchSize <= 0 {
		batchSize = len(reps)
	}
	chunks := make([][][]byte, 0, (len(reps)+batchSize-1)/batchSize)
	for start := 0; start < len(reps); start += batchSize {
		end := min(start+batchSize, len(reps))
		chunks = append(chunks, reps[start:end])
	}
	return chunks
}

func (m *EntitySplitterModule) runSubFetch(origReq *http.Request, pr *parsedRequest, chunk [][]byte, out *chunkResult) {
	subBody := buildChunkBody(pr, chunk)
	subReq, err := http.NewRequestWithContext(origReq.Context(), http.MethodPost, origReq.URL.String(), bytes.NewReader(subBody))
	if err != nil {
		out.fetchErr = fmt.Errorf("build sub-request: %w", err)
		return
	}
	copyForwardableHeaders(origReq.Header, subReq.Header)
	subReq.Header.Set("Content-Type", "application/json")
	subReq.Header.Set("Accept", "application/json")
	subReq.ContentLength = int64(len(subBody))
	otel.GetTextMapPropagator().Inject(origReq.Context(), propagation.HeaderCarrier(subReq.Header))

	resp, err := m.Client.Do(subReq)
	if err != nil {
		out.fetchErr = fmt.Errorf("sub-fetch: %w", err)
		return
	}
	defer resp.Body.Close()

	bodyBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		out.fetchErr = fmt.Errorf("read sub-response: %w", err)
		return
	}
	if resp.StatusCode != http.StatusOK {
		out.fetchErr = fmt.Errorf("sub-fetch returned status %d", resp.StatusCode)
		return
	}

	var parsed struct {
		Data *struct {
			Entities []json.RawMessage `json:"_entities"`
		} `json:"data,omitempty"`
		Errors []json.RawMessage `json:"errors,omitempty"`
	}
	if err := json.Unmarshal(bodyBytes, &parsed); err != nil {
		out.fetchErr = fmt.Errorf("parse sub-response: %w", err)
		return
	}
	if parsed.Data != nil {
		out.entities = parsed.Data.Entities
	}
	out.errors = parsed.Errors
}

func copyForwardableHeaders(src, dst http.Header) {
	for k, vs := range src {
		if _, skip := hopByHopHeaders[http.CanonicalHeaderKey(k)]; skip {
			continue
		}
		for _, v := range vs {
			dst.Add(k, v)
		}
	}
}

// mergeResults assembles a single GraphQL response whose `_entities` array has
// exactly totalReps slots, ordered by the original representation index.
// Failed chunks are filled with nulls and surfaced as GraphQL errors with
// `path: ["_entities", <absIdx>]`. Errors returned inside successful sub-responses
// are reindexed from chunk-local to absolute positions.
func (m *EntitySplitterModule) mergeResults(req *http.Request, totalReps int, results []chunkResult) *http.Response {
	mergedEntities := make([]json.RawMessage, totalReps)
	var mergedErrors []json.RawMessage

	nullRaw := json.RawMessage("null")
	for _, r := range results {
		if r.fetchErr != nil {
			for i := 0; i < r.chunkLen; i++ {
				mergedEntities[r.absStart+i] = nullRaw
				mergedErrors = append(mergedErrors, buildPathError(r.fetchErr.Error(), r.absStart+i))
			}
			if m.Logger != nil {
				m.Logger.Warn("entity splitter sub-fetch failed",
					zap.Int("chunk_start", r.absStart),
					zap.Int("chunk_len", r.chunkLen),
					zap.Error(r.fetchErr))
			}
			continue
		}
		// Copy entities in order; defensively null-fill missing trailing slots.
		for i := 0; i < r.chunkLen; i++ {
			if i < len(r.entities) {
				mergedEntities[r.absStart+i] = r.entities[i]
			} else {
				mergedEntities[r.absStart+i] = nullRaw
				mergedErrors = append(mergedErrors, buildPathError("missing entity in sub-response", r.absStart+i))
			}
		}
		for _, e := range r.errors {
			mergedErrors = append(mergedErrors, reindexErrorPath(e, r.absStart))
		}
	}

	out := struct {
		Data struct {
			Entities []json.RawMessage `json:"_entities"`
		} `json:"data"`
		Errors []json.RawMessage `json:"errors,omitempty"`
	}{}
	out.Data.Entities = mergedEntities
	out.Errors = mergedErrors

	body, err := json.Marshal(out)
	if err != nil {
		return errorResponse(req, fmt.Errorf("marshal merged: %w", err))
	}
	return buildJSONResponse(req, body)
}

// reindexErrorPath rewrites path[1] if the error has a path starting with
// `["_entities", <localIdx>]`, shifting local index to absolute index.
func reindexErrorPath(errRaw json.RawMessage, absStart int) json.RawMessage {
	var obj map[string]json.RawMessage
	if err := json.Unmarshal(errRaw, &obj); err != nil {
		return errRaw
	}
	pathRaw, ok := obj["path"]
	if !ok {
		return errRaw
	}
	var path []json.RawMessage
	if err := json.Unmarshal(pathRaw, &path); err != nil || len(path) < 2 {
		return errRaw
	}
	if !bytes.Equal(bytes.TrimSpace(path[0]), []byte(`"_entities"`)) {
		return errRaw
	}
	var localIdx int
	if err := json.Unmarshal(path[1], &localIdx); err != nil {
		return errRaw
	}
	absIdx, err := json.Marshal(absStart + localIdx)
	if err != nil {
		return errRaw
	}
	path[1] = absIdx
	newPath, err := json.Marshal(path)
	if err != nil {
		return errRaw
	}
	obj["path"] = newPath
	out, err := json.Marshal(obj)
	if err != nil {
		return errRaw
	}
	return out
}

func buildPathError(message string, absIdx int) json.RawMessage {
	e := map[string]any{
		"message": message,
		"path":    []any{"_entities", absIdx},
	}
	b, _ := json.Marshal(e)
	return b
}

func buildJSONResponse(req *http.Request, body []byte) *http.Response {
	return &http.Response{
		StatusCode:    http.StatusOK,
		Status:        http.StatusText(http.StatusOK),
		Proto:         "HTTP/1.1",
		ProtoMajor:    1,
		ProtoMinor:    1,
		Request:       req,
		Body:          io.NopCloser(bytes.NewReader(body)),
		ContentLength: int64(len(body)),
		Header: http.Header{
			"Content-Type":   []string{"application/json"},
			"Content-Length": []string{strconv.Itoa(len(body))},
		},
	}
}

func errorResponse(req *http.Request, err error) *http.Response {
	payload := map[string]any{
		"errors": []map[string]any{{"message": "entity splitter: " + err.Error()}},
	}
	body, _ := json.Marshal(payload)
	return buildJSONResponse(req, body)
}

var (
	_ core.EnginePreOriginHandler = (*EntitySplitterModule)(nil)
	_ core.Provisioner            = (*EntitySplitterModule)(nil)
)

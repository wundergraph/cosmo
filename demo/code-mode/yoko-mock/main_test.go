package main

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"testing"
	"time"

	"connectrpc.com/connect"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	yokov1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/code_mode/yoko/v1"
	"github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/code_mode/yoko/v1/yokov1connect"
	"google.golang.org/protobuf/proto"
)

const testSDL = `type Query { viewer: User } type User { id: ID! }`

func TestIndexSchemaThenGenerateQueryReturnsResolvedQuery(t *testing.T) {
	writeFakeCodex(t,
		`{"type":"thread.started","thread_id":"fake-thread"}`,
		`{"queries":[{"description":"Fetches the current viewer.","document":"query getViewer { viewer { id } }","operation_name":"getViewer","operation_type":"query"}],"unsatisfied":[],"truncated":false}`,
	)
	client := newTestClient(t)

	indexResp, err := client.IndexSchema(context.Background(), connect.NewRequest(&yokov1.IndexSchemaRequest{
		Sdl: testSDL,
	}))
	require.NoError(t, err)

	resp, err := client.GenerateQuery(context.Background(), connect.NewRequest(&yokov1.GenerateQueryRequest{
		SchemaId: indexResp.Msg.GetSchemaId(),
		Prompt:   "get the viewer",
	}))
	require.NoError(t, err)

	expected := &yokov1.GenerateQueryResponse{
		Resolution: &yokov1.Resolution{
			Queries: []*yokov1.ResolvedQuery{{
				Description:     "Fetches the current viewer.",
				Document:        "query getViewer { viewer { id } }",
				OperationName:   "getViewer",
				OperationType:   "query",
				VariablesSchema: `{"type":"object","properties":{}}`,
			}},
		},
	}
	assert.Equal(t, normalizeGenerateResponse(t, expected), normalizeGenerateResponse(t, resp.Msg))
}

func TestGenerateQueryDerivesVariablesSchemaFromOperation(t *testing.T) {
	writeFakeCodex(t,
		`{"type":"thread.started","thread_id":"fake-thread"}`,
		`{"queries":[{"description":"Fetch viewer by id.","document":"query GetViewer($id: ID!) { viewer(id: $id) { id } }","operation_name":"GetViewer","operation_type":"query"}],"unsatisfied":[],"truncated":false}`,
	)
	client := newTestClient(t)

	indexResp, err := client.IndexSchema(context.Background(), connect.NewRequest(&yokov1.IndexSchemaRequest{
		Sdl: `type Query { viewer(id: ID!): User } type User { id: ID! }`,
	}))
	require.NoError(t, err)

	resp, err := client.GenerateQuery(context.Background(), connect.NewRequest(&yokov1.GenerateQueryRequest{
		SchemaId: indexResp.Msg.GetSchemaId(),
		Prompt:   "viewer",
	}))
	require.NoError(t, err)

	queries := resp.Msg.GetResolution().GetQueries()
	require.Len(t, queries, 1)
	assert.Equal(t, `{"type":"object","properties":{"id":{"type":"string"}},"required":["id"]}`, queries[0].GetVariablesSchema())
}

func TestGenerateQueryForwardsUnsatisfiedAndTruncated(t *testing.T) {
	writeFakeCodex(t,
		`{"type":"thread.started","thread_id":"fake-thread"}`,
		`{"queries":[],"unsatisfied":[{"reason":"no field on the schema carries that filter dimension"}],"truncated":true}`,
	)
	client := newTestClient(t)

	indexResp, err := client.IndexSchema(context.Background(), connect.NewRequest(&yokov1.IndexSchemaRequest{
		Sdl: testSDL,
	}))
	require.NoError(t, err)

	resp, err := client.GenerateQuery(context.Background(), connect.NewRequest(&yokov1.GenerateQueryRequest{
		SchemaId: indexResp.Msg.GetSchemaId(),
		Prompt:   "viewer filtered by some unknown thing",
	}))
	require.NoError(t, err)

	expected := &yokov1.GenerateQueryResponse{
		Resolution: &yokov1.Resolution{
			Queries:     []*yokov1.ResolvedQuery{},
			Unsatisfied: []*yokov1.Unsatisfied{{Reason: "no field on the schema carries that filter dimension"}},
			Truncated:   true,
		},
	}
	assert.Equal(t, normalizeGenerateResponse(t, expected), normalizeGenerateResponse(t, resp.Msg))
}

func TestGenerateQueryUnknownSchemaIDReturnsNotFound(t *testing.T) {
	writeFakeCodex(t,
		`{"type":"thread.started","thread_id":"fake-thread"}`,
		`{"queries":[],"unsatisfied":[],"truncated":false}`,
	)
	client := newTestClient(t)

	_, err := client.GenerateQuery(context.Background(), connect.NewRequest(&yokov1.GenerateQueryRequest{
		SchemaId: "unknown",
		Prompt:   "get the viewer",
	}))

	require.Error(t, err)
	assert.Equal(t, connect.CodeNotFound, connect.CodeOf(err))
}

func TestGenerateQueryBadJSONReturnsInternal(t *testing.T) {
	writeFakeCodex(t,
		`{"type":"thread.started","thread_id":"fake-thread"}`,
		`not json`,
	)
	client := newTestClient(t)

	indexResp, err := client.IndexSchema(context.Background(), connect.NewRequest(&yokov1.IndexSchemaRequest{
		Sdl: testSDL,
	}))
	require.NoError(t, err)

	_, err = client.GenerateQuery(context.Background(), connect.NewRequest(&yokov1.GenerateQueryRequest{
		SchemaId: indexResp.Msg.GetSchemaId(),
		Prompt:   "get the viewer",
	}))

	require.Error(t, err)
	assert.Equal(t, connect.CodeInternal, connect.CodeOf(err))
}

func newTestClient(t *testing.T) yokov1connect.YokoServiceClient {
	t.Helper()

	svc, err := newYokoService("codex", time.Second, "low", 0, 16) // disable rotation; small cache
	require.NoError(t, err)
	t.Cleanup(svc.Close)
	mux := newHTTPMux(svc)
	httpClient := &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, req)
		return rec.Result(), nil
	})}

	return yokov1connect.NewYokoServiceClient(httpClient, "http://yoko.test")
}

// writeFakeCodex installs a stub `codex` binary on PATH that mocks both the
// initial `codex exec` (IndexSchema pre-warm) and `codex exec resume`
// (GenerateQuery) calls. The stub detects "resume" in its argv to switch modes.
//
//   - indexStdout is printed to stdout for the IndexSchema call (e.g. a JSONL
//     line like {"type":"thread.started","thread_id":"..."}).
//   - resumeMessage is written to the file passed via -o <FILE> for the
//     GenerateQuery call (codex's --output-last-message contract).
func writeFakeCodex(t *testing.T, indexStdout, resumeMessage string) {
	t.Helper()

	dir := t.TempDir()
	indexFile := filepath.Join(dir, "index.out")
	require.NoError(t, os.WriteFile(indexFile, []byte(indexStdout+"\n"), 0o644))
	resumeFile := filepath.Join(dir, "resume.out")
	require.NoError(t, os.WriteFile(resumeFile, []byte(resumeMessage), 0o644))

	name := "codex"
	if runtime.GOOS == "windows" {
		name += ".bat"
	}
	path := filepath.Join(dir, name)
	var script string
	if runtime.GOOS == "windows" {
		// Minimal Windows fallback — only IndexSchema path is exercised in CI on Unix.
		script = "@echo off\r\ntype \"" + indexFile + "\"\r\n"
	} else {
		script = "#!/bin/sh\n" +
			"is_resume=0\n" +
			"out_file=\"\"\n" +
			"prev=\"\"\n" +
			"for arg in \"$@\"; do\n" +
			"    if [ \"$prev\" = \"-o\" ]; then out_file=\"$arg\"; fi\n" +
			"    if [ \"$arg\" = \"resume\" ]; then is_resume=1; fi\n" +
			"    prev=\"$arg\"\n" +
			"done\n" +
			"cat >/dev/null\n" +
			"if [ \"$is_resume\" = \"1\" ]; then\n" +
			"    if [ -n \"$out_file\" ]; then cat \"" + resumeFile + "\" > \"$out_file\"; fi\n" +
			"else\n" +
			"    cat \"" + indexFile + "\"\n" +
			"fi\n"
	}
	require.NoError(t, os.WriteFile(path, []byte(script), 0o755))
	t.Setenv("PATH", dir+string(os.PathListSeparator)+os.Getenv("PATH"))
}

var _ http.Handler = (*http.ServeMux)(nil)

func normalizeGenerateResponse(t *testing.T, resp *yokov1.GenerateQueryResponse) *yokov1.GenerateQueryResponse {
	t.Helper()

	data, err := proto.Marshal(resp)
	require.NoError(t, err)
	normalized := &yokov1.GenerateQueryResponse{}
	require.NoError(t, proto.Unmarshal(data, normalized))
	return normalized
}

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(req *http.Request) (*http.Response, error) {
	return f(req)
}

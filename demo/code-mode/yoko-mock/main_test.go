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

func TestIndexThenSearchReturnsGeneratedOperations(t *testing.T) {
	writeFakeCodex(t,
		`{"type":"thread.started","thread_id":"fake-thread"}`,
		`{"operations":[{"name":"getViewer","body":"query getViewer { viewer { id } }","kind":"query","description":"Fetches the current viewer."}]}`,
	)
	client := newTestClient(t)

	indexResp, err := client.Index(context.Background(), connect.NewRequest(&yokov1.IndexRequest{
		SchemaSdl: "type Query { viewer: User } type User { id: ID! }",
	}))
	require.NoError(t, err)

	searchResp, err := client.Search(context.Background(), connect.NewRequest(&yokov1.SearchRequest{
		SchemaId:  indexResp.Msg.GetSchemaId(),
		Prompts:   []string{"get the viewer"},
		SessionId: "session-1",
	}))
	require.NoError(t, err)

	expected := &yokov1.SearchResponse{
		Operations: []*yokov1.GeneratedOperation{
			{
				Name:        "getViewer",
				Body:        "query getViewer { viewer { id } }",
				Kind:        yokov1.OperationKind_OPERATION_KIND_QUERY,
				Description: "Fetches the current viewer.",
			},
		},
	}
	assert.Equal(t, normalizeSearchResponse(t, expected), normalizeSearchResponse(t, searchResp.Msg))
}

func TestSearchUnknownSchemaIDReturnsNotFound(t *testing.T) {
	writeFakeCodex(t,
		`{"type":"thread.started","thread_id":"fake-thread"}`,
		`{"operations":[]}`,
	)
	client := newTestClient(t)

	_, err := client.Search(context.Background(), connect.NewRequest(&yokov1.SearchRequest{
		SchemaId: "unknown",
		Prompts:  []string{"get the viewer"},
	}))

	require.Error(t, err)
	assert.Equal(t, connect.CodeNotFound, connect.CodeOf(err))
}

func TestSearchBadJSONReturnsInternal(t *testing.T) {
	writeFakeCodex(t,
		`{"type":"thread.started","thread_id":"fake-thread"}`,
		`not json`,
	)
	client := newTestClient(t)

	indexResp, err := client.Index(context.Background(), connect.NewRequest(&yokov1.IndexRequest{
		SchemaSdl: "type Query { viewer: ID! }",
	}))
	require.NoError(t, err)

	_, err = client.Search(context.Background(), connect.NewRequest(&yokov1.SearchRequest{
		SchemaId: indexResp.Msg.GetSchemaId(),
		Prompts:  []string{"get the viewer"},
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
// initial `codex exec` (Index pre-warm) and `codex exec resume` (Search) calls.
// The stub detects "resume" in its argv to switch modes.
//
//   - indexStdout is printed to stdout for the Index call (e.g. a JSONL line
//     like {"type":"thread.started","thread_id":"..."}).
//   - resumeMessage is written to the file passed via -o <FILE> for the Search
//     call (codex's --output-last-message contract).
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
		// Minimal Windows fallback — only Index path is exercised in CI on Unix.
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

func normalizeSearchResponse(t *testing.T, resp *yokov1.SearchResponse) *yokov1.SearchResponse {
	t.Helper()

	data, err := proto.Marshal(resp)
	require.NoError(t, err)
	normalized := &yokov1.SearchResponse{}
	require.NoError(t, proto.Unmarshal(data, normalized))
	return normalized
}

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(req *http.Request) (*http.Response, error) {
	return f(req)
}

package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"syscall"
	"time"

	"connectrpc.com/connect"
	"github.com/dgraph-io/ristretto/v2"
	yokov1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/code_mode/yoko/v1"
	"github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/code_mode/yoko/v1/yokov1connect"
	"github.com/wundergraph/cosmo/router/pkg/codemode/varschema"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/ast"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/astparser"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/asttransform"
)

const badOutputPath = "/tmp/yoko-mock-last-bad-output.log"

type yokoService struct {
	codexBin             string
	codexTimeout         time.Duration
	codexReasoningEffort string
	rotateAfter          int // re-warm the codex session after this many GenerateQuery calls; 0 disables

	// promptCache memoizes (schemaID, prompt) -> ResolvedQuery. A cache hit
	// lets us skip codex entirely for that prompt. nil if the cache is
	// disabled (size <= 0).
	promptCache *ristretto.Cache[string, *yokov1.ResolvedQuery]

	mu      sync.RWMutex
	schemas map[string]*schemaEntry
}

// schemaEntry records the on-disk schema dir (so codex can read schema.graphql
// once at IndexSchema time) plus the codex session id created during that
// pre-warm and the parsed schema document used to derive variables_schema for
// each generated operation.
type schemaEntry struct {
	dir    string
	schema *ast.Document

	mu        sync.RWMutex
	sessionID string

	generateCount  atomic.Int64
	rotationActive atomic.Bool
}

type codexResolvedQuery struct {
	Description   string `json:"description"`
	Document      string `json:"document"`
	OperationName string `json:"operation_name"`
	OperationType string `json:"operation_type"`
}

type codexUnsatisfied struct {
	Reason string `json:"reason"`
}

type codexResolution struct {
	Queries     []codexResolvedQuery `json:"queries"`
	Unsatisfied []codexUnsatisfied   `json:"unsatisfied"`
	Truncated   bool                 `json:"truncated"`
}

func main() {
	listenAddr := flag.String("listen-addr", "localhost:5028", "address for the Yoko mock HTTP server")
	codexBin := flag.String("codex-bin", "codex", "codex CLI binary path or name")
	codexTimeout := flag.Duration("codex-timeout", 60*time.Second, "codex CLI timeout")
	codexReasoningEffort := flag.String("codex-reasoning-effort", "low", "codex reasoning effort: minimal | low | medium | high")
	codexRotateAfter := flag.Int("codex-rotate-after", 20, "re-warm the codex session after N GenerateQuery calls (0 = disable rotation)")
	promptCacheSize := flag.Int("prompt-cache-size", 1000, "max items in the (schema_id, prompt) -> resolved_query cache (0 = disable)")
	flag.Parse()

	svc, err := newYokoService(*codexBin, *codexTimeout, *codexReasoningEffort, *codexRotateAfter, *promptCacheSize)
	if err != nil {
		log.Fatalf("create yoko service: %v", err)
	}
	defer svc.Close()
	server := &http.Server{
		Addr:    *listenAddr,
		Handler: newHTTPMux(svc),
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	errCh := make(chan error, 1)
	go func() {
		log.Printf("yoko mock listening addr=%s codex_bin=%s codex_timeout=%s reasoning_effort=%s", *listenAddr, *codexBin, codexTimeout.String(), *codexReasoningEffort)
		errCh <- server.ListenAndServe()
	}()

	select {
	case <-ctx.Done():
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if err := server.Shutdown(shutdownCtx); err != nil {
			log.Fatalf("server shutdown failed: %v", err)
		}
	case err := <-errCh:
		if err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatalf("server failed: %v", err)
		}
	}
}

func newYokoService(codexBin string, codexTimeout time.Duration, reasoningEffort string, rotateAfter, promptCacheSize int) (*yokoService, error) {
	svc := &yokoService{
		codexBin:             codexBin,
		codexTimeout:         codexTimeout,
		codexReasoningEffort: reasoningEffort,
		rotateAfter:          rotateAfter,
		schemas:              make(map[string]*schemaEntry),
	}
	if promptCacheSize > 0 {
		// Each cache entry has cost 1, so MaxCost is the item ceiling.
		// NumCounters is conventionally 10× expected items.
		cache, err := ristretto.NewCache(&ristretto.Config[string, *yokov1.ResolvedQuery]{
			NumCounters: int64(promptCacheSize) * 10,
			MaxCost:     int64(promptCacheSize),
			BufferItems: 64,
		})
		if err != nil {
			return nil, fmt.Errorf("create prompt cache: %w", err)
		}
		svc.promptCache = cache
	}
	return svc, nil
}

func newHTTPMux(svc *yokoService) *http.ServeMux {
	mux := http.NewServeMux()
	mux.HandleFunc("/health", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("OK\n"))
	})
	path, handler := yokov1connect.NewYokoServiceHandler(svc)
	mux.Handle(path, handler)
	return mux
}

func (s *yokoService) IndexSchema(ctx context.Context, req *connect.Request[yokov1.IndexSchemaRequest]) (*connect.Response[yokov1.IndexSchemaResponse], error) {
	sdl := req.Msg.GetSdl()
	id := schemaID(sdl)

	s.mu.Lock()
	if existing, ok := s.schemas[id]; ok {
		s.mu.Unlock()
		existing.mu.RLock()
		existingSession := existing.sessionID
		existing.mu.RUnlock()
		log.Printf("IndexSchema schema_id=%s reused dir=%s session_id=%s", id, existing.dir, existingSession)
		return connect.NewResponse(&yokov1.IndexSchemaResponse{SchemaId: id}), nil
	}
	s.mu.Unlock()

	schemaDoc, err := parseSchemaSDL(sdl)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("parse schema SDL: %w", err))
	}

	dir, err := os.MkdirTemp("", "yoko-schema-"+id+"-")
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("create schema temp dir: %w", err))
	}
	if err := os.WriteFile(filepath.Join(dir, "schema.graphql"), []byte(sdl), 0o600); err != nil {
		_ = os.RemoveAll(dir)
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("write schema.graphql: %w", err))
	}

	sessionID, err := s.runCodexIndex(ctx, dir)
	if err != nil {
		_ = os.RemoveAll(dir)
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("codex pre-warm: %w", err))
	}

	entry := &schemaEntry{dir: dir, schema: schemaDoc, sessionID: sessionID}
	s.mu.Lock()
	s.schemas[id] = entry
	s.mu.Unlock()

	log.Printf("IndexSchema schema_id=%s sdl_size=%d schema_dir=%s session_id=%s rotate_after=%d", id, len(sdl), dir, sessionID, s.rotateAfter)
	return connect.NewResponse(&yokov1.IndexSchemaResponse{SchemaId: id}), nil
}

// Close removes every per-schema temp dir created by IndexSchema. Safe to call
// multiple times; subsequent calls are no-ops. Codex session rollout files
// live under ~/.codex/sessions/ and are intentionally left in place — they
// belong to the user's codex install.
func (s *yokoService) Close() {
	s.mu.Lock()
	defer s.mu.Unlock()
	for id, entry := range s.schemas {
		if err := os.RemoveAll(entry.dir); err != nil {
			log.Printf("Close schema_id=%s dir=%s err=%v", id, entry.dir, err)
			continue
		}
		log.Printf("Close schema_id=%s dir=%s removed", id, entry.dir)
	}
	s.schemas = nil
	if s.promptCache != nil {
		s.promptCache.Close()
		s.promptCache = nil
	}
}

func (s *yokoService) GenerateQuery(ctx context.Context, req *connect.Request[yokov1.GenerateQueryRequest]) (*connect.Response[yokov1.GenerateQueryResponse], error) {
	schemaID := req.Msg.GetSchemaId()
	prompt := req.Msg.GetPrompt()

	s.mu.RLock()
	entry, ok := s.schemas[schemaID]
	s.mu.RUnlock()
	if !ok {
		log.Printf("GenerateQuery schema_id=%s not_found=true", schemaID)
		return nil, connect.NewError(connect.CodeNotFound, fmt.Errorf("schema_id %q not found; call IndexSchema before GenerateQuery", schemaID))
	}

	// Bump per-session call counter; if we crossed the threshold and no
	// rotation is in flight, kick one off in the background. The CAS makes
	// the trigger one-shot until rotation completes and clears the flag.
	count := entry.generateCount.Add(1)
	if s.rotateAfter > 0 && count >= int64(s.rotateAfter) && entry.rotationActive.CompareAndSwap(false, true) {
		go s.rotateSession(schemaID, entry, count)
	}

	if cached, ok := s.cacheGet(schemaID, prompt); ok {
		log.Printf("GenerateQuery schema_id=%s cache_hit=true codex_skipped=true", schemaID)
		return connect.NewResponse(&yokov1.GenerateQueryResponse{
			Resolution: &yokov1.Resolution{Queries: []*yokov1.ResolvedQuery{cached}},
		}), nil
	}

	entry.mu.RLock()
	sessionID := entry.sessionID
	entry.mu.RUnlock()

	codexPrompt := buildCodexPrompt(prompt)
	stdout, err := s.runCodexResume(ctx, sessionID, codexPrompt)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	resolution, err := parseCodexResolution(stdout)
	if err != nil {
		if writeErr := os.WriteFile(badOutputPath, stdout, 0o600); writeErr != nil {
			log.Printf("warning: failed to write bad codex output path=%s err=%v", badOutputPath, writeErr)
		}
		log.Printf("warning: codex output was not valid JSON schema_id=%s stdout_size=%d err=%v", schemaID, len(stdout), err)
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("codex output was not valid JSON; raw output saved to %s", badOutputPath))
	}

	for _, q := range resolution.GetQueries() {
		// Derive variables_schema statically from the parsed schema. If
		// derivation fails we leave variables_schema empty so the client
		// still gets a usable response — the agent can validate manually.
		varsSchema, derr := varschema.ForOperation(q.GetDocument(), entry.schema)
		if derr != nil {
			log.Printf("warning: derive variables_schema schema_id=%s op=%q err=%v", schemaID, q.GetOperationName(), derr)
			continue
		}
		q.VariablesSchema = varsSchema
	}

	// Cache successful single-query resolutions only — caching multi-query
	// or unsatisfied resolutions would hide real codex variation.
	if len(resolution.GetQueries()) == 1 && len(resolution.GetUnsatisfied()) == 0 && !resolution.GetTruncated() {
		s.cachePut(schemaID, prompt, resolution.GetQueries()[0])
	}

	log.Printf("GenerateQuery schema_id=%s codex_stdout_size=%d query_count=%d unsatisfied_count=%d truncated=%v",
		schemaID, len(stdout), len(resolution.GetQueries()), len(resolution.GetUnsatisfied()), resolution.GetTruncated())
	return connect.NewResponse(&yokov1.GenerateQueryResponse{Resolution: resolution}), nil
}

// cacheKey returns the (schema_id, prompt) lookup key. We include schema_id
// so the same prompt against a different supergraph doesn't return a stale
// query.
func cacheKey(schemaID, prompt string) string {
	return schemaID + "\x00" + prompt
}

func (s *yokoService) cacheGet(schemaID, prompt string) (*yokov1.ResolvedQuery, bool) {
	if s.promptCache == nil {
		return nil, false
	}
	return s.promptCache.Get(cacheKey(schemaID, prompt))
}

func (s *yokoService) cachePut(schemaID, prompt string, q *yokov1.ResolvedQuery) {
	if s.promptCache == nil {
		return
	}
	s.promptCache.Set(cacheKey(schemaID, prompt), q, 1)
}

// rotateSession is launched in a goroutine when GenerateQuery counts cross
// rotateAfter. It pre-warms a fresh codex session against the same on-disk
// schema, then atomically swaps in the new sessionID and resets the call
// counter. While rotation is running, concurrent calls keep using the old
// sessionID — they just don't trigger a second rotation.
func (s *yokoService) rotateSession(schemaID string, entry *schemaEntry, triggerCount int64) {
	start := time.Now()
	log.Printf("rotation kickoff schema_id=%s trigger_count=%d", schemaID, triggerCount)

	ctx, cancel := context.WithTimeout(context.Background(), s.codexTimeout)
	defer cancel()

	newSessionID, err := s.runCodexIndex(ctx, entry.dir)
	if err != nil {
		log.Printf("rotation failed schema_id=%s elapsed=%s err=%v", schemaID, time.Since(start).Round(time.Millisecond), err)
		entry.rotationActive.Store(false)
		return
	}

	entry.mu.Lock()
	oldSessionID := entry.sessionID
	entry.sessionID = newSessionID
	entry.mu.Unlock()

	// Reset count BEFORE clearing rotationActive so a call arriving in this
	// gap can't trigger a second rotation on a freshly-rotated session.
	entry.generateCount.Store(0)
	entry.rotationActive.Store(false)

	log.Printf("rotation complete schema_id=%s old_session=%s new_session=%s elapsed=%s", schemaID, oldSessionID, newSessionID, time.Since(start).Round(time.Millisecond))
}

func schemaID(sdl string) string {
	sum := sha256.Sum256([]byte(sdl))
	return fmt.Sprintf("%x", sum)[:16]
}

func parseSchemaSDL(sdl string) (*ast.Document, error) {
	doc, report := astparser.ParseGraphqlDocumentString(sdl)
	if report.HasErrors() {
		return nil, fmt.Errorf("parse SDL: %s", report.Error())
	}
	if err := asttransform.MergeDefinitionWithBaseSchema(&doc); err != nil {
		return nil, fmt.Errorf("merge base schema: %w", err)
	}
	return &doc, nil
}

const indexCodexPrompt = `Read the COMPLETE content of the file ./schema.graphql in your current working directory using your file-reading tool. Read the ENTIRE file (it is approximately 17KB and 824 lines) — do not truncate, do not skim, do not read only a portion. The file is a federated GraphQL supergraph SDL.

Once the full schema is loaded into your context, output exactly this JSON object and nothing else:

{"ready":true}

Do not include preamble, prose, markdown fences, or commentary.`

func buildCodexPrompt(prompt string) string {
	var b strings.Builder
	b.WriteString("You already loaded the federated GraphQL supergraph SDL from\n")
	b.WriteString("./schema.graphql earlier in this session. Use it as the source of\n")
	b.WriteString("truth — do not re-read the file.\n\n")
	b.WriteString("Generate one or more GraphQL operations (query or mutation) that\n")
	b.WriteString("together fulfill the user prompt below against the schema. Each\n")
	b.WriteString("operation must be self-contained and named.\n\n")
	b.WriteString("PARAMETERIZATION REQUIREMENT (load-bearing):\n")
	b.WriteString("Whenever an argument's value depends on the caller's intent (an id,\n")
	b.WriteString("a filter, a name, a tag, a limit, etc.), you MUST declare a GraphQL\n")
	b.WriteString("variable for it and reference it via $varName. NEVER inline a literal\n")
	b.WriteString("for caller-controlled arguments.\n")
	b.WriteString("Example query:    query employeeByID($id: Int!) { employee(id: $id) { id details { forename surname } } }\n")
	b.WriteString("Example mutation: mutation updateEmployeeTag($id: Int!, $tag: String!) { updateEmployeeTag(id: $id, tag: $tag) { id tag } }\n")
	b.WriteString("Only inline a literal when the argument is genuinely fixed by the prompt\n")
	b.WriteString("(for example, 'list ALL employees' might pass no args at all). Variable\n")
	b.WriteString("types must match the schema, including non-null bangs.\n\n")
	b.WriteString("OUTPUT FORMAT (strict, machine-parsed):\n")
	b.WriteString("- Output a single JSON object with these keys:\n")
	b.WriteString("  - queries: array of objects, each with keys:\n")
	b.WriteString("      description (one short sentence describing what this query does),\n")
	b.WriteString("      document (operation source text starting with 'query <name>(...)'\n")
	b.WriteString("      or 'mutation <name>(...)' when variables are declared, or\n")
	b.WriteString("      'query <name> { ... }' / 'mutation <name> { ... }' when\n")
	b.WriteString("      variable-free),\n")
	b.WriteString("      operation_name (the name parsed from the document),\n")
	b.WriteString("      operation_type (\"query\" or \"mutation\").\n")
	b.WriteString("  - unsatisfied: array of {\"reason\": \"...\"} for any requirement that\n")
	b.WriteString("      cannot be satisfied against the schema. Empty array if everything\n")
	b.WriteString("      could be satisfied.\n")
	b.WriteString("  - truncated: boolean. true only if you ran out of room before\n")
	b.WriteString("      committing every requirement.\n")
	b.WriteString("- No prose, no preamble, no markdown fences.\n\n")
	b.WriteString("USER PROMPT:\n")
	b.WriteString(prompt)
	b.WriteByte('\n')
	return b.String()
}

// runCodexIndex performs the one-time pre-warm: codex reads schema.graphql in
// schemaDir and a session is started. The session id (UUID) is parsed from
// codex's first JSONL event and returned so subsequent calls can resume
// the same session.
func (s *yokoService) runCodexIndex(ctx context.Context, schemaDir string) (string, error) {
	cmdCtx, cancel := context.WithTimeout(ctx, s.codexTimeout)
	defer cancel()

	args := []string{
		"exec",
		"--json",
		"-s", "read-only",
		"--skip-git-repo-check",
		"--ignore-user-config",
		"--ignore-rules",
		"-c", "model_reasoning_effort=" + s.codexReasoningEffort,
		"-c", "approval_policy=never",
		"-",
	}

	start := time.Now()
	cmd := exec.CommandContext(cmdCtx, s.codexBin, args...)
	cmd.Dir = schemaDir
	cmd.Stdin = strings.NewReader(indexCodexPrompt)

	var stderr bytes.Buffer
	cmd.Stderr = &stderr

	stdout, err := cmd.Output()
	elapsed := time.Since(start)
	exitCode := 0
	if err != nil {
		exitCode = -1
		var exitErr *exec.ExitError
		if errors.As(err, &exitErr) {
			exitCode = exitErr.ExitCode()
		}
	}
	log.Printf("codex index duration=%s exit_code=%d stdout_prefix=%q stderr_prefix=%q", elapsed.Round(time.Millisecond), exitCode, prefix(stdout, 160), prefix(stderr.Bytes(), 160))

	if cmdCtx.Err() != nil {
		return "", fmt.Errorf("codex index timed out after %s", s.codexTimeout)
	}
	if err != nil {
		return "", fmt.Errorf("codex index failed exit_code=%d stderr=%q: %w", exitCode, prefix(stderr.Bytes(), 300), err)
	}

	return parseThreadID(stdout)
}

// runCodexResume resumes the previously-warmed session and runs the user
// prompt. The agent's last message (a JSON resolution) is captured via
// `--output-last-message` and returned for parsing.
func (s *yokoService) runCodexResume(ctx context.Context, sessionID, prompt string) ([]byte, error) {
	cmdCtx, cancel := context.WithTimeout(ctx, s.codexTimeout)
	defer cancel()

	outFile, err := os.CreateTemp("", "yoko-generate-out-*.txt")
	if err != nil {
		return nil, fmt.Errorf("create output temp file: %w", err)
	}
	outPath := outFile.Name()
	_ = outFile.Close()
	defer os.Remove(outPath)

	args := []string{
		"exec", "resume", sessionID,
		"-o", outPath,
		"--skip-git-repo-check",
		"--ignore-user-config",
		"--ignore-rules",
		"-c", "model_reasoning_effort=" + s.codexReasoningEffort,
		"-c", "approval_policy=never",
		"-",
	}

	start := time.Now()
	cmd := exec.CommandContext(cmdCtx, s.codexBin, args...)
	cmd.Stdin = strings.NewReader(prompt)

	var stderr bytes.Buffer
	cmd.Stderr = &stderr

	err = cmd.Run()
	elapsed := time.Since(start)
	exitCode := 0
	if err != nil {
		exitCode = -1
		var exitErr *exec.ExitError
		if errors.As(err, &exitErr) {
			exitCode = exitErr.ExitCode()
		}
	}

	if cmdCtx.Err() != nil {
		return nil, fmt.Errorf("codex resume timed out after %s", s.codexTimeout)
	}
	if err != nil {
		return nil, fmt.Errorf("codex resume failed exit_code=%d stderr=%q: %w", exitCode, prefix(stderr.Bytes(), 300), err)
	}

	output, err := os.ReadFile(outPath)
	if err != nil {
		return nil, fmt.Errorf("read codex last message: %w", err)
	}
	log.Printf("codex resume duration=%s session_id=%s out_size=%d out_prefix=%q", elapsed.Round(time.Millisecond), sessionID, len(output), prefix(output, 160))
	return output, nil
}

// parseThreadID reads the first JSONL event from codex stdout and extracts
// the thread/session UUID from a `thread.started` event.
func parseThreadID(stdout []byte) (string, error) {
	line, _, _ := bytes.Cut(stdout, []byte("\n"))
	var ev struct {
		Type     string `json:"type"`
		ThreadID string `json:"thread_id"`
	}
	if err := json.Unmarshal(line, &ev); err != nil {
		return "", fmt.Errorf("parse thread.started event: %w (line=%q)", err, prefix(line, 200))
	}
	if ev.Type != "thread.started" || ev.ThreadID == "" {
		return "", fmt.Errorf("expected thread.started event with thread_id, got: %q", prefix(line, 200))
	}
	return ev.ThreadID, nil
}

func parseCodexResolution(stdout []byte) (*yokov1.Resolution, error) {
	payload := extractJSONObject(stdout)
	var parsed codexResolution
	if err := json.Unmarshal(payload, &parsed); err != nil {
		return nil, err
	}

	queries := make([]*yokov1.ResolvedQuery, 0, len(parsed.Queries))
	for _, q := range parsed.Queries {
		queries = append(queries, &yokov1.ResolvedQuery{
			Description:   q.Description,
			Document:      q.Document,
			OperationName: q.OperationName,
			OperationType: strings.ToLower(strings.TrimSpace(q.OperationType)),
		})
	}

	unsatisfied := make([]*yokov1.Unsatisfied, 0, len(parsed.Unsatisfied))
	for _, u := range parsed.Unsatisfied {
		unsatisfied = append(unsatisfied, &yokov1.Unsatisfied{Reason: u.Reason})
	}

	return &yokov1.Resolution{
		Queries:     queries,
		Unsatisfied: unsatisfied,
		Truncated:   parsed.Truncated,
	}, nil
}

// extractJSONObject returns the substring from the first '{' to the last '}'
// in stdout. Resume calls don't support --output-schema, so this guards
// against occasional preamble or trailing prose so json.Unmarshal still
// succeeds.
func extractJSONObject(stdout []byte) []byte {
	start := bytes.IndexByte(stdout, '{')
	end := bytes.LastIndexByte(stdout, '}')
	if start < 0 || end < 0 || end < start {
		return stdout
	}
	return stdout[start : end+1]
}

func prefix(value []byte, max int) string {
	if len(value) <= max {
		return string(value)
	}
	return string(value[:max])
}

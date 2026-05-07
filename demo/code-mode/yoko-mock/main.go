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
)

const badOutputPath = "/tmp/yoko-mock-last-bad-output.log"

type yokoService struct {
	codexBin             string
	codexTimeout         time.Duration
	codexReasoningEffort string
	rotateAfter          int // re-warm the codex session after this many Search calls; 0 disables

	// promptCache memoizes (schemaID, prompt) -> GeneratedOperation. A cache
	// hit lets us skip codex entirely for that prompt. nil if the cache is
	// disabled (size <= 0).
	promptCache *ristretto.Cache[string, *yokov1.GeneratedOperation]

	mu      sync.RWMutex
	schemas map[string]*schemaEntry
}

// schemaEntry records the on-disk schema dir (so codex can read schema.graphql
// once at Index time) plus the codex session id created during that pre-warm.
// Search uses `codex exec resume <sessionID>` to reuse the already-loaded
// schema context instead of re-reading it on every call.
//
// To bound session-file growth, every yokoService.rotateAfter Search calls a
// background goroutine pre-warms a fresh session and atomically swaps the
// sessionID. searchCount tracks calls; rotationActive ensures only one
// rotation runs at a time.
type schemaEntry struct {
	dir string

	mu        sync.RWMutex
	sessionID string

	searchCount    atomic.Int64
	rotationActive atomic.Bool
}

type codexOperation struct {
	Name        string `json:"name"`
	Body        string `json:"body"`
	Kind        string `json:"kind"`
	Description string `json:"description"`
}

type codexOutput struct {
	Operations []codexOperation `json:"operations"`
}

func main() {
	listenAddr := flag.String("listen-addr", "localhost:5028", "address for the Yoko mock HTTP server")
	codexBin := flag.String("codex-bin", "codex", "codex CLI binary path or name")
	codexTimeout := flag.Duration("codex-timeout", 60*time.Second, "codex CLI timeout")
	codexReasoningEffort := flag.String("codex-reasoning-effort", "low", "codex reasoning effort: minimal | low | medium | high")
	codexRotateAfter := flag.Int("codex-rotate-after", 20, "re-warm the codex session after N Search calls (0 = disable rotation)")
	promptCacheSize := flag.Int("prompt-cache-size", 1000, "max items in the (schema_id, prompt) -> operation cache (0 = disable)")
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
		cache, err := ristretto.NewCache(&ristretto.Config[string, *yokov1.GeneratedOperation]{
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

func (s *yokoService) Index(ctx context.Context, req *connect.Request[yokov1.IndexRequest]) (*connect.Response[yokov1.IndexResponse], error) {
	schemaSDL := req.Msg.GetSchemaSdl()
	id := schemaID(schemaSDL)

	s.mu.Lock()
	if existing, ok := s.schemas[id]; ok {
		s.mu.Unlock()
		existing.mu.RLock()
		existingSession := existing.sessionID
		existing.mu.RUnlock()
		log.Printf("Index schema_id=%s reused dir=%s session_id=%s", id, existing.dir, existingSession)
		return connect.NewResponse(&yokov1.IndexResponse{SchemaId: id}), nil
	}
	s.mu.Unlock()

	dir, err := os.MkdirTemp("", "yoko-schema-"+id+"-")
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("create schema temp dir: %w", err))
	}
	if err := os.WriteFile(filepath.Join(dir, "schema.graphql"), []byte(schemaSDL), 0o600); err != nil {
		_ = os.RemoveAll(dir)
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("write schema.graphql: %w", err))
	}

	sessionID, err := s.runCodexIndex(ctx, dir)
	if err != nil {
		_ = os.RemoveAll(dir)
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("codex pre-warm: %w", err))
	}

	entry := &schemaEntry{dir: dir, sessionID: sessionID}
	s.mu.Lock()
	s.schemas[id] = entry
	s.mu.Unlock()

	log.Printf("Index schema_id=%s schema_sdl_size=%d schema_dir=%s session_id=%s rotate_after=%d", id, len(schemaSDL), dir, sessionID, s.rotateAfter)
	return connect.NewResponse(&yokov1.IndexResponse{SchemaId: id}), nil
}

// Close removes every per-schema temp dir created by Index. Safe to call
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

func (s *yokoService) Search(ctx context.Context, req *connect.Request[yokov1.SearchRequest]) (*connect.Response[yokov1.SearchResponse], error) {
	schemaID := req.Msg.GetSchemaId()
	prompts := req.Msg.GetPrompts()

	s.mu.RLock()
	entry, ok := s.schemas[schemaID]
	s.mu.RUnlock()
	if !ok {
		log.Printf("Search schema_id=%s prompt_count=%d not_found=true", schemaID, len(prompts))
		return nil, connect.NewError(connect.CodeNotFound, fmt.Errorf("schema_id %q not found; call Index before Search", schemaID))
	}

	// Bump per-session call counter; if we crossed the threshold and no
	// rotation is in flight, kick one off in the background. The CAS makes
	// the trigger one-shot until rotation completes and clears the flag.
	count := entry.searchCount.Add(1)
	if s.rotateAfter > 0 && count >= int64(s.rotateAfter) && entry.rotationActive.CompareAndSwap(false, true) {
		go s.rotateSession(schemaID, entry, count)
	}

	// Cache lookup: collect cached ops in their original positions, batch
	// only the misses to codex.
	results := make([]*yokov1.GeneratedOperation, len(prompts))
	missing := make([]string, 0, len(prompts))
	missingIdx := make([]int, 0, len(prompts))
	hits := 0
	for i, p := range prompts {
		if op, ok := s.cacheGet(schemaID, p); ok {
			results[i] = op
			hits++
		} else {
			missing = append(missing, p)
			missingIdx = append(missingIdx, i)
		}
	}

	if len(missing) == 0 {
		log.Printf("Search schema_id=%s prompt_count=%d cache_hits=%d cache_misses=0 codex_skipped=true", schemaID, len(prompts), hits)
		return connect.NewResponse(&yokov1.SearchResponse{Operations: filterNonNil(results)}), nil
	}

	entry.mu.RLock()
	sessionID := entry.sessionID
	entry.mu.RUnlock()

	prompt := buildCodexPrompt(missing)
	stdout, err := s.runCodexResume(ctx, sessionID, prompt)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	generated, err := parseCodexOperations(stdout)
	if err != nil {
		if writeErr := os.WriteFile(badOutputPath, stdout, 0o600); writeErr != nil {
			log.Printf("warning: failed to write bad codex output path=%s err=%v", badOutputPath, writeErr)
		}
		log.Printf("warning: codex output was not valid JSON schema_id=%s prompt_count=%d stdout_size=%d err=%v", schemaID, len(missing), len(stdout), err)
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("codex output was not valid JSON; raw output saved to %s", badOutputPath))
	}

	// Pair generated ops back into the original prompt slots and cache the
	// successful ones. We trust order: codex was instructed to return one
	// operation per missing prompt in the same order. If codex returned
	// fewer ops than asked, the trailing prompts have no slot filled (and
	// don't get cached).
	for k, idx := range missingIdx {
		if k >= len(generated) {
			break
		}
		op := generated[k]
		if op == nil || op.GetBody() == "" {
			// Failed prompt — don't cache, leave slot nil (filtered out below).
			continue
		}
		results[idx] = op
		s.cachePut(schemaID, missing[k], op)
	}

	log.Printf("Search schema_id=%s prompt_count=%d cache_hits=%d cache_misses=%d codex_stdout_size=%d parsed_op_count=%d", schemaID, len(prompts), hits, len(missing), len(stdout), len(generated))
	return connect.NewResponse(&yokov1.SearchResponse{Operations: filterNonNil(results)}), nil
}

func filterNonNil(ops []*yokov1.GeneratedOperation) []*yokov1.GeneratedOperation {
	out := ops[:0]
	for _, op := range ops {
		if op != nil {
			out = append(out, op)
		}
	}
	return out
}

// cacheKey returns the (schema_id, prompt) lookup key. We include schema_id
// so the same prompt against a different supergraph doesn't return a stale
// operation.
func cacheKey(schemaID, prompt string) string {
	return schemaID + "\x00" + prompt
}

func (s *yokoService) cacheGet(schemaID, prompt string) (*yokov1.GeneratedOperation, bool) {
	if s.promptCache == nil {
		return nil, false
	}
	return s.promptCache.Get(cacheKey(schemaID, prompt))
}

func (s *yokoService) cachePut(schemaID, prompt string, op *yokov1.GeneratedOperation) {
	if s.promptCache == nil {
		return
	}
	s.promptCache.Set(cacheKey(schemaID, prompt), op, 1)
}

// rotateSession is launched in a goroutine when Search counts cross
// rotateAfter. It pre-warms a fresh codex session against the same on-disk
// schema, then atomically swaps in the new sessionID and resets the search
// counter. While rotation is running, concurrent Search calls keep using the
// old sessionID — they just don't trigger a second rotation.
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

	// Reset count BEFORE clearing rotationActive so a Search arriving in this
	// gap can't trigger a second rotation on a freshly-rotated session.
	entry.searchCount.Store(0)
	entry.rotationActive.Store(false)

	log.Printf("rotation complete schema_id=%s old_session=%s new_session=%s elapsed=%s", schemaID, oldSessionID, newSessionID, time.Since(start).Round(time.Millisecond))
}

func schemaID(schemaSDL string) string {
	sum := sha256.Sum256([]byte(schemaSDL))
	return fmt.Sprintf("%x", sum)[:16]
}

const indexCodexPrompt = `Read the COMPLETE content of the file ./schema.graphql in your current working directory using your file-reading tool. Read the ENTIRE file (it is approximately 17KB and 824 lines) — do not truncate, do not skim, do not read only a portion. The file is a federated GraphQL supergraph SDL.

Once the full schema is loaded into your context, output exactly this JSON object and nothing else:

{"ready":true}

Do not include preamble, prose, markdown fences, or commentary.`

func buildCodexPrompt(prompts []string) string {
	var b strings.Builder
	b.WriteString("You already loaded the federated GraphQL supergraph SDL from\n")
	b.WriteString("./schema.graphql earlier in this session. Use it as the source of\n")
	b.WriteString("truth — do not re-read the file.\n\n")
	b.WriteString("For each user prompt below, generate ONE corresponding GraphQL\n")
	b.WriteString("operation (query or mutation) that fulfills the prompt against\n")
	b.WriteString("the schema. Return one operation per prompt, in the same order.\n\n")
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
	b.WriteString("- Output a single JSON object with one key: \"operations\" (array).\n")
	b.WriteString("- Each operation has keys: name (camelCase), body (operation\n")
	b.WriteString("  source text starting with 'query <name>(...)' or\n")
	b.WriteString("  'mutation <name>(...)' when variables are declared, or\n")
	b.WriteString("  'query <name> { ... }' / 'mutation <name> { ... }' when truly\n")
	b.WriteString("  variable-free), kind ('query' or 'mutation'), description\n")
	b.WriteString("  (one short sentence).\n")
	b.WriteString("- operations.length MUST equal the number of user prompts below,\n")
	b.WriteString("  in the same order.\n")
	b.WriteString("- No prose, no preamble, no markdown fences.\n\n")
	b.WriteString("USER PROMPTS:\n")
	for _, prompt := range prompts {
		b.WriteString("- ")
		b.WriteString(prompt)
		b.WriteByte('\n')
	}
	return b.String()
}

// runCodexIndex performs the one-time pre-warm: codex reads schema.graphql in
// schemaDir and a session is started. The session id (UUID) is parsed from
// codex's first JSONL event and returned so subsequent Search calls can resume
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
// prompts. The agent's last message (a JSON object of operations) is captured
// via `--output-last-message` and returned for parsing.
func (s *yokoService) runCodexResume(ctx context.Context, sessionID, prompt string) ([]byte, error) {
	cmdCtx, cancel := context.WithTimeout(ctx, s.codexTimeout)
	defer cancel()

	outFile, err := os.CreateTemp("", "yoko-search-out-*.txt")
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

func parseCodexOperations(stdout []byte) ([]*yokov1.GeneratedOperation, error) {
	payload := extractJSONObject(stdout)
	var parsed codexOutput
	if err := json.Unmarshal(payload, &parsed); err != nil {
		return nil, err
	}

	ops := make([]*yokov1.GeneratedOperation, 0, len(parsed.Operations))
	for _, op := range parsed.Operations {
		ops = append(ops, &yokov1.GeneratedOperation{
			Name:        op.Name,
			Body:        op.Body,
			Kind:        operationKind(op.Kind),
			Description: op.Description,
		})
	}
	return ops, nil
}

func operationKind(kind string) yokov1.OperationKind {
	switch strings.ToLower(kind) {
	case "query":
		return yokov1.OperationKind_OPERATION_KIND_QUERY
	case "mutation":
		return yokov1.OperationKind_OPERATION_KIND_MUTATION
	default:
		return yokov1.OperationKind_OPERATION_KIND_UNSPECIFIED
	}
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

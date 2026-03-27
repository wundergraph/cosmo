// yoko-mock is a mock implementation of the Yoko query generation API.
// It accepts natural language prompts and generates GraphQL queries by
// racing the Claude and Codex CLIs with the supergraph schema as context.
package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/wundergraph/cosmo/router/internal/llmcli"
)

type generateRequest struct {
	Prompt     string `json:"prompt"`
	SchemaHash string `json:"schema_hash"`
}

type queryResult struct {
	Query       string         `json:"query"`
	Variables   map[string]any `json:"variables,omitempty"`
	Description string         `json:"description"`
}

type generateResponse struct {
	Queries []queryResult `json:"queries"`
}

type errorResponse struct {
	Error   string `json:"error"`
	Details string `json:"details,omitempty"`
}

var (
	listenAddr string
	schemaFile string
)

func main() {
	flag.StringVar(&listenAddr, "addr", "localhost:5030", "Listen address for the Yoko mock server")
	flag.StringVar(&schemaFile, "schema", "", "Path to the GraphQL schema file (SDL) to use as context")
	flag.Parse()

	if schemaFile == "" {
		log.Fatal("--schema flag is required: path to the composed GraphQL SDL file")
	}

	schemaBytes, err := os.ReadFile(schemaFile)
	if err != nil {
		log.Fatalf("Failed to read schema file %s: %v", schemaFile, err)
	}
	schema := string(schemaBytes)

	mux := http.NewServeMux()
	mux.HandleFunc("/v1/generate", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}

		var req generateRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(w, http.StatusBadRequest, "Invalid JSON", err.Error())
			return
		}

		if strings.TrimSpace(req.Prompt) == "" {
			writeError(w, http.StatusBadRequest, "Prompt cannot be empty", "")
			return
		}

		log.Printf("[REQUEST] prompt=%q schema_hash=%q", req.Prompt, req.SchemaHash)
		start := time.Now()

		queries, err := generateQueries(r.Context(), schema, req.Prompt)
		elapsed := time.Since(start)

		if err != nil {
			log.Printf("[ERROR] %v (took %s)", err, elapsed)
			writeError(w, http.StatusInternalServerError, "Query generation failed", err.Error())
			return
		}

		log.Printf("[RESPONSE] generated %d queries (took %s)", len(queries), elapsed)
		for i, q := range queries {
			log.Printf("  [%d] %s", i, q.Description)
		}

		w.Header().Set("Content-Type", "application/json")
		if err := json.NewEncoder(w).Encode(generateResponse{Queries: queries}); err != nil {
			log.Printf("[ERROR] failed to write response: %v", err)
		}
	})

	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		if _, err := w.Write([]byte("ok")); err != nil {
			log.Printf("[ERROR] failed to write health response: %v", err)
		}
	})

	log.Printf("Yoko mock server starting on %s (schema: %s)", listenAddr, schemaFile)
	if err := http.ListenAndServe(listenAddr, mux); err != nil {
		log.Fatal(err)
	}
}

func generateQueries(ctx context.Context, schema, prompt string) ([]queryResult, error) {
	modelPrompt := fmt.Sprintf(`You are a GraphQL query generator. Given a natural language prompt and a GraphQL schema, generate one or more valid GraphQL queries that satisfy the request.

IMPORTANT: Your response must be ONLY a valid JSON array of objects, with no markdown formatting, no code fences, no explanation. Each object must have:
- "query": a valid GraphQL query string
- "variables": an object with any required variable values (use sensible defaults)
- "description": a brief description that adds context BEYOND what is obvious from the query fields and variable names. Never repeat field names from the selection set. If the query is self-explanatory, use an empty string "".

Always include __typename in selection sets that return union or interface types so callers can distinguish concrete types.

Here is the GraphQL schema:

%s

Generate queries for this prompt: %s`, schema, prompt)

	cmdCtx, cancel := context.WithTimeout(ctx, 2*time.Minute)
	defer cancel()

	queries, _, err := llmcli.FirstDecoded(cmdCtx, modelPrompt, func(name, text string) ([]queryResult, error) {
		text = llmcli.StripMarkdownCodeFences(text)

		var queries []queryResult
		if err := json.Unmarshal([]byte(text), &queries); err != nil {
			return nil, fmt.Errorf("failed to parse %s output as JSON: %w\nRaw output:\n%s", name, err, text)
		}
		if len(queries) == 0 {
			return nil, fmt.Errorf("%s generated 0 queries", name)
		}
		return queries, nil
	}, llmcli.NewClaudeRunner(), llmcli.NewCodexRunner())
	if err != nil {
		return nil, err
	}

	return queries, nil
}

func writeError(w http.ResponseWriter, status int, msg, details string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(errorResponse{Error: msg, Details: details}); err != nil {
		log.Printf("[ERROR] failed to write error response: %v", err)
	}
}

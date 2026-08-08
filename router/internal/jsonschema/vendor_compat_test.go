package jsonschema

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"os"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"github.com/wundergraph/graphql-go-tools/v2/pkg/astparser"
)

// Live vendor acceptance tests. These tests send generated schemas to the real
// Anthropic and OpenAI APIs and assert that the vendors accept or reject them.
// The vendors validate tool schemas before inference, so each probe uses
// max_tokens=1 and costs a fraction of a cent.
//
// The tests are always skipped. No automated run (CI or local) makes network
// calls or spends API credits. To run one locally, remove the Skip line in
// requireLiveTest and set the vendor API key (ANTHROPIC_API_KEY / OPENAI_API_KEY).
//
// Rule sources:
//   - Anthropic rejects oneOf/allOf/anyOf at the schema root (400, enforced by
//     the API; observed across github.com/anthropics/claude-code issues 4753, 10606).
//   - Anthropic strict tool use documents anyOf for null unions; acceptance of
//     JSON Schema type arrays under strict mode is not documented. The strict
//     subtest records the real behavior.
//   - OpenAI strict mode requires every property in "required" and documents
//     type unions with null as the optionality mechanism
//     (developers.openai.com/api/docs/guides/structured-outputs).

func requireLiveTest(t *testing.T, keyEnv string) string {
	t.Helper()
	// Always skipped: these tests call the live vendor APIs, and no automated
	// run may make network calls or spend API credits by accident. To run
	// locally, remove the next line and set the vendor API key.
	t.Skip("live vendor API test; remove this Skip line to run locally")

	key := os.Getenv(keyEnv)
	if key == "" {
		t.Skipf("%s is not set", keyEnv)
	}
	return key
}

// generatedCustomScalarSchema builds the schema for the canonical case this
// package exists to fix: a nullable custom scalar variable and a non-null Int.
func generatedCustomScalarSchema(t *testing.T) json.RawMessage {
	t.Helper()
	schemaSDL := `
		schema {
			query: Query
		}

		scalar String
		scalar Int
		scalar Cursor

		type Query {
			items(after: Cursor, first: Int!): String
		}
	`
	operation := `
		query Items($after: Cursor, $first: Int!) {
			items(after: $after, first: $first)
		}
	`
	definitionDoc, report := astparser.ParseGraphqlDocumentString(schemaSDL)
	require.False(t, report.HasErrors(), "schema parsing failed")
	operationDoc, report := astparser.ParseGraphqlDocumentString(operation)
	require.False(t, report.HasErrors(), "operation parsing failed")

	schema, err := BuildJsonSchema(&operationDoc, &definitionDoc)
	require.NoError(t, err)
	raw, err := json.Marshal(schema)
	require.NoError(t, err)
	return raw
}

func postJSON(t *testing.T, url string, headers map[string]string, body map[string]any) (int, string) {
	t.Helper()
	payload, err := json.Marshal(body)
	require.NoError(t, err)
	req, err := http.NewRequestWithContext(t.Context(), http.MethodPost, url, bytes.NewReader(payload))
	require.NoError(t, err)
	req.Header.Set("content-type", "application/json")
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	client := &http.Client{Timeout: 60 * time.Second}
	resp, err := client.Do(req)
	require.NoError(t, err)
	defer resp.Body.Close()
	respBody, err := io.ReadAll(resp.Body)
	require.NoError(t, err)
	return resp.StatusCode, string(respBody)
}

func anthropicProbe(t *testing.T, key string, strict bool, inputSchema json.RawMessage) (int, string) {
	t.Helper()
	tool := map[string]any{
		"name":         "activity_events",
		"description":  "list events",
		"input_schema": inputSchema,
	}
	headers := map[string]string{
		"x-api-key":         key,
		"anthropic-version": "2023-06-01",
	}
	if strict {
		tool["strict"] = true
		headers["anthropic-beta"] = "structured-outputs-2025-11-13"
	}
	return postJSON(t, "https://api.anthropic.com/v1/messages", headers, map[string]any{
		"model":      "claude-haiku-4-5",
		"max_tokens": 1,
		"messages":   []map[string]any{{"role": "user", "content": "hi"}},
		"tools":      []map[string]any{tool},
	})
}

func openAIProbe(t *testing.T, key string, strict bool, parameters json.RawMessage) (int, string) {
	t.Helper()
	return postJSON(t, "https://api.openai.com/v1/chat/completions", map[string]string{
		"authorization": "Bearer " + key,
	}, map[string]any{
		"model":      "gpt-4o-mini",
		"max_tokens": 1,
		"messages":   []map[string]any{{"role": "user", "content": "hi"}},
		"tools": []map[string]any{{
			"type": "function",
			"function": map[string]any{
				"name":        "activity_events",
				"description": "list events",
				"strict":      strict,
				"parameters":  parameters,
			},
		}},
	})
}

func TestAnthropicSchemaAcceptance(t *testing.T) {
	key := requireLiveTest(t, "ANTHROPIC_API_KEY")
	generated := generatedCustomScalarSchema(t)

	t.Run("generated schema with typed custom scalar is accepted", func(t *testing.T) {
		status, body := anthropicProbe(t, key, false, generated)
		require.Equal(t, http.StatusOK, status, "body: %s", body)
	})

	t.Run("generated schema with type-array nullability is accepted under strict mode", func(t *testing.T) {
		// Anthropic documents anyOf null unions for strict mode. Type arrays
		// are undocumented. This subtest records the real behavior. If it
		// fails, the emit profile needs an anyOf mode for Anthropic strict.
		status, body := anthropicProbe(t, key, true, generated)
		require.Equal(t, http.StatusOK, status, "body: %s", body)
	})

	t.Run("schema without a root type is rejected", func(t *testing.T) {
		// Negative control: proves these probes detect invalid schemas.
		// Verified live 2026-08-08: the API requires a root "type" field and
		// rejects a root-anyOf schema with "input_schema.type: Field required".
		bad := json.RawMessage(`{"anyOf":[{"type":"object"},{"type":"string"}]}`)
		status, body := anthropicProbe(t, key, false, bad)
		require.Equal(t, http.StatusBadRequest, status, "body: %s", body)
		require.Contains(t, body, "input_schema.type", "body: %s", body)
	})
}

func TestOpenAISchemaAcceptance(t *testing.T) {
	key := requireLiveTest(t, "OPENAI_API_KEY")
	generated := generatedCustomScalarSchema(t)

	t.Run("generated schema is accepted without strict mode", func(t *testing.T) {
		status, body := openAIProbe(t, key, false, generated)
		require.Equal(t, http.StatusOK, status, "body: %s", body)
	})

	t.Run("generated schema is rejected under strict mode because optional properties are not required", func(t *testing.T) {
		// OpenAI strict mode requires every property in "required" and models
		// optionality as a null type union. The generator keeps GraphQL
		// optionality (nullable properties stay out of "required"), so strict
		// mode rejects the schema today. This subtest documents that gap. An
		// all-required emit mode is future emit-profile work (ENG-9929).
		status, body := openAIProbe(t, key, true, generated)
		require.Equal(t, http.StatusBadRequest, status, "body: %s", body)
		require.Contains(t, body, "required", "body: %s", body)
	})
}

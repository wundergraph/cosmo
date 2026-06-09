package mcpserver

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/wundergraph/graphql-go-tools/v2/pkg/astprinter"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/introspection"
)

// introspectionQuery is the standard GraphQL introspection query as defined in the
// graphql-spec. Servers that support introspection respond with the full schema.
const introspectionQuery = `query IntrospectionQuery {
  __schema {
    queryType { name }
    mutationType { name }
    subscriptionType { name }
    types { ...FullType }
    directives {
      name description locations
      args { ...InputValue }
    }
  }
}
fragment FullType on __Type {
  kind name description
  fields(includeDeprecated: true) {
    name description
    args { ...InputValue }
    type { ...TypeRef }
    isDeprecated deprecationReason
  }
  inputFields { ...InputValue }
  interfaces { ...TypeRef }
  enumValues(includeDeprecated: true) {
    name description isDeprecated deprecationReason
  }
  possibleTypes { ...TypeRef }
}
fragment InputValue on __InputValue {
  name description
  type { ...TypeRef }
  defaultValue
}
fragment TypeRef on __Type {
  kind name
  ofType {
    kind name
    ofType {
      kind name
      ofType {
        kind name
        ofType {
          kind name
          ofType {
            kind name
            ofType {
              kind name
              ofType { kind name }
            }
          }
        }
      }
    }
  }
}`

// IntrospectUpstreamSDL runs the standard GraphQL introspection query against the given
// upstream URL and returns the result as SDL text. Extra headers are sent on the request.
//
// Used by upstream-bound MCP collections when no SDL file is provided — the schema is
// fetched from the live upstream and (optionally) cached to disk for subsequent runs.
func IntrospectUpstreamSDL(ctx context.Context, url string, extraHeaders map[string]string) (string, error) {
	body, err := json.Marshal(struct {
		Query         string `json:"query"`
		OperationName string `json:"operationName"`
	}{
		Query:         introspectionQuery,
		OperationName: "IntrospectionQuery",
	})
	if err != nil {
		return "", fmt.Errorf("encode introspection query: %w", err)
	}

	reqCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(reqCtx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return "", fmt.Errorf("build introspection request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	for k, v := range extraHeaders {
		req.Header.Set(k, v)
	}

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("introspect %s: %w", url, err)
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode/100 != 2 {
		raw, _ := io.ReadAll(resp.Body)
		return "", fmt.Errorf("introspect %s: status %d: %s", url, resp.StatusCode, truncate(string(raw), 256))
	}

	var envelope struct {
		Data   json.RawMessage `json:"data"`
		Errors []struct {
			Message string `json:"message"`
		} `json:"errors"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&envelope); err != nil {
		return "", fmt.Errorf("decode introspection response: %w", err)
	}
	if len(envelope.Errors) > 0 {
		msgs := make([]string, 0, len(envelope.Errors))
		for _, e := range envelope.Errors {
			msgs = append(msgs, e.Message)
		}
		return "", fmt.Errorf("upstream returned introspection errors: %s", strings.Join(msgs, "; "))
	}
	if len(envelope.Data) == 0 {
		return "", fmt.Errorf("upstream returned no introspection data (introspection may be disabled)")
	}

	conv := &introspection.JsonConverter{}
	doc, err := conv.GraphQLDocument(bytes.NewReader(envelope.Data))
	if err != nil {
		return "", fmt.Errorf("convert introspection JSON to schema: %w", err)
	}

	sdl, err := astprinter.PrintString(doc)
	if err != nil {
		return "", fmt.Errorf("print SDL: %w", err)
	}
	return sdl, nil
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "..."
}
package integration

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
)

// Example demonstrating the actual HTTP-level MCP authorization flow
// This shows how tokens are sent in HTTP headers, not JSON-RPC

type MCPClient struct {
	serverURL  string
	httpClient *http.Client
	sessionID  string // Persistent across requests
}

// Step 1: Initialize - First HTTP POST with initial token
func (c *MCPClient) Initialize(ctx context.Context, token string) error {
	// Create JSON-RPC initialize request
	jsonRPCRequest := map[string]interface{}{
		"jsonrpc": "2.0",
		"id":      1,
		"method":  "initialize",
		"params": map[string]interface{}{
			"protocolVersion": "2024-11-05",
			"clientInfo": map[string]string{
				"name":    "test-client",
				"version": "1.0.0",
			},
		},
	}

	// HTTP POST #1
	req, _ := http.NewRequestWithContext(ctx, "POST", c.serverURL, toReader(jsonRPCRequest))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", fmt.Sprintf("Bearer %s", token)) // ← Token in HTTP header

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close() //nolint:errcheck

	// Extract session ID from HTTP response headers
	c.sessionID = resp.Header.Get("Mcp-Session-Id") // ← Session ID from HTTP header

	fmt.Printf("✓ HTTP POST #1 - Initialize\n")
	fmt.Printf("  Request Header: Authorization: Bearer %s\n", token[:20]+"...")
	fmt.Printf("  Response Header: Mcp-Session-Id: %s\n", c.sessionID)

	return nil
}

// Step 2: Call tool with initial token (limited scopes)
func (c *MCPClient) CallToolWithLimitedScopes(ctx context.Context, token string) error {
	jsonRPCRequest := map[string]interface{}{
		"jsonrpc": "2.0",
		"id":      2,
		"method":  "tools/call",
		"params": map[string]interface{}{
			"name": "execute_operation_update_mood",
			"arguments": map[string]interface{}{
				"employeeID": 1,
				"mood":       "HAPPY",
			},
		},
	}

	// HTTP POST #2 - Same session, same token
	req, _ := http.NewRequestWithContext(ctx, "POST", c.serverURL, toReader(jsonRPCRequest))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", fmt.Sprintf("Bearer %s", token)) // ← Same token
	req.Header.Set("Mcp-Session-Id", c.sessionID)                    // ← Same session ID

	fmt.Printf("\n✓ HTTP POST #2 - Call tool (limited scopes)\n")
	fmt.Printf("  Request Header: Authorization: Bearer %s\n", token[:20]+"...")
	fmt.Printf("  Request Header: Mcp-Session-Id: %s\n", c.sessionID)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close() //nolint:errcheck

	// Parse JSON-RPC response
	var jsonRPCResp struct {
		Error *struct {
			Code    int    `json:"code"`
			Message string `json:"message"`
			Data    struct {
				RequiredScopes []string `json:"required_scopes"` // ← Scopes in JSON-RPC error data
			} `json:"data"`
		} `json:"error"`
	}
	json.NewDecoder(resp.Body).Decode(&jsonRPCResp) //nolint:errcheck

	if jsonRPCResp.Error != nil {
		fmt.Printf("  Response Body: JSON-RPC Error\n")
		fmt.Printf("    {\n")
		fmt.Printf("      \"error\": {\n")
		fmt.Printf("        \"code\": %d,\n", jsonRPCResp.Error.Code)
		fmt.Printf("        \"message\": \"%s\",\n", jsonRPCResp.Error.Message)
		fmt.Printf("        \"data\": {\n")
		fmt.Printf("          \"required_scopes\": %v\n", jsonRPCResp.Error.Data.RequiredScopes)
		fmt.Printf("        }\n")
		fmt.Printf("      }\n")
		fmt.Printf("    }\n")
		return fmt.Errorf("insufficient scopes: %v", jsonRPCResp.Error.Data.RequiredScopes)
	}

	return nil
}

// Step 3: Obtain new token (simulated OAuth flow)
func (c *MCPClient) ObtainNewToken(requiredScopes []string) string {
	// In reality, this would:
	// 1. Open browser to authorization server
	// 2. User consents to new scopes
	// 3. Exchange auth code for new access token
	// 4. Return new access token

	newToken := fmt.Sprintf("new-token-with-scopes-%v", requiredScopes)
	fmt.Printf("\n✓ OAuth Flow - Obtained new token\n")
	fmt.Printf("  Scopes: %v\n", requiredScopes)
	fmt.Printf("  New Token: %s\n", newToken[:30]+"...")
	return newToken
}

// Step 4: Retry tool call with upgraded token
func (c *MCPClient) CallToolWithUpgradedToken(ctx context.Context, newToken string) error {
	jsonRPCRequest := map[string]interface{}{
		"jsonrpc": "2.0",
		"id":      3,
		"method":  "tools/call",
		"params": map[string]interface{}{
			"name": "execute_operation_update_mood",
			"arguments": map[string]interface{}{
				"employeeID": 1,
				"mood":       "HAPPY",
			},
		},
	}

	// HTTP POST #3 - SAME session, DIFFERENT token
	req, _ := http.NewRequestWithContext(ctx, "POST", c.serverURL, toReader(jsonRPCRequest))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", fmt.Sprintf("Bearer %s", newToken)) // ← NEW token (different Authorization header)
	req.Header.Set("Mcp-Session-Id", c.sessionID)                       // ← SAME session ID

	fmt.Printf("\n✓ HTTP POST #3 - Call tool (upgraded scopes)\n")
	fmt.Printf("  Request Header: Authorization: Bearer %s ← DIFFERENT TOKEN\n", newToken[:30]+"...")
	fmt.Printf("  Request Header: Mcp-Session-Id: %s ← SAME SESSION\n", c.sessionID)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close() //nolint:errcheck

	fmt.Printf("  Response: %d OK\n", resp.StatusCode)
	fmt.Printf("  Response Body: JSON-RPC Success\n")

	return nil
}

func toReader(v interface{}) io.Reader {
	b, _ := json.Marshal(v)
	return bytes.NewReader(b)
}

// ExampleAuthorizationFlow demonstrates the complete flow
func ExampleAuthorizationFlow() {
	client := &MCPClient{
		serverURL:  "http://localhost:3000/mcp",
		httpClient: &http.Client{},
	}

	ctx := context.Background()

	// Step 1: Initialize with limited scopes
	initialToken := "token-with-scopes-mcp:tools:read"
	client.Initialize(ctx, initialToken) //nolint:errcheck

	// Step 2: Try to call write operation (will fail)
	err := client.CallToolWithLimitedScopes(ctx, initialToken)

	// Step 3: Get new token with required scopes
	if err != nil {
		newToken := client.ObtainNewToken([]string{"mcp:tools:write"})

		// Step 4: Retry with upgraded token (same session!)
		_ = client.CallToolWithUpgradedToken(ctx, newToken)
	}

	fmt.Printf("\n=== Summary ===\n")
	fmt.Printf("• Session persists via Mcp-Session-Id HTTP header\n")
	fmt.Printf("• Authorization changes via Authorization HTTP header\n")
	fmt.Printf("• Each JSON-RPC request is a separate HTTP POST\n")
	fmt.Printf("• HTTP headers carry auth/session, not JSON-RPC payload\n")
}

/*
Expected Output:

✓ HTTP POST #1 - Initialize
  Request Header: Authorization: Bearer token-with-scopes-mc...
  Response Header: Mcp-Session-Id: abc-123-def-456

✓ HTTP POST #2 - Call tool (limited scopes)
  Request Header: Authorization: Bearer token-with-scopes-mc...
  Request Header: Mcp-Session-Id: abc-123-def-456
  Response Body: JSON-RPC Error
    {
      "error": {
        "code": -32001,
        "message": "Insufficient permissions",
        "data": {
          "required_scopes": [mcp:tools:write]
        }
      }
    }

✓ OAuth Flow - Obtained new token
  Scopes: [mcp:tools:write]
  New Token: new-token-with-scopes-[mcp:too...

✓ HTTP POST #3 - Call tool (upgraded scopes)
  Request Header: Authorization: Bearer new-token-with-scopes-[mcp:too... ← DIFFERENT TOKEN
  Request Header: Mcp-Session-Id: abc-123-def-456 ← SAME SESSION
  Response: 200 OK
  Response Body: JSON-RPC Success

=== Summary ===
• Session persists via Mcp-Session-Id HTTP header
• Authorization changes via Authorization HTTP header
• Each JSON-RPC request is a separate HTTP POST
• HTTP headers carry auth/session, not JSON-RPC payload
*/

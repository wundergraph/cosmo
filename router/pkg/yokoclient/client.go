package yokoclient

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"go.uber.org/zap"
)

// maxResponseBytes limits the size of HTTP response bodies to prevent OOM from large responses.
const maxResponseBytes = 10 * 1024 * 1024 // 10MB

// QueryResult represents a generated GraphQL query from the Yoko API.
type QueryResult struct {
	Query       string         `json:"query"`
	Variables   map[string]any `json:"variables,omitempty"`
	Description string         `json:"description"`
}

// YokoClient is the interface for query generation.
type YokoClient interface {
	Generate(ctx context.Context, prompt string, schemaHash string) ([]QueryResult, error)
}

// AuthConfig holds authentication configuration for the Yoko API.
type AuthConfig struct {
	Type          string
	StaticToken   string
	TokenEndpoint string
	ClientID      string
	ClientSecret  string
}

// Client is the HTTP client for the Yoko REST API.
type Client struct {
	endpoint   string
	httpClient *http.Client
	auth       AuthConfig
	logger     *zap.Logger

	// JWT token cache for client credentials flow
	mu          sync.RWMutex
	cachedToken string
	tokenExpiry time.Time
}

// NewClient creates a new Yoko API client.
func NewClient(endpoint string, auth AuthConfig, timeout time.Duration, logger *zap.Logger) *Client {
	if logger == nil {
		logger = zap.NewNop()
	}
	return &Client{
		endpoint: strings.TrimRight(endpoint, "/"),
		httpClient: &http.Client{
			Timeout: timeout,
		},
		auth:   auth,
		logger: logger,
	}
}

type generateRequest struct {
	Prompt     string `json:"prompt"`
	SchemaHash string `json:"schema_hash"`
}

type generateResponse struct {
	Queries []QueryResult `json:"queries"`
}

type errorResponse struct {
	Error   string `json:"error"`
	Details string `json:"details,omitempty"`
}

// Generate calls the Yoko REST API to generate GraphQL queries from a prompt.
func (c *Client) Generate(ctx context.Context, prompt string, schemaHash string) ([]QueryResult, error) {
	if strings.TrimSpace(prompt) == "" {
		return nil, fmt.Errorf("prompt cannot be empty")
	}

	reqBody, err := json.Marshal(generateRequest{
		Prompt:     prompt,
		SchemaHash: schemaHash,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to marshal request: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, "POST", c.endpoint+"/v1/generate", bytes.NewReader(reqBody))
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")

	token, err := c.getToken(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to get auth token: %w", err)
	}
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("request failed: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()

	body, err := io.ReadAll(io.LimitReader(resp.Body, maxResponseBytes))
	if err != nil {
		return nil, fmt.Errorf("failed to read response: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		var errResp errorResponse
		if json.Unmarshal(body, &errResp) == nil && errResp.Error != "" {
			if errResp.Details != "" {
				return nil, fmt.Errorf("yoko API error (HTTP %d): %s — %s", resp.StatusCode, errResp.Error, errResp.Details)
			}
			return nil, fmt.Errorf("yoko API error (HTTP %d): %s", resp.StatusCode, errResp.Error)
		}
		return nil, fmt.Errorf("yoko API error (HTTP %d): %s", resp.StatusCode, string(body))
	}

	var genResp generateResponse
	if err := json.Unmarshal(body, &genResp); err != nil {
		return nil, fmt.Errorf("failed to parse response: %w", err)
	}

	return genResp.Queries, nil
}

// getToken returns the bearer token for the API request.
func (c *Client) getToken(ctx context.Context) (string, error) {
	switch c.auth.Type {
	case "static", "":
		return c.auth.StaticToken, nil
	case "jwt", "cosmo":
		return c.getJWTToken(ctx)
	default:
		return "", fmt.Errorf("unsupported auth type: %s", c.auth.Type)
	}
}

// getJWTToken fetches or returns a cached JWT token via client credentials.
func (c *Client) getJWTToken(ctx context.Context) (string, error) {
	c.mu.RLock()
	if c.cachedToken != "" && time.Now().Before(c.tokenExpiry) {
		token := c.cachedToken
		c.mu.RUnlock()
		return token, nil
	}
	c.mu.RUnlock()

	c.mu.Lock()
	defer c.mu.Unlock()

	// Double-check after acquiring write lock
	if c.cachedToken != "" && time.Now().Before(c.tokenExpiry) {
		return c.cachedToken, nil
	}

	if c.auth.TokenEndpoint == "" {
		return "", fmt.Errorf("JWT auth requires a token endpoint")
	}

	formData := url.Values{
		"grant_type":    {"client_credentials"},
		"client_id":     {c.auth.ClientID},
		"client_secret": {c.auth.ClientSecret},
	}

	req, err := http.NewRequestWithContext(ctx, "POST", c.auth.TokenEndpoint, strings.NewReader(formData.Encode()))
	if err != nil {
		return "", fmt.Errorf("failed to create token request: %w", err)
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("token request failed: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, maxResponseBytes))
		return "", fmt.Errorf("token request failed (HTTP %d): %s", resp.StatusCode, string(body))
	}

	var tokenResp struct {
		AccessToken string `json:"access_token"`
		ExpiresIn   int    `json:"expires_in"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, maxResponseBytes)).Decode(&tokenResp); err != nil {
		return "", fmt.Errorf("failed to parse token response: %w", err)
	}

	if tokenResp.AccessToken == "" {
		return "", fmt.Errorf("token endpoint returned empty access_token")
	}

	c.cachedToken = tokenResp.AccessToken
	// Expire 30 seconds early to avoid edge cases, but never negative
	earlyExpiry := max(time.Duration(tokenResp.ExpiresIn)*time.Second-30*time.Second, 0)
	c.tokenExpiry = time.Now().Add(earlyExpiry)

	return c.cachedToken, nil
}

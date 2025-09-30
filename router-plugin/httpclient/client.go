package httpclient

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"

	"github.com/hashicorp/go-retryablehttp"
)

// Client is a wrapper around http.Client with additional functionality
type Client struct {
	client       *http.Client
	baseURL      string
	headers      map[string]string
	timeout      time.Duration
	middlewares  []Middleware
	retryOptions RetryOptions
}

// ClientOption is a function that configures a Client
type ClientOption func(*Client)

// Middleware is a function that wraps an HTTP request
type Middleware func(req *http.Request) (*http.Request, error)

// Response is a wrapper around http.Response with additional functionality
type Response struct {
	StatusCode int
	Headers    http.Header
	Body       []byte
}

// New creates a new HTTP client with the given options
func New(options ...ClientOption) *Client {
	c := &Client{
		client:       http.DefaultClient,
		headers:      make(map[string]string),
		timeout:      30 * time.Second,
		middlewares:  []Middleware{},
		retryOptions: DefaultRetryOptions(),
	}

	for _, option := range options {
		option(c)
	}

	c.client.Timeout = c.timeout

	return c
}

// WithBaseURL sets the base URL for the client
func WithBaseURL(url string) ClientOption {
	return func(c *Client) {
		c.baseURL = url
	}
}

// WithTimeout sets the timeout for the client
func WithTimeout(timeout time.Duration) ClientOption {
	return func(c *Client) {
		c.timeout = timeout
	}
}

// WithHeader adds a header to all requests
func WithHeader(key, value string) ClientOption {
	return func(c *Client) {
		c.headers[key] = value
	}
}

// WithHeaders adds multiple headers to all requests
func WithHeaders(headers map[string]string) ClientOption {
	return func(c *Client) {
		for key, value := range headers {
			c.headers[key] = value
		}
	}
}

// WithMiddleware adds a middleware to the client
func WithMiddleware(middleware Middleware) ClientOption {
	return func(c *Client) {
		c.middlewares = append(c.middlewares, middleware)
	}
}

// Get sends a GET request and returns the response
func (c *Client) Get(ctx context.Context, path string, options ...RequestOption) (*Response, error) {
	return c.Request(ctx, http.MethodGet, path, nil, options...)
}

// Post sends a POST request and returns the response
func (c *Client) Post(ctx context.Context, path string, body interface{}, options ...RequestOption) (*Response, error) {
	return c.Request(ctx, http.MethodPost, path, body, options...)
}

// Put sends a PUT request and returns the response
func (c *Client) Put(ctx context.Context, path string, body interface{}, options ...RequestOption) (*Response, error) {
	return c.Request(ctx, http.MethodPut, path, body, options...)
}

// Delete sends a DELETE request and returns the response
func (c *Client) Delete(ctx context.Context, path string, options ...RequestOption) (*Response, error) {
	return c.Request(ctx, http.MethodDelete, path, nil, options...)
}

// Patch sends a PATCH request and returns the response
func (c *Client) Patch(ctx context.Context, path string, body interface{}, options ...RequestOption) (*Response, error) {
	return c.Request(ctx, http.MethodPatch, path, body, options...)
}

// Request sends an HTTP request and returns the response
func (c *Client) Request(ctx context.Context, method, path string, body interface{}, options ...RequestOption) (*Response, error) {
	var reqBody io.Reader
	if body != nil {
		jsonBody, err := json.Marshal(body)
		if err != nil {
			return nil, fmt.Errorf("error marshaling request body: %w", err)
		}
		reqBody = bytes.NewBuffer(jsonBody)
	}

	url := path
	if c.baseURL != "" {
		url = c.baseURL + path
	}

	// Use the retryable client if enabled
	if c.retryOptions.Enabled {
		return c.doRequestWithRetry(ctx, method, url, reqBody, body != nil, options...)
	}

	// Otherwise use the standard client
	return c.doRequest(ctx, method, url, reqBody, body != nil, options...)
}

// doRequest performs the HTTP request without retries
func (c *Client) doRequest(ctx context.Context, method, url string, body io.Reader, hasBody bool, options ...RequestOption) (*Response, error) {
	req, err := http.NewRequestWithContext(ctx, method, url, body)
	if err != nil {
		return nil, fmt.Errorf("error creating request: %w", err)
	}

	// Add default headers
	for key, value := range c.headers {
		req.Header.Set(key, value)
	}

	// Apply request options
	reqOpts := &requestOptions{}
	for _, option := range options {
		option(reqOpts)
	}

	// Add request-specific headers
	for key, value := range reqOpts.headers {
		req.Header.Set(key, value)
	}

	// Set default Content-Type if body exists and Content-Type is not set
	if hasBody && req.Header.Get("Content-Type") == "" {
		req.Header.Set("Content-Type", "application/json")
	}

	// Apply middlewares
	for _, middleware := range c.middlewares {
		req, err = middleware(req)
		if err != nil {
			return nil, fmt.Errorf("middleware error: %w", err)
		}
	}

	resp, err := c.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("error executing request: %w", err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("error reading response body: %w", err)
	}

	return &Response{
		StatusCode: resp.StatusCode,
		Headers:    resp.Header,
		Body:       respBody,
	}, nil
}

// doRequestWithRetry performs the HTTP request with retry capability
func (c *Client) doRequestWithRetry(ctx context.Context, method, url string, body io.Reader, hasBody bool, options ...RequestOption) (*Response, error) {
	// Create a retryable client
	retryClient := createRetryableClient(c.client, c.retryOptions)

	// Create a retryable request
	var retryReq *retryablehttp.Request
	var err error

	if body != nil {
		// For requests with body, we need to handle the body rewind
		if readSeeker, ok := body.(io.ReadSeeker); ok {
			// If body is a ReadSeeker, use it directly
			retryReq, err = retryablehttp.NewRequest(method, url, readSeeker)
		} else {
			// Otherwise, read the body into memory
			bodyBytes, readErr := io.ReadAll(body)
			if readErr != nil {
				return nil, fmt.Errorf("error reading request body: %w", readErr)
			}
			retryReq, err = retryablehttp.NewRequest(method, url, bodyBytes)
		}
	} else {
		retryReq, err = retryablehttp.NewRequest(method, url, nil)
	}

	if err != nil {
		return nil, fmt.Errorf("error creating retryable request: %w", err)
	}

	// Set context
	retryReq = retryReq.WithContext(ctx)

	// Add default headers
	for key, value := range c.headers {
		retryReq.Header.Set(key, value)
	}

	// Apply request options
	reqOpts := &requestOptions{}
	for _, option := range options {
		option(reqOpts)
	}

	// Add request-specific headers
	for key, value := range reqOpts.headers {
		retryReq.Header.Set(key, value)
	}

	// Set default Content-Type if body exists and Content-Type is not set
	if hasBody && retryReq.Header.Get("Content-Type") == "" {
		retryReq.Header.Set("Content-Type", "application/json")
	}

	// Apply middlewares to the underlying request
	httpReq := retryReq.Request
	for _, middleware := range c.middlewares {
		httpReq, err = middleware(httpReq)
		if err != nil {
			return nil, fmt.Errorf("middleware error: %w", err)
		}
	}
	// Replace the request with the modified one
	retryReq.Request = httpReq

	// Execute the request
	resp, err := retryClient.Do(retryReq)
	if err != nil {
		return nil, fmt.Errorf("error executing request: %w", err)
	}
	defer resp.Body.Close()

	// Read the response body
	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("error reading response body: %w", err)
	}

	return &Response{
		StatusCode: resp.StatusCode,
		Headers:    resp.Header,
		Body:       respBody,
	}, nil
}

// RequestOption is a function that configures a request
type RequestOption func(*requestOptions)

type requestOptions struct {
	headers map[string]string
}

// WithRequestHeader adds a header to a specific request
func WithRequestHeader(key, value string) RequestOption {
	return func(opts *requestOptions) {
		if opts.headers == nil {
			opts.headers = make(map[string]string)
		}
		opts.headers[key] = value
	}
}

// Unmarshal decodes the response body into the given value
func (r *Response) Unmarshal(v interface{}) error {
	return json.Unmarshal(r.Body, v)
}

// UnmarshalTo is a generic helper to decode the response into a struct
func UnmarshalTo[T any](response *Response) (T, error) {
	var result T
	err := response.Unmarshal(&result)
	return result, err
}

// String returns the response body as a string
func (r *Response) String() string {
	return string(r.Body)
}

// IsSuccess returns true if the response status code is in the 2xx range
func (r *Response) IsSuccess() bool {
	return r.StatusCode >= 200 && r.StatusCode < 300
}

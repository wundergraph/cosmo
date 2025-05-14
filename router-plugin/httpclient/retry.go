package httpclient

import (
	"net/http"
	"time"

	"github.com/hashicorp/go-retryablehttp"
)

// Default retry values
const (
	DefaultRetryMax     = 3
	DefaultRetryWaitMin = 1 * time.Second
	DefaultRetryWaitMax = 30 * time.Second
)

// RetryOptions configures the retry behavior of the client
type RetryOptions struct {
	// Enabled determines if retries are enabled
	Enabled bool

	// Max is the maximum number of retries
	Max int

	// WaitMin is the minimum time to wait between retries
	WaitMin time.Duration

	// WaitMax is the maximum time to wait between retries
	WaitMax time.Duration

	// CheckRetry specifies a policy for handling retries
	CheckRetry retryablehttp.CheckRetry
}

// DefaultRetryOptions returns the default retry options
func DefaultRetryOptions() RetryOptions {
	return RetryOptions{
		Enabled:    true,
		Max:        DefaultRetryMax,
		WaitMin:    DefaultRetryWaitMin,
		WaitMax:    DefaultRetryWaitMax,
		CheckRetry: retryablehttp.DefaultRetryPolicy,
	}
}

// WithRetry sets the retry options for the client
func WithRetry(opts RetryOptions) ClientOption {
	return func(c *Client) {
		c.retryOptions = opts
	}
}

// WithRetryMax sets the maximum number of retries for the client
func WithRetryMax(max int) ClientOption {
	return func(c *Client) {
		c.retryOptions.Max = max
		c.retryOptions.Enabled = true
	}
}

// WithoutRetry disables retries for the client
func WithoutRetry() ClientOption {
	return func(c *Client) {
		c.retryOptions.Enabled = false
	}
}

// WithRetryPolicy sets a custom retry policy for the client
func WithRetryPolicy(policy retryablehttp.CheckRetry) ClientOption {
	return func(c *Client) {
		c.retryOptions.CheckRetry = policy
		c.retryOptions.Enabled = true
	}
}

// createRetryableClient creates a retryable client from the standard client
func createRetryableClient(client *http.Client, opts RetryOptions) *retryablehttp.Client {
	retryClient := retryablehttp.NewClient()

	// Copy settings from the standard client
	retryClient.HTTPClient = client

	// Apply retry options
	retryClient.RetryMax = opts.Max
	retryClient.RetryWaitMin = opts.WaitMin
	retryClient.RetryWaitMax = opts.WaitMax
	retryClient.CheckRetry = opts.CheckRetry

	// Disable logging by default
	retryClient.Logger = nil

	return retryClient
}

package httpclient

import (
	"net/http"
	"time"

	"github.com/hashicorp/go-retryablehttp"
	"go.uber.org/zap"
)

// NewRetryableHTTPClient returns a stdlib *http.Client with retry capabilities.
func NewRetryableHTTPClient(logger *zap.Logger) *http.Client {
	retryClient := retryablehttp.NewClient()
	retryClient.RetryWaitMax = 30 * time.Second
	retryClient.RetryMax = 5
	retryClient.Backoff = retryablehttp.DefaultBackoff
	retryClient.Logger = nil
	retryClient.ErrorHandler = retryablehttp.PassthroughErrorHandler
	retryClient.RequestLogHook = func(_ retryablehttp.Logger, _ *http.Request, retry int) {
		if retry > 0 {
			logger.Info("Retry request", zap.Int("retry", retry))
		}
	}

	return retryClient.StandardClient()
}

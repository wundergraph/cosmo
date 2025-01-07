package httpclient

import (
	"github.com/hashicorp/go-retryablehttp"
	"go.uber.org/zap"
	"net/http"
	"time"
)

func NewRetryableHTTPClient(logger *zap.Logger) *http.Client {
	retryClient := retryablehttp.NewClient()
	retryClient.RetryWaitMax = 30 * time.Second
	retryClient.RetryMax = 5
	retryClient.Backoff = retryablehttp.DefaultBackoff
	retryClient.Logger = nil
	retryClient.ErrorHandler = func(resp *http.Response, err error, numTries int) (*http.Response, error) {
		logger.Error("Request failed", zap.Error(err), zap.Int("numTries", numTries))
		return resp, err
	}
	retryClient.RequestLogHook = func(_ retryablehttp.Logger, _ *http.Request, retry int) {
		if retry > 0 {
			logger.Info("Retry request", zap.Int("retry", retry))
		}
	}

	return retryClient.StandardClient()
}

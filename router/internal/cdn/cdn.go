package cdn

import (
	"github.com/hashicorp/go-retryablehttp"
	"go.uber.org/zap"
	"net/http"
	"time"
)

func newRetryableHTTPClient(logger *zap.Logger) *http.Client {
	retryClient := retryablehttp.NewClient()
	retryClient.RetryWaitMax = 60 * time.Second
	retryClient.RetryMax = 5
	retryClient.Backoff = retryablehttp.DefaultBackoff
	retryClient.Logger = nil
	retryClient.RequestLogHook = func(_ retryablehttp.Logger, _ *http.Request, retry int) {
		if retry > 0 {
			logger.Info("Fetch router config from CDN", zap.Int("retry", retry))
		}
	}

	return retryClient.StandardClient()
}

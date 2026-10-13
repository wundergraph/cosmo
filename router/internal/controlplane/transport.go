package controlplane

import (
	"fmt"
	"net/http"
	"time"

	"github.com/hashicorp/go-retryablehttp"
	"go.uber.org/zap"
)

const (
	retryWaitMax = 15 * time.Second
	retryMax     = 3
)

type bearerAuthTransport struct {
	token string
	next  http.RoundTripper
}

// NewTransport creates an authenticated, retrying transport for control plane requests.
func NewTransport(token string, logger *zap.Logger) (http.RoundTripper, error) {
	if token == "" {
		return nil, fmt.Errorf("graph api token is required for controlplane requests")
	}

	if logger == nil {
		logger = zap.NewNop()
	}

	retryClient := retryablehttp.NewClient()
	retryClient.RetryWaitMax = retryWaitMax
	retryClient.RetryMax = retryMax
	retryClient.Backoff = retryablehttp.DefaultBackoff
	retryClient.Logger = nil
	retryClient.RequestLogHook = func(_ retryablehttp.Logger, _ *http.Request, retry int) {
		if retry > 0 {
			logger.Info("Retry controlplane request", zap.Int("retry", retry))
		}
	}

	return newBearerAuthTransport(token, retryClient.StandardClient().Transport), nil
}

func newBearerAuthTransport(token string, next http.RoundTripper) http.RoundTripper {
	return &bearerAuthTransport{
		token: token,
		next:  next,
	}
}

func (t *bearerAuthTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	req = req.Clone(req.Context())
	req.Header.Set("Authorization", "Bearer "+t.token)

	return t.next.RoundTrip(req)
}

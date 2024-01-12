package cdn

import (
	"fmt"
	"github.com/golang-jwt/jwt/v5"
	"github.com/hashicorp/go-retryablehttp"
	"go.uber.org/zap"
	"net/http"
	"time"
)

const (
	FederatedGraphIDClaim = "federated_graph_id"
	OrganizationIDClaim   = "organization_id"
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

func parseCDNToken(token string) (federatedGraphID string, organizationID string, err error) {

	if token == "" {
		return "", "", fmt.Errorf("invalid CDN authentication token %q", token)
	}

	// Don't validate the token here, just extract the claims
	jwtParser := new(jwt.Parser)
	claims := make(jwt.MapClaims)

	_, _, err = jwtParser.ParseUnverified(token, claims)
	if err != nil {
		return "", "", fmt.Errorf("invalid CDN authentication token %q: %w", token, err)
	}

	federatedGraphIDValue := claims[FederatedGraphIDClaim]
	if federatedGraphIDValue == nil {
		return "", "", fmt.Errorf("invalid CDN authentication token claims, missing %q", FederatedGraphIDClaim)
	}

	var ok bool
	federatedGraphID, ok = federatedGraphIDValue.(string)
	if !ok {
		return "", "", fmt.Errorf("invalid CDN authentication token claims, %q is not a string, it's %T", FederatedGraphIDClaim, federatedGraphIDValue)
	}

	organizationIDValue := claims[OrganizationIDClaim]
	if organizationIDValue == nil {
		return "", "", fmt.Errorf("invalid CDN authentication token claims, missing %q", OrganizationIDClaim)
	}

	organizationID, ok = organizationIDValue.(string)
	if !ok {
		return "", "", fmt.Errorf("invalid CDN authentication token claims, %q is not a string, it's %T", OrganizationIDClaim, organizationIDValue)
	}

	return federatedGraphID, organizationID, nil
}

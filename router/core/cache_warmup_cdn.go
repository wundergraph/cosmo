package core

import (
	"compress/gzip"
	"context"
	"errors"
	"fmt"
	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
	"google.golang.org/protobuf/encoding/protojson"
	"io"
	"net/http"
	"net/url"

	"github.com/wundergraph/cosmo/router/internal/httpclient"
	"github.com/wundergraph/cosmo/router/internal/jwt"
	"go.opentelemetry.io/otel/codes"
	semconv12 "go.opentelemetry.io/otel/semconv/v1.12.0"
	semconv "go.opentelemetry.io/otel/semconv/v1.17.0"
	"go.opentelemetry.io/otel/trace"
	"go.uber.org/zap"
)

var _ CacheWarmupSource = (*CDNSource)(nil)

type CDNSource struct {
	cdnURL              *url.URL
	cdnFallbackURL      *url.URL
	authenticationToken string
	// federatedGraphID is the ID of the federated graph that was obtained
	// from the token, already url-escaped
	federatedGraphID string
	// organizationID is the ID of the organization for this graph that was obtained
	// from the token, already url-escaped
	organizationID string
	httpClient     *http.Client
}

func NewCDNSource(endpoint, fallbackEndpoint, token string, logger *zap.Logger) (*CDNSource, error) {
	u, err := url.Parse(endpoint)
	if err != nil {
		return nil, err
	}

	var fu *url.URL = nil
	if fallbackEndpoint != "" {
		fu, err = url.Parse(fallbackEndpoint)
		if err != nil {
			return nil, err
		}
	}

	claims, err := jwt.ExtractFederatedGraphTokenClaims(token)
	if err != nil {
		return nil, err
	}

	if logger == nil {
		logger = zap.NewNop()
	}

	return &CDNSource{
		cdnURL:              u,
		cdnFallbackURL:      fu,
		authenticationToken: token,
		federatedGraphID:    claims.FederatedGraphID,
		organizationID:      claims.OrganizationID,
		httpClient:          httpclient.NewRetryableHTTPClient(logger),
	}, nil
}

func (c *CDNSource) LoadItems(ctx context.Context, log *zap.Logger) ([]*nodev1.Operation, error) {
	span := trace.SpanFromContext(ctx)
	defer span.End()

	resp, body, err := c.fetchOperationsJSON(ctx, log, c.cdnURL)

	if err != nil && c.cdnFallbackURL != nil && httpclient.IsCDNFallbackEligible(resp, err) {
		log.Warn("Primary CDN failed, attempting fallback CDN",
			zap.Error(err),
			zap.String("fallback_url", c.cdnFallbackURL.String()),
		)
		span.AddEvent("cdn.fallback", trace.WithAttributes(
			semconv.HTTPURL(c.cdnFallbackURL.String()),
		))
		_, body, err = c.fetchOperationsJSON(ctx, log, c.cdnFallbackURL)
	}

	if err != nil {
		return nil, err
	}
	if body == nil {
		return nil, nil
	}

	var warmupOperations nodev1.CacheWarmerOperations
	unmarshalOpts := protojson.UnmarshalOptions{DiscardUnknown: true}
	if err := unmarshalOpts.Unmarshal(body, &warmupOperations); err != nil {
		return nil, err
	}

	return warmupOperations.GetOperations(), nil
}

func (c *CDNSource) fetchOperationsJSON(ctx context.Context, log *zap.Logger, baseURL *url.URL) (*http.Response, []byte, error) {
	span := trace.SpanFromContext(ctx)

	operationsPath := fmt.Sprintf("/%s/%s/cache_warmup/operations.json", c.organizationID, c.federatedGraphID)
	operationURL := baseURL.ResolveReference(&url.URL{Path: operationsPath})
	log.Debug("Loading cache warmup config", zap.String("url", operationURL.String()))

	req, err := http.NewRequestWithContext(ctx, "GET", operationURL.String(), nil)
	if err != nil {
		return nil, nil, err
	}

	span.SetAttributes(
		semconv.HTTPURL(req.URL.String()),
		semconv.HTTPMethod(http.MethodGet),
		semconv12.HTTPHostKey.String(req.Host),
	)

	req.Header.Set("Content-Type", "application/json; charset=UTF-8")
	req.Header.Add("Authorization", "Bearer "+c.authenticationToken)
	req.Header.Set("Accept-Encoding", "gzip")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, nil, err
	}
	defer func() { _ = resp.Body.Close() }()

	span.SetAttributes(semconv.HTTPStatusCode(resp.StatusCode))

	if resp.StatusCode != http.StatusOK {
		span.SetStatus(codes.Error, fmt.Sprintf("unexpected status code when loading persisted operation, statusCode: %d", resp.StatusCode))

		if resp.StatusCode == http.StatusNotFound {
			log.Debug("Cache warmup config not found", zap.String("url", operationURL.String()))
			return resp, nil, nil
		}
		if resp.StatusCode == http.StatusUnauthorized {
			return resp, nil, errors.New("could not authenticate against CDN")
		}
		if resp.StatusCode == http.StatusBadRequest {
			return resp, nil, errors.New("bad request")
		}
		return resp, nil, fmt.Errorf("unexpected status code when loading persisted operation, statusCode: %d", resp.StatusCode)
	}

	body, err := c.readResponse(resp)
	if err != nil {
		return resp, nil, err
	}

	return resp, body, nil
}

func (c *CDNSource) readResponse(resp *http.Response) ([]byte, error) {
	var reader io.Reader = resp.Body
	if resp.Header.Get("Content-Encoding") == "gzip" {
		r, err := gzip.NewReader(resp.Body)
		if err != nil {
			return nil, fmt.Errorf("could not create gzip reader: %w", err)
		}

		defer func() { _ = r.Close() }()
		reader = r
	}

	body, err := io.ReadAll(reader)
	if err != nil {
		return nil, fmt.Errorf("could not read response body: %w", err)
	}

	if len(body) == 0 {
		return nil, errors.New("empty response body")
	}

	return body, nil
}

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
	authenticationToken string
	// federatedGraphID is the ID of the federated graph that was obtained
	// from the token, already url-escaped
	federatedGraphID string
	// organizationID is the ID of the organization for this graph that was obtained
	// from the token, already url-escaped
	organizationID string
	httpClient     *http.Client
}

func NewCDNSource(endpoint, token string, logger *zap.Logger) (*CDNSource, error) {
	u, err := url.Parse(endpoint)
	if err != nil {
		return nil, err
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
		authenticationToken: token,
		federatedGraphID:    claims.FederatedGraphID,
		organizationID:      claims.OrganizationID,
		httpClient:          httpclient.NewRetryableHTTPClient(logger),
	}, nil
}

func (c *CDNSource) LoadItems(ctx context.Context, log *zap.Logger) ([]*nodev1.Operation, error) {
	span := trace.SpanFromContext(ctx)
	defer span.End()

	operationsPath := fmt.Sprintf("/%s/%s/cache_warmup/operations.json", c.organizationID, c.federatedGraphID)

	operationURL := c.cdnURL.ResolveReference(&url.URL{Path: operationsPath})
	log.Debug("Loading cache warmup config", zap.String("url", operationURL.String()))

	req, err := http.NewRequestWithContext(ctx, "GET", operationURL.String(), nil)
	if err != nil {
		return nil, err
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
		return nil, err
	}
	defer func() { _ = resp.Body.Close() }()

	span.SetAttributes(semconv.HTTPStatusCode(resp.StatusCode))

	if resp.StatusCode != http.StatusOK {
		span.SetStatus(codes.Error, fmt.Sprintf("unexpected status code when loading persisted operation, statusCode: %d", resp.StatusCode))

		if resp.StatusCode == http.StatusNotFound {
			log.Debug("Cache warmup config not found", zap.String("url", operationURL.String()))
			return nil, nil
		}
		if resp.StatusCode == http.StatusUnauthorized {
			return nil, errors.New("could not authenticate against CDN")
		}
		if resp.StatusCode == http.StatusBadRequest {
			return nil, errors.New("bad request")
		}
		return nil, fmt.Errorf("unexpected status code when loading persisted operation, statusCode: %d", resp.StatusCode)
	}

	body, err := c.readResponse(resp)
	if err != nil {
		return nil, err
	}

	var warmupOperations nodev1.CacheWarmerOperations
	unmarshalOpts := protojson.UnmarshalOptions{DiscardUnknown: true}
	if err := unmarshalOpts.Unmarshal(body, &warmupOperations); err != nil {
		return nil, err
	}

	return warmupOperations.GetOperations(), nil
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

package cdn

import (
	"compress/gzip"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"time"

	"github.com/wundergraph/cosmo/router/internal/httpclient"
	"github.com/wundergraph/cosmo/router/internal/jwt"
	"github.com/wundergraph/cosmo/router/internal/persistedoperation"
	"github.com/wundergraph/cosmo/router/internal/persistedoperation/pqlmanifest"
	"go.opentelemetry.io/otel/codes"
	semconv12 "go.opentelemetry.io/otel/semconv/v1.12.0"
	semconv "go.opentelemetry.io/otel/semconv/v1.17.0"
	"go.opentelemetry.io/otel/trace"
	"go.uber.org/zap"
)

type Options struct {
	Logger           *zap.Logger
	FallbackEndpoint string
}

// Deprecated: The CDN-based persisted operation Client is deprecated.
// The router now downloads all operations at once via the PQL manifest, avoiding
// per-request CDN latency. This Client is kept for backward compatibility.
var _ persistedoperation.StorageClient = (*Client)(nil)

type Client struct {
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
	logger         *zap.Logger
	fetcher        *pqlmanifest.Fetcher
}

// NewClient creates a new CDN Client. URL is the URL of the CDN.
// Token is the token used to authenticate with the CDN, the same as the GRAPH_API_TOKEN
func NewClient(endpoint string, token string, opts Options) (*Client, error) {
	u, err := url.Parse(endpoint)
	if err != nil {
		return nil, fmt.Errorf("invalid CDN URL %q: %w", endpoint, err)
	}

	var fu *url.URL
	if opts.FallbackEndpoint != "" {
		fu, err = url.Parse(opts.FallbackEndpoint)
		if err != nil {
			return nil, fmt.Errorf("invalid CDN fallback URL %q: %w", opts.FallbackEndpoint, err)
		}
	}

	if opts.Logger == nil {
		opts.Logger = zap.NewNop()
	}

	claims, err := jwt.ExtractFederatedGraphTokenClaims(token)
	if err != nil {
		return nil, err
	}

	logger := opts.Logger.With(
		zap.String("component", "persisted_operations_client"),
		zap.String("url", endpoint),
	)

	fetcher, err := pqlmanifest.NewFetcher(endpoint, opts.FallbackEndpoint, token, logger)
	if err != nil {
		return nil, fmt.Errorf("failed to create manifest fetcher: %w", err)
	}

	return &Client{
		cdnURL:              u,
		cdnFallbackURL:      fu,
		authenticationToken: token,
		federatedGraphID:    url.PathEscape(claims.FederatedGraphID),
		organizationID:      url.PathEscape(claims.OrganizationID),
		httpClient:          httpclient.NewRetryableHTTPClient(logger),
		logger:              logger,
		fetcher:             fetcher,
	}, nil
}

func (cdn *Client) PersistedOperation(ctx context.Context, clientName string, sha256Hash string) ([]byte, error) {
	content, err := cdn.persistedOperation(ctx, clientName, sha256Hash)
	if err != nil {
		return nil, err
	}

	return content, nil
}

func (cdn *Client) persistedOperation(ctx context.Context, clientName string, sha256Hash string) ([]byte, error) {
	span := trace.SpanFromContext(ctx)

	resp, body, err := cdn.doPersistedOperation(ctx, clientName, sha256Hash, cdn.cdnURL)

	if err != nil && cdn.cdnFallbackURL != nil && httpclient.IsCDNFallbackEligible(resp, err) {
		cdn.logger.Warn("Primary CDN failed, attempting fallback CDN for persisted operation",
			zap.Error(err),
			zap.String("fallback_url", cdn.cdnFallbackURL.String()),
			zap.String("client_name", clientName),
			zap.String("sha256_hash", sha256Hash),
		)
		span.AddEvent("cdn.fallback", trace.WithAttributes(
			semconv.HTTPURL(cdn.cdnFallbackURL.String()),
		))
		_, body, err = cdn.doPersistedOperation(ctx, clientName, sha256Hash, cdn.cdnFallbackURL)
	}

	if err != nil {
		return nil, err
	}

	var po persistedoperation.PersistedOperation
	if err := json.Unmarshal(body, &po); err != nil {
		return nil, err
	}

	return []byte(po.Body), nil
}

func (cdn *Client) doPersistedOperation(ctx context.Context, clientName string, sha256Hash string, baseURL *url.URL) (*http.Response, []byte, error) {
	span := trace.SpanFromContext(ctx)

	operationPath := fmt.Sprintf("/%s/%s/operations/%s/%s.json",
		cdn.organizationID,
		cdn.federatedGraphID,
		url.PathEscape(clientName),
		url.PathEscape(sha256Hash))
	operationURL := baseURL.ResolveReference(&url.URL{Path: operationPath})

	req, err := http.NewRequestWithContext(ctx, "GET", operationURL.String(), nil)
	if err != nil {
		return nil, nil, err
	}

	span.SetAttributes(
		semconv.HTTPURL(req.URL.String()),
		semconv.HTTPMethod(http.MethodGet),
		semconv12.HTTPHostKey.String(req.Host),
	)

	cdn.setCDNHeaders(req)

	resp, err := cdn.httpClient.Do(req)
	if err != nil {
		return nil, nil, err
	}
	defer func() {
		_ = resp.Body.Close()
	}()

	span.SetAttributes(semconv.HTTPStatusCode(resp.StatusCode))

	if resp.StatusCode != http.StatusOK {
		span.SetStatus(codes.Error, fmt.Sprintf("unexpected status code when loading persisted operation, statusCode: %d", resp.StatusCode))

		if resp.StatusCode == http.StatusNotFound {
			return resp, nil, &persistedoperation.PersistentOperationNotFoundError{
				ClientName: clientName,
				Sha256Hash: sha256Hash,
			}
		}
		if resp.StatusCode == http.StatusUnauthorized {
			return resp, nil, errors.New("could not authenticate against CDN")
		}
		if resp.StatusCode == http.StatusBadRequest {
			return resp, nil, errors.New("bad request")
		}
		return resp, nil, fmt.Errorf("unexpected status code when loading persisted operation, statusCode: %d", resp.StatusCode)
	}

	reader, cleanup, err := gzipAwareReader(resp)
	if err != nil {
		return resp, nil, err
	}
	defer cleanup()

	body, err := io.ReadAll(reader)
	if err != nil {
		return resp, nil, errors.New("could not read the response body. " + err.Error())
	}

	return resp, body, nil
}

// setCDNHeaders sets the common headers for CDN requests.
func (cdn *Client) setCDNHeaders(req *http.Request) {
	req.Header.Set("Content-Type", "application/json; charset=UTF-8")
	req.Header.Add("Authorization", "Bearer "+cdn.authenticationToken)
	req.Header.Set("Accept-Encoding", "gzip")
}

// gzipAwareReader returns a reader that transparently decompresses the response body
// if the response is gzip-encoded, along with a cleanup function that must be deferred.
func gzipAwareReader(resp *http.Response) (io.Reader, func(), error) {
	if resp.Header.Get("Content-Encoding") == "gzip" {
		r, err := gzip.NewReader(resp.Body)
		if err != nil {
			return nil, nil, fmt.Errorf("could not create gzip reader: %w", err)
		}
		return r, func() { _ = r.Close() }, nil
	}
	return resp.Body, func() {}, nil
}

// ReadManifest fetches the PQL manifest from the CDN, delegating to the manifest Fetcher.
// The objectPath and modifiedSince parameters are unused — the Fetcher constructs the
// path from JWT claims and uses ETags for conditional requests instead of timestamps.
func (cdn *Client) ReadManifest(ctx context.Context, _ string, _ time.Time) (*pqlmanifest.Manifest, error) {
	manifest, _, err := cdn.fetcher.Fetch(ctx, "")
	if err != nil {
		return nil, err
	}
	if manifest == nil {
		return nil, fmt.Errorf("no manifest returned from CDN")
	}
	return manifest, nil
}

// Fetcher returns the manifest fetcher for use with polling.
func (cdn *Client) Fetcher() *pqlmanifest.Fetcher {
	return cdn.fetcher
}

func (cdn *Client) Close() {}

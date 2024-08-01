package cdn

import (
	"compress/gzip"
	"context"
	"errors"
	"fmt"
	"github.com/goccy/go-json"
	"github.com/wundergraph/cosmo/router/internal/httpclient"
	"github.com/wundergraph/cosmo/router/internal/jwt"
	"github.com/wundergraph/cosmo/router/internal/persistedoperation"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	semconv12 "go.opentelemetry.io/otel/semconv/v1.12.0"
	semconv "go.opentelemetry.io/otel/semconv/v1.17.0"
	"go.opentelemetry.io/otel/trace"
	"go.uber.org/zap"
	"io"
	"net/http"
	"net/url"
)

type Options struct {
	Logger        *zap.Logger
	TraceProvider *sdktrace.TracerProvider
}

type client struct {
	cdnURL              *url.URL
	authenticationToken string
	// federatedGraphID is the ID of the federated graph that was obtained
	// from the token, already url-escaped
	federatedGraphID string
	// organizationID is the ID of the organization for this graph that was obtained
	// from the token, already url-escaped
	organizationID string
	httpClient     *http.Client
	logger         *zap.Logger
	tracer         trace.Tracer
}

func (cdn *client) PersistedOperation(ctx context.Context, clientName string, sha256Hash string, attributes []attribute.KeyValue) ([]byte, error) {

	ctx, span := cdn.tracer.Start(ctx, "Load Persisted Operation",
		trace.WithSpanKind(trace.SpanKindClient),
		trace.WithAttributes(attributes...),
	)
	defer span.End()

	content, err := cdn.persistedOperation(ctx, clientName, sha256Hash, attributes)
	if err != nil {
		span.RecordError(err)
		span.SetStatus(codes.Error, err.Error())
		return nil, err
	}

	return content, nil
}

func (cdn *client) persistedOperation(ctx context.Context, clientName string, sha256Hash string, attributes []attribute.KeyValue) ([]byte, error) {

	span := trace.SpanFromContext(ctx)

	operationPath := fmt.Sprintf("/%s/%s/operations/%s/%s.json",
		cdn.organizationID,
		cdn.federatedGraphID,
		url.PathEscape(clientName),
		url.PathEscape(sha256Hash))
	operationURL := cdn.cdnURL.ResolveReference(&url.URL{Path: operationPath})

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
	req.Header.Add("Authorization", "Bearer "+cdn.authenticationToken)
	req.Header.Set("Accept-Encoding", "gzip")

	resp, err := cdn.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	span.SetAttributes(semconv.HTTPStatusCode(resp.StatusCode))

	if resp.StatusCode != http.StatusOK {
		span.SetStatus(codes.Error, fmt.Sprintf("unexpected status code when loading persisted operation, statusCode: %d", resp.StatusCode))

		if resp.StatusCode == http.StatusNotFound {
			return nil, &persistedoperation.PersistentOperationNotFoundError{
				ClientName: clientName,
				Sha256Hash: sha256Hash,
			}
		}
		if resp.StatusCode == http.StatusUnauthorized {
			return nil, errors.New("could not authenticate against CDN")
		}
		if resp.StatusCode == http.StatusBadRequest {
			return nil, errors.New("bad request")
		}
		return nil, fmt.Errorf("unexpected status code when loading persisted operation, statusCode: %d", resp.StatusCode)
	}

	var reader io.Reader = resp.Body

	if resp.Header.Get("Content-Encoding") == "gzip" {
		r, err := gzip.NewReader(resp.Body)
		if err != nil {
			return nil, errors.New("could not create gzip reader. " + err.Error())
		}
		defer r.Close()
		reader = r
	}

	body, err := io.ReadAll(reader)
	if err != nil {
		return nil, errors.New("could not read the response body. " + err.Error())
	}

	var po persistedoperation.PersistedOperation
	err = json.Unmarshal(body, &po)
	if err != nil {
		return nil, err
	}

	return []byte(po.Body), nil
}

// NewClient creates a new CDN client. URL is the URL of the CDN.
// Token is the token used to authenticate with the CDN, the same as the GRAPH_API_TOKEN
func NewClient(endpoint string, token string, opts Options) (persistedoperation.Client, error) {
	u, err := url.Parse(endpoint)
	if err != nil {
		return nil, fmt.Errorf("invalid CDN URL %q: %w", endpoint, err)
	}

	if opts.Logger == nil {
		opts.Logger = zap.NewNop()
	}

	claims, err := jwt.ExtractFederatedGraphTokenClaims(token)
	if err != nil {
		return nil, err
	}

	logger := opts.Logger.With(zap.String("component", "persisted_operations_client"))

	return &client{
		cdnURL:              u,
		authenticationToken: token,
		federatedGraphID:    url.PathEscape(claims.FederatedGraphID),
		organizationID:      url.PathEscape(claims.OrganizationID),
		httpClient:          httpclient.NewRetryableHTTPClient(logger),
		logger:              logger,
		tracer: opts.TraceProvider.Tracer(
			"wundergraph/cosmo/router/cdn_persisted_operations_client",
			trace.WithInstrumentationVersion("0.0.1"),
		),
	}, nil
}

func (cdn *client) Close() {}

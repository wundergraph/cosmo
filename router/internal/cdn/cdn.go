package cdn

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sync"

	"github.com/buger/jsonparser"
	"github.com/golang-jwt/jwt/v5"
	"github.com/wundergraph/cosmo/router/internal/unsafebytes"
)

const (
	FederatedGraphIDClaim = "federated_graph_id"
	OrganizationIDClaim   = "organization_id"

	PersistedOperationNotFoundErrorCode = "PersistedQueryNotFound"
)

var (
	persistedOperationKeys = [][]string{
		{"version"},
		{"body"},
	}
)

const (
	persistedOperationKeyIndexVersion = iota
	persistedOperationKeyIndexBody
)

type PersistentOperationNotFoundError interface {
	error
	ClientName() string
	Sha256Hash() string
}

type persistentOperationNotFoundError struct {
	clientName string
	sha256Hash []byte
}

func (e *persistentOperationNotFoundError) ClientName() string {
	return e.clientName
}

func (e *persistentOperationNotFoundError) Sha256Hash() string {
	return string(e.sha256Hash)
}

func (e *persistentOperationNotFoundError) Error() string {
	return fmt.Sprintf("operation %s for client %s not found", unsafebytes.BytesToString(e.sha256Hash), e.clientName)
}

type cdnPersistedOperationsCache struct {
	operations map[string][]byte
	mu         sync.RWMutex
}

func (c *cdnPersistedOperationsCache) Get(clientName string, operationHash []byte) []byte {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.operations[clientName+unsafebytes.BytesToString(operationHash)]
}

func (c *cdnPersistedOperationsCache) Set(clientName string, operationHash []byte, operationBody []byte) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.operations == nil {
		c.operations = make(map[string][]byte)
	}
	// operationBody might be a subslice of something else, make a copy
	data := make([]byte, len(operationBody))
	copy(data, operationBody)
	c.operations[clientName+unsafebytes.BytesToString(operationHash)] = data
}

type CDNOptions struct {
	// URL is the root URL of the CDN
	URL string
	// AuthenticationToken is the token used to authenticate with the CDN,
	// usually the same as the GRAPH_API_TOKEN
	AuthenticationToken string
	HTTPClient          *http.Client
}

type CDN struct {
	cdnURL              *url.URL
	authenticationToken string
	// federatedGraphID is the ID of the federated graph that was obtained
	// from the token, already url-escaped
	federatedGraphID string
	// organizationID is the ID of the organization for this graph that was obtained
	// from the token, already url-escaped
	organizationID  string
	httpClient      *http.Client
	operationsCache cdnPersistedOperationsCache
}

func (cdn *CDN) PersistedOperation(ctx context.Context, clientName string, sha256Hash []byte) ([]byte, error) {
	if data := cdn.operationsCache.Get(clientName, sha256Hash); data != nil {
		return data, nil
	}
	operationPath := fmt.Sprintf("/%s/%s/operations/%s/%s.json",
		cdn.organizationID,
		cdn.federatedGraphID,
		url.PathEscape(clientName),
		url.PathEscape(unsafebytes.BytesToString(sha256Hash)))
	operationURL := cdn.cdnURL.ResolveReference(&url.URL{Path: operationPath})
	req, err := http.NewRequestWithContext(ctx, "GET", operationURL.String(), nil)
	if err != nil {
		return nil, err
	}
	req.Header.Add("Authorization", "Bearer "+cdn.authenticationToken)
	resp, err := cdn.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		if resp.StatusCode == http.StatusNotFound {
			return nil, &persistentOperationNotFoundError{
				clientName: clientName,
				sha256Hash: sha256Hash,
			}
		}
		if resp.StatusCode == http.StatusForbidden {
			return nil, errors.New("could not authenticate against CDN")
		}
		data, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("unexpected status code when loading persisted operation %d: %s", resp.StatusCode, string(data))
	}
	data, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("reading persisted operation body: %w", err)
	}
	var operationVersion []byte
	var operationBody []byte
	jsonparser.EachKey(data, func(idx int, value []byte, vt jsonparser.ValueType, err error) {
		switch idx {
		case persistedOperationKeyIndexVersion:
			operationVersion = value
		case persistedOperationKeyIndexBody:
			operationBody = value
		}
	}, persistedOperationKeys...)
	if len(operationVersion) != 1 || operationVersion[0] != '1' {
		return nil, fmt.Errorf("invalid persisted operation version %q", string(operationVersion))
	}
	unscaped, err := jsonparser.Unescape(operationBody, nil)
	if err != nil {
		return nil, fmt.Errorf("error unescaping persisted operation body: %w", err)
	}
	cdn.operationsCache.Set(clientName, sha256Hash, unscaped)
	return unscaped, nil
}

func New(opts CDNOptions) (*CDN, error) {
	u, err := url.Parse(opts.URL)
	if err != nil {
		return nil, fmt.Errorf("invalid CDN URL %q: %w", opts.URL, err)
	}
	// Don't validate the token here, just extract the claims
	// that we need to talk to the CDN
	jwtParser := new(jwt.Parser)
	claims := make(jwt.MapClaims)
	var federatedGraphID string
	var organizationID string
	if opts.AuthenticationToken != "" {
		_, _, err = jwtParser.ParseUnverified(opts.AuthenticationToken, claims)
		if err != nil {
			return nil, fmt.Errorf("invalid CDN authentication token %q: %w", opts.AuthenticationToken, err)
		}
		federatedGraphIDValue := claims[FederatedGraphIDClaim]
		if federatedGraphIDValue == nil {
			return nil, fmt.Errorf("invalid CDN authentication token claims, missing %q", FederatedGraphIDClaim)
		}
		var ok bool
		federatedGraphID, ok = federatedGraphIDValue.(string)
		if !ok {
			return nil, fmt.Errorf("invalid CDN authentication token claims, %q is not a string, it's %T", FederatedGraphIDClaim, federatedGraphIDValue)
		}
		organizationIDValue := claims[OrganizationIDClaim]
		if organizationIDValue == nil {
			return nil, fmt.Errorf("invalid CDN authentication token claims, missing %q", OrganizationIDClaim)
		}
		organizationID, ok = organizationIDValue.(string)
		if !ok {
			return nil, fmt.Errorf("invalid CDN authentication token claims, %q is not a string, it's %T", OrganizationIDClaim, organizationIDValue)
		}
	}
	httpClient := opts.HTTPClient
	if httpClient == nil {
		httpClient = http.DefaultClient
	}
	return &CDN{
		cdnURL:              u,
		authenticationToken: opts.AuthenticationToken,
		federatedGraphID:    url.PathEscape(federatedGraphID),
		organizationID:      url.PathEscape(organizationID),
		httpClient:          httpClient,
	}, nil
}

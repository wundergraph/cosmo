package cdn

import (
	"context"
	"errors"
	"fmt"
	"github.com/buger/jsonparser"
	"github.com/dgraph-io/ristretto"
	"github.com/wundergraph/cosmo/router/internal/unsafebytes"
	"go.uber.org/zap"
	"io"
	"net/http"
	"net/url"
)

const (
	PersistedOperationNotFoundErrorCode = "PersistedQueryNotFound"
	persistentAverageCacheEntrySize     = 4 * 1024 // 4kb
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
	// cache is the backing store for the in-memory cache. Note
	// that if the cache is disabled, this will be nil
	cache *ristretto.Cache
}

func (c *cdnPersistedOperationsCache) key(clientName string, operationHash []byte) string {
	return clientName + unsafebytes.BytesToString(operationHash)
}

func (c *cdnPersistedOperationsCache) Get(clientName string, operationHash []byte) []byte {
	// Since we're returning nil when the item is not found, we don't need to
	// check the return value from the cache nor the type assertion
	item, _ := c.cache.Get(c.key(clientName, operationHash))
	data, _ := item.([]byte)
	return data
}

func (c *cdnPersistedOperationsCache) Set(clientName string, operationHash []byte, operationBody []byte) {
	c.cache.Set(c.key(clientName, operationHash), operationBody, int64(len(operationBody)))
}

type PersistentOperationsOptions struct {
	// CacheSize indicates the in-memory cache size, in bytes. If 0, no in-memory
	// cache is used.
	CacheSize uint64
	Logger    *zap.Logger
}

type PersistentOperationClient struct {
	cdnURL              *url.URL
	authenticationToken string
	// federatedGraphID is the ID of the federated graph that was obtained
	// from the token, already url-escaped
	federatedGraphID string
	// organizationID is the ID of the organization for this graph that was obtained
	// from the token, already url-escaped
	organizationID  string
	httpClient      *http.Client
	operationsCache *cdnPersistedOperationsCache
	logger          *zap.Logger
}

func (cdn *PersistentOperationClient) PersistedOperation(ctx context.Context, clientName string, sha256Hash []byte) ([]byte, error) {
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
		if resp.StatusCode == http.StatusUnauthorized {
			return nil, errors.New("could not authenticate against CDN")
		}
		if resp.StatusCode == http.StatusBadRequest {
			return nil, errors.New("bad request")
		}
		data, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("unexpected status code when loading persisted operation %d: %s", resp.StatusCode, string(data))
	}

	data, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("reading persisted operation body: %w", err)
	}

	var (
		operationVersion []byte
		operationBody    []byte
	)
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

	unescaped, err := jsonparser.Unescape(operationBody, nil)
	if err != nil {
		return nil, fmt.Errorf("error unescaping persisted operation body: %w", err)
	}
	cdn.operationsCache.Set(clientName, sha256Hash, unescaped)
	return unescaped, nil
}

// NewPersistentOperationClient creates a new CDN client. URL is the URL of the CDN.
// Token is the token used to authenticate with the CDN, the same as the GRAPH_API_TOKEN
func NewPersistentOperationClient(endpoint string, token string, opts PersistentOperationsOptions) (*PersistentOperationClient, error) {
	u, err := url.Parse(endpoint)
	if err != nil {
		return nil, fmt.Errorf("invalid CDN URL %q: %w", endpoint, err)
	}

	if opts.Logger == nil {
		opts.Logger = zap.NewNop()
	}

	federatedGraphID, organizationID, err := parseCDNToken(token)
	if err != nil {
		return nil, err
	}

	cacheSize := int64(opts.CacheSize)
	var cache *ristretto.Cache
	if cacheSize > 0 {
		cache, err = ristretto.NewCache(&ristretto.Config{
			// assume an average of persistentAverageCacheEntrySize per operation, then
			// multiply by 10 to obtain the recommended number of counters
			NumCounters: (cacheSize * 10) / persistentAverageCacheEntrySize,
			MaxCost:     cacheSize,
			BufferItems: 64,
		})
		if err != nil {
			return nil, fmt.Errorf("initializing CDN cache: %v", err)
		}
	}
	return &PersistentOperationClient{
		cdnURL:              u,
		authenticationToken: token,
		federatedGraphID:    url.PathEscape(federatedGraphID),
		organizationID:      url.PathEscape(organizationID),
		httpClient:          newRetryableHTTPClient(opts.Logger),
		logger:              opts.Logger,
		operationsCache: &cdnPersistedOperationsCache{
			cache: cache,
		},
	}, nil
}

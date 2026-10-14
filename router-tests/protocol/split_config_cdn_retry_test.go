package integration

import (
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
	"go.uber.org/zap/zaptest/observer"
	"google.golang.org/protobuf/encoding/protojson"

	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router-tests/testutils"
	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
	"github.com/wundergraph/cosmo/router/pkg/controlplane/configpoller"
	"github.com/wundergraph/cosmo/router/pkg/routerconfig/cdn"
)

// splitConfigCDN serves the split-config CDN layout (mapper + base graph config).
// The first truncatedResponses answers for the base graph config announce the full
// Content-Length but only send half the body, which surfaces as io.ErrUnexpectedEOF
// while the router reads it.
type splitConfigCDN struct {
	truncatedResponses int32
	configRequests     atomic.Int32
	mapperRequests     atomic.Int32
}

func (c *splitConfigCDN) start(t *testing.T, routerConfig *nodev1.RouterConfig) *httptest.Server {
	t.Helper()

	configBody, err := protojson.Marshal(routerConfig)
	require.NoError(t, err)

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case strings.HasSuffix(r.URL.Path, "/manifest/mapper.json"):
			c.mapperRequests.Add(1)
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`{"": "base-v1"}`))
		case strings.HasSuffix(r.URL.Path, "/manifest/latest.json"):
			if c.configRequests.Add(1) <= c.truncatedResponses {
				w.Header().Set("Content-Length", strconv.Itoa(len(configBody)))
				w.WriteHeader(http.StatusOK)
				_, _ = w.Write(configBody[:len(configBody)/2])
				return
			}
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write(configBody)
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(srv.Close)

	return srv
}

// splitConfigPollerFactory builds the real split-config fetcher and poller against the fake CDN.
func (c *splitConfigCDN) splitConfigPollerFactory(t *testing.T, logger *zap.Logger, opts cdn.Options) func(*nodev1.RouterConfig) configpoller.ConfigPoller {
	return func(routerConfig *nodev1.RouterConfig) configpoller.ConfigPoller {
		srv := c.start(t, routerConfig)

		token, err := testenv.GenerateVersionedJwtToken()
		require.NoError(t, err)

		opts.Logger = logger
		fetcher, err := cdn.NewSplitFetcher(srv.URL, token, &opts)
		require.NoError(t, err)

		return configpoller.NewSplitConfigPoller(fetcher,
			configpoller.WithSplitLogger(logger),
			// Long enough that only the startup fetch happens during the test.
			configpoller.WithSplitPolling(time.Minute, 0),
		)
	}
}

func TestSplitConfigCDNTruncatedBodyRetry(t *testing.T) {
	t.Parallel()

	t.Run("router starts after the base graph config is received truncated", func(t *testing.T) {
		t.Parallel()

		obsCore, logs := observer.New(zapcore.WarnLevel)
		fakeCDN := &splitConfigCDN{truncatedResponses: 2}

		testenv.Run(t, &testenv.Config{
			RouterConfig: &testenv.RouterConfig{
				ConfigPollerFactory: fakeCDN.splitConfigPollerFactory(t, zap.New(obsCore), cdn.Options{
					FetchRetryMaxAttempts: 3,
					FetchRetryInterval:    time.Millisecond,
				}),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `{ employees { id } }`,
			})
			require.JSONEq(t, testutils.EmployeesIDData, res.Body)

			assert.Equal(t, int32(3), fakeCDN.configRequests.Load())
			assert.Equal(t, int32(1), fakeCDN.mapperRequests.Load())

			retries := logs.FilterMessage("Truncated response body received from CDN, retrying").All()
			require.Len(t, retries, 2)
			for i, entry := range retries {
				fields := entry.ContextMap()
				assert.Equal(t, int64(i+1), fields["attempt"])
				assert.Equal(t, int64(3), fields["max_attempts"])
				assert.Contains(t, fields["error"], "unexpected EOF")
			}
		})
	})

	t.Run("router fails to start when every attempt is truncated", func(t *testing.T) {
		t.Parallel()

		fakeCDN := &splitConfigCDN{truncatedResponses: 2}

		xEnv, err := testenv.CreateTestEnv(t, &testenv.Config{
			RouterConfig: &testenv.RouterConfig{
				ConfigPollerFactory: fakeCDN.splitConfigPollerFactory(t, zap.NewNop(), cdn.Options{
					FetchRetryMaxAttempts: 2,
					FetchRetryInterval:    time.Millisecond,
				}),
			},
		})
		if xEnv != nil {
			t.Cleanup(xEnv.Shutdown)
		}
		require.Error(t, err)
		assert.Contains(t, err.Error(), "unexpected EOF")
		assert.Equal(t, int32(2), fakeCDN.configRequests.Load())
	})

	t.Run("a single attempt disables the retry", func(t *testing.T) {
		t.Parallel()

		fakeCDN := &splitConfigCDN{truncatedResponses: 1}

		xEnv, err := testenv.CreateTestEnv(t, &testenv.Config{
			RouterConfig: &testenv.RouterConfig{
				ConfigPollerFactory: fakeCDN.splitConfigPollerFactory(t, zap.NewNop(), cdn.Options{
					FetchRetryMaxAttempts: 1,
				}),
			},
		})
		if xEnv != nil {
			t.Cleanup(xEnv.Shutdown)
		}
		require.Error(t, err)
		assert.Contains(t, err.Error(), "unexpected EOF")
		assert.Equal(t, int32(1), fakeCDN.configRequests.Load())
	})
}

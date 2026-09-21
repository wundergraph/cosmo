package rediscloser

import (
	"context"
	"fmt"
	"net"
	"net/url"
	"os"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/redis/go-redis/v9"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"
)

// read_only is one of the query parameters a user can put on the Redis URL (see url_options_test.go
// for the parsing side). Unlike the pool parameters it changes where commands are sent: go-redis
// routes read-only commands to a replica of the owning shard instead of its master. That only
// exists for cluster clients, so these tests need a real cluster with replicas. The local one has
// them behind an opt-in compose profile, six nodes on 7001-7006 joined with --cluster-replicas 1:
//
//	docker compose --profile dev --profile redis-cluster-replicas up -d redis-cluster-configure
//
// The assertion is made server side: each node's INFO commandstats says how many GETs it actually
// served, which is the ground truth for "the read was served by a replica". The tests skip when no
// such cluster is reachable, including the default replica-less one, so `make test` stays green
// without infra.
//
//	go test ./internal/rediscloser/ -run TestClusterReadOnly -v

const clusterURLsEnv = "TEST_REDIS_CLUSTER_URLS"

var defaultTestRedisClusterURLs = []string{
	"redis://localhost:7001",
	"redis://localhost:7002",
	"redis://localhost:7003",
	"redis://localhost:7004",
	"redis://localhost:7005",
	"redis://localhost:7006",
}

// TestClusterReadOnlyRoutesReadsToReplicas asserts that read_only=true on the URL makes the
// replicas serve every GET, and that they serve the values the masters were written with.
func TestClusterReadOnlyRoutesReadsToReplicas(t *testing.T) {
	const repeats = 3

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()

	client := newTestClusterClient(t, ctx, "read_only=true")
	nodes := awaitClusterNodesByRole(t, ctx, client)

	// Writes still go to the masters even on a read_only client, so this also covers that the
	// flag does not break writes.
	keys := writeTestKeys(t, ctx, client)

	// A replica may not have the key yet, and a GET is counted either way, so settle replication
	// before measuring rather than reading through a moving target.
	require.Eventually(t, func() bool {
		for key, want := range keys {
			if got, err := client.Get(ctx, key).Result(); err != nil || got != want {
				return false
			}
		}
		return true
	}, 10*time.Second, 50*time.Millisecond, "keys never became readable through the read_only client")

	nodes.resetStats(t, ctx)

	for range repeats {
		for key, want := range keys {
			got, err := client.Get(ctx, key).Result()
			require.NoError(t, err)
			require.Equal(t, want, got, "replica served a stale or wrong value for %s", key)
		}
	}

	masterGets, replicaGets := nodes.getCalls(t, ctx)
	t.Logf("read_only=true: %d GETs on %d masters, %d GETs on %d replicas",
		masterGets, len(nodes.masters), replicaGets, len(nodes.replicas))

	require.Equal(t, int64(len(keys)*repeats), replicaGets, "every read should have been served by a replica")
	require.Zero(t, masterGets, "no read should have reached a master")
}

// TestClusterWithoutReadOnlyRoutesReadsToMasters is the counterpart: without the flag the masters
// serve the reads, so a passing read_only test cannot be explained by the cluster topology alone.
func TestClusterWithoutReadOnlyRoutesReadsToMasters(t *testing.T) {
	const repeats = 3

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	client := newTestClusterClient(t, ctx, "")
	nodes := awaitClusterNodesByRole(t, ctx, client)

	keys := writeTestKeys(t, ctx, client)

	nodes.resetStats(t, ctx)

	for range repeats {
		for key, want := range keys {
			got, err := client.Get(ctx, key).Result()
			require.NoError(t, err)
			require.Equal(t, want, got)
		}
	}

	masterGets, replicaGets := nodes.getCalls(t, ctx)
	t.Logf("read_only unset: %d GETs on %d masters, %d GETs on %d replicas",
		masterGets, len(nodes.masters), replicaGets, len(nodes.replicas))

	require.Equal(t, int64(len(keys)*repeats), masterGets, "every read should have been served by a master")
	require.Zero(t, replicaGets, "no read should have reached a replica by default")
}

// newTestClusterClient builds the cluster client under test through NewRedisCloser, so the URL
// handling the router owns is part of what is exercised. params are appended to the first URL,
// which is where go-redis reads cluster options from.
func newTestClusterClient(tb testing.TB, ctx context.Context, params string) *redis.ClusterClient {
	tb.Helper()

	urls := testRedisClusterURLs(tb)
	if params != "" {
		urls[0] = withParams(tb, urls[0], params)
	}

	pingCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()

	cl, err := NewRedisCloser(&RedisCloserOptions{
		Logger:         zap.NewNop(),
		URLs:           urls,
		ClusterEnabled: true,
		Context:        pingCtx,
	})
	if err != nil {
		// The seed port answered but the cluster did not. The usual cause is that the nodes
		// announce their container IPs (see redis-cluster-create.sh), which the host can only
		// reach with a Docker runtime that routes them, so this is a skip and not a failure.
		tb.Skipf("no usable redis cluster at %v, skipping: %v", urls, err)
	}
	tb.Cleanup(func() { _ = cl.Close() })

	client, ok := cl.(*redis.ClusterClient)
	require.True(tb, ok, "cluster mode must produce a *redis.ClusterClient")

	return client
}

// testRedisClusterURLs returns the cluster seed URLs, skipping the caller when nothing is
// listening on the first one.
func testRedisClusterURLs(tb testing.TB) []string {
	tb.Helper()

	urls := defaultTestRedisClusterURLs
	if raw := os.Getenv(clusterURLsEnv); raw != "" {
		urls = strings.Split(raw, ",")
	}
	// Copied because the caller appends query parameters to the first entry.
	urls = append([]string(nil), urls...)

	parsed, err := url.Parse(urls[0])
	require.NoError(tb, err, "%s does not hold valid URLs", clusterURLsEnv)

	conn, err := net.DialTimeout("tcp", parsed.Host, 500*time.Millisecond)
	if err != nil {
		tb.Skipf("no redis cluster reachable at %s, skipping: %v", parsed.Host, err)
	}
	_ = conn.Close()

	return urls
}

// writeTestKeys writes one key per attempt to spread them over the shards, and cleans them up.
// The returned map is key -> expected value.
func writeTestKeys(tb testing.TB, ctx context.Context, client *redis.ClusterClient) map[string]string {
	tb.Helper()

	const keyCount = 12

	prefix := fmt.Sprintf("cosmo_read_replica_%d_%s:", time.Now().UnixNano(), tb.Name())
	keys := make(map[string]string, keyCount)
	for i := range keyCount {
		keys[fmt.Sprintf("%s%d", prefix, i)] = strconv.Itoa(i)
	}

	for key, value := range keys {
		require.NoError(tb, client.Set(ctx, key, value, 5*time.Minute).Err())
	}

	tb.Cleanup(func() {
		cleanupCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		for key := range keys {
			client.Del(cleanupCtx, key)
		}
	})

	return keys
}

// clusterRoles holds a per-node client for every master and every replica the cluster reports.
type clusterRoles struct {
	masters  []*redis.Client
	replicas []*redis.Client
}

// awaitClusterNodesByRole waits until every shard reports a replica. Right after the cluster is
// created a node can still answer CLUSTER SLOTS with a shard that has no replica yet, and reads for
// that shard fall back to its master, which would make these tests flaky. The check has to be per
// shard rather than a replica count: one master with two replicas and another with none would
// satisfy any count comparison while still leaving a shard whose reads cannot reach a replica.
func awaitClusterNodesByRole(tb testing.TB, ctx context.Context, client *redis.ClusterClient) clusterRoles {
	tb.Helper()

	// A cluster with no replicas at all is the default local setup, not a cluster still coming up,
	// so it must not cost the poll below its whole deadline before skipping.
	if clusterReplicaCount(tb, ctx, client) == 0 {
		tb.Skip("redis cluster has no replicas, start them with the redis-cluster-replicas compose profile")
	}

	var (
		roles       clusterRoles
		replicaless []string
	)
	for deadline := time.Now().Add(15 * time.Second); ; time.Sleep(250 * time.Millisecond) {
		// This reloads the cluster state (ForEachMaster/ForEachSlave go through ReloadOrGet), so
		// polling is also what makes the client itself pick up the full topology.
		roles = clusterNodesByRole(tb, ctx, client)

		slots, err := client.ClusterSlots(ctx).Result()
		require.NoError(tb, err, "CLUSTER SLOTS")

		replicaless = shardsWithoutReplica(slots)
		if len(replicaless) == 0 || time.Now().After(deadline) {
			break
		}
	}

	require.Empty(tb, replicaless,
		"these shards have no replica, so their reads can only be served by their master")

	return roles
}

// clusterReplicaCount reports how many replicas the cluster knows about. Replication is set up
// while the cluster is created, so unlike the CLUSTER SLOTS view that routing is built from, this
// answer does not need time to propagate and can be trusted straight away.
func clusterReplicaCount(tb testing.TB, ctx context.Context, client *redis.ClusterClient) int {
	tb.Helper()

	// 4f1b1a... 192.168.107.27:6379@16379 slave 1cff53... 0 1787305644000 2 connected
	raw, err := client.ClusterNodes(ctx).Result()
	require.NoError(tb, err, "CLUSTER NODES")

	var replicas int
	for line := range strings.SplitSeq(raw, "\n") {
		fields := strings.Fields(line)
		if len(fields) < 3 {
			continue
		}
		// The flags field is comma separated ("myself,master"), and redis still calls a replica a
		// slave here.
		for flag := range strings.SplitSeq(fields[2], ",") {
			if flag == "slave" {
				replicas++
			}
		}
	}

	return replicas
}

// shardsWithoutReplica names the slot ranges that CLUSTER SLOTS reports with a master and nothing
// else. A shard is only usable for these tests when it has at least one replica.
func shardsWithoutReplica(slots []redis.ClusterSlot) []string {
	var replicaless []string
	for _, slot := range slots {
		if len(slot.Nodes) >= 2 {
			continue
		}
		master := "no node"
		if len(slot.Nodes) == 1 {
			master = slot.Nodes[0].Addr
		}
		replicaless = append(replicaless, fmt.Sprintf("slots %d-%d (master %s)", slot.Start, slot.End, master))
	}
	return replicaless
}

func clusterNodesByRole(tb testing.TB, ctx context.Context, client *redis.ClusterClient) clusterRoles {
	tb.Helper()

	var (
		mu    sync.Mutex
		roles clusterRoles
	)

	require.NoError(tb, client.ForEachMaster(ctx, func(_ context.Context, node *redis.Client) error {
		mu.Lock()
		defer mu.Unlock()
		roles.masters = append(roles.masters, node)
		return nil
	}))
	require.NoError(tb, client.ForEachSlave(ctx, func(_ context.Context, node *redis.Client) error {
		mu.Lock()
		defer mu.Unlock()
		roles.replicas = append(roles.replicas, node)
		return nil
	}))

	require.NotEmpty(tb, roles.masters, "cluster reported no masters")

	return roles
}

// resetStats zeroes the command counters on every node so only the commands the test issues
// afterwards are counted.
func (r clusterRoles) resetStats(tb testing.TB, ctx context.Context) {
	tb.Helper()

	nodeClients := make([]*redis.Client, 0, len(r.masters)+len(r.replicas))
	nodeClients = append(nodeClients, r.masters...)
	nodeClients = append(nodeClients, r.replicas...)

	for _, node := range nodeClients {
		require.NoError(tb, node.ConfigResetStat(ctx).Err(), "CONFIG RESETSTAT on %s", node.Options().Addr)
	}
}

// getCalls returns how many GETs the masters and the replicas served since the last resetStats.
func (r clusterRoles) getCalls(tb testing.TB, ctx context.Context) (masters, replicas int64) {
	tb.Helper()

	for _, node := range r.masters {
		masters += getCallsOnNode(tb, ctx, node)
	}
	for _, node := range r.replicas {
		replicas += getCallsOnNode(tb, ctx, node)
	}
	return masters, replicas
}

func getCallsOnNode(tb testing.TB, ctx context.Context, node *redis.Client) int64 {
	tb.Helper()

	info, err := node.Info(ctx, "commandstats").Result()
	require.NoError(tb, err, "INFO commandstats on %s", node.Options().Addr)

	// cmdstat_get:calls=6,usec=41,usec_per_call=6.83,rejected_calls=0,failed_calls=0
	for line := range strings.SplitSeq(info, "\n") {
		fields, ok := strings.CutPrefix(strings.TrimSpace(line), "cmdstat_get:")
		if !ok {
			continue
		}
		for field := range strings.SplitSeq(fields, ",") {
			calls, ok := strings.CutPrefix(field, "calls=")
			if !ok {
				continue
			}
			parsed, err := strconv.ParseInt(calls, 10, 64)
			require.NoError(tb, err, "parsing %q from %s", line, node.Options().Addr)
			tb.Logf("%s served %d GETs", node.Options().Addr, parsed)
			return parsed
		}
	}

	// No cmdstat_get line at all means the node served no GET since the reset.
	return 0
}

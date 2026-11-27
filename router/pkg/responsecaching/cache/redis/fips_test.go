package redis

import (
	"context"
	"crypto/fips140"
	"sync"
	"testing"

	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"
	"github.com/stretchr/testify/require"
)

// Go's FIPS 140-only mode panics on SHA-1, which go-redis uses to name a script
// for EVALSHA. The redis server is miniredis, which hashes scripts with SHA-1
// itself, so scripts are answered here instead of being sent. In FIPS mode the
// script must go out with EVAL; otherwise it is run through EVALSHA.
func TestRedisCacheMarkSendsTheScriptTheWayTheModeAllows(t *testing.T) {
	t.Parallel()

	const markScore = int64(-1700000000000)
	scripts := &answerScripts{result: markScore}
	cache := newTestRedisCacheOn(t, miniredis.RunT(t), scripts)

	score, err := cache.mark(t.Context(), "tag-key", []string{"member"})

	require.NoError(t, err)
	require.Equal(t, "-1700000000000", score)
	if fips140.Enabled() {
		require.Equal(t, []string{"eval"}, scripts.commands(), "EVALSHA needs the SHA-1 of the script")
	} else {
		require.Equal(t, []string{"evalsha"}, scripts.commands())
	}
}

// FIPS 140-only mode is a process-wide setting, so this test only has
// something to check when the package's tests run with it:
//
//	GODEBUG=fips140=only go test ./pkg/responsecaching/cache/redis -run FIPS
func TestRedisCacheStartsInFIPSMode(t *testing.T) {
	t.Parallel()

	if !fips140.Enabled() {
		t.Skip("run with GODEBUG=fips140=only")
	}
	// Reaching this point means the package initialized without hashing a
	// script, which is what panicked at the router's startup.
	require.True(t, fips140.Enabled())
}

// answerScripts records the script commands a client sends and answers them
// with result instead of sending them.
type answerScripts struct {
	result int64
	mu     sync.Mutex
	names  []string
}

func (a *answerScripts) commands() []string {
	a.mu.Lock()
	defer a.mu.Unlock()
	return append([]string(nil), a.names...)
}

func (a *answerScripts) DialHook(next redis.DialHook) redis.DialHook { return next }

func (a *answerScripts) ProcessHook(next redis.ProcessHook) redis.ProcessHook {
	return func(ctx context.Context, cmd redis.Cmder) error {
		switch name := cmd.Name(); name {
		case "eval", "evalsha":
			a.mu.Lock()
			a.names = append(a.names, name)
			a.mu.Unlock()
			cmd.(*redis.Cmd).SetVal(a.result)
			return nil
		}
		return next(ctx, cmd)
	}
}

func (a *answerScripts) ProcessPipelineHook(next redis.ProcessPipelineHook) redis.ProcessPipelineHook {
	return next
}

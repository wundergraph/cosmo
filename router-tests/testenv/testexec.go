package testenv

import (
	"bufio"
	"context"
	"fmt"
	"github.com/hashicorp/consul/sdk/freeport"
	"github.com/stretchr/testify/require"
	"go.uber.org/atomic"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

const routerDir = "../router"

// RunRouterBinary starts the router binary, sets up the test environment, and runs the provided test function.
func RunRouterBinary(t *testing.T, cfg *Config, f func(t *testing.T, xEnv *Environment)) {
	t.Helper()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	buildRouterBin(t, ctx)
	env := runRouterBin(t, ctx, cfg, routerDir)
	t.Cleanup(env.Shutdown)

	// Execute the test case with the environment
	f(t, env)
}

// BuildRouter runs `make build` inside the router directory and fails the test on error.
func buildRouterBin(t *testing.T, ctx context.Context) {
	t.Helper()

	cmd := exec.Command("make", "build")
	cmd.Dir = routerDir
	runCmdWithLogs(t, ctx, cmd, true)
}

// runRouterBin starts the router binary and returns an Environment.
func runRouterBin(t *testing.T, ctx context.Context, cfg *Config, routerDir string) *Environment {
	t.Helper()

	binaryPath := filepath.Join(routerDir, "router")
	fullBinPath, err := filepath.Abs(binaryPath)
	require.NoError(t, err)

	port := freeport.GetOne(t)
	listenerAddr := fmt.Sprintf("localhost:%d", port)
	token, err := generateJwtToken()
	require.NoError(t, err)
	testCdn := setupCDNServer(t)
	vals := ""

	for key, val := range map[string]string{
		"GRAPH_API_TOKEN":      token,
		"LISTEN_ADDR":          listenerAddr,
		"CDN_URL":              testCdn.URL,
		"METRICS_OTLP_ENABLED": "false",
		"RETRY_ENABLED":        "false",
		"CDN_CACHE_SIZE":       fmt.Sprintf("%d", 1024*1024),
	} {
		vals += fmt.Sprintf("\n%s=%s", key, val)
	}
	envFile := filepath.Join(os.TempDir(), RandString(6)+".env")
	require.NoError(t, os.WriteFile(envFile, []byte(strings.TrimSpace(vals)), os.ModePerm))

	cmd := exec.Command(fullBinPath, "--override-env", envFile)
	cmd.Dir = t.TempDir()
	newCtx, cancel := context.WithCancelCause(context.Background())
	runCmdWithLogs(t, ctx, cmd, false)

	// Graceful shutdown on context cancel
	go func() {
		<-newCtx.Done()
		_ = cmd.Process.Signal(os.Interrupt)
		time.Sleep(2 * time.Second)
		_ = cmd.Process.Kill()
	}()

	// Create test environment
	env := &Environment{
		t:             t,
		RouterURL:     "http://" + listenerAddr,
		graphQLPath:   "/graphql",
		RouterClient:  http.DefaultClient,
		cfg:           cfg,
		CDN:           testCdn,
		Context:       newCtx,
		cancel:        cancel,
		shutdown:      atomic.NewBool(false),
		shutdownDelay: 30 * time.Second,
		routerCmd:     cmd,
	}

	// Wait for server readiness
	require.NoError(t, env.WaitForServer(ctx, env.RouterURL+"/health/ready", 600, 60))

	return env
}

func runCmdWithLogs(t *testing.T, ctx context.Context, cmd *exec.Cmd, waitToComplete bool) {
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	r, w := io.Pipe()
	cmd.Stdout = w
	cmd.Stderr = w

	// Capture output in real-time
	go func() {
		scanner := bufio.NewScanner(r)
		for scanner.Scan() {
			select {
			case <-ctx.Done(): // Stop logging after test exits
				return
			default:
				t.Log(scanner.Text()) // Log each line from command output
			}
		}
		if err := scanner.Err(); err != nil {
			t.Logf("error reading output: %v", err)
		}
	}()

	if waitToComplete {
		require.NoError(t, cmd.Run(), "Failed to start router")
	} else {
		require.NoError(t, cmd.Start(), "Failed to start router")
	}
}

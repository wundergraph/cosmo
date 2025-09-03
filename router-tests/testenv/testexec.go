package testenv

import (
	"bufio"
	"context"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/hashicorp/consul/sdk/freeport"
	"github.com/stretchr/testify/require"
	"go.uber.org/atomic"
)

const routerDir = "../router"

var (
	buildOnce sync.Once
	routerBin string
)

// RunRouterBinary starts the router binary, sets up the test environment, and runs the provided test function.
func RunRouterBinary(t *testing.T, cfg *Config, runRouterBinConfigOptions RunRouterBinConfigOptions, f func(t *testing.T, xEnv *Environment)) error {
	t.Helper()

	if testing.Short() {
		t.Skip("router binary tests are slow due to compilation time")
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	routerPath := getRouterBinary(t, ctx)
	env, err := runRouterBin(t, ctx, runRouterBinConfigOptions, cfg, routerPath)
	if err != nil {
		return err
	}
	t.Cleanup(env.Shutdown)

	// Execute the test case with the environment
	f(t, env)
	return nil
}

func (e *Environment) GetRouterProcessCwd() string {
	return e.routerCmd.Dir
}

func (e *Environment) SignalRouterProcess(sig os.Signal) error {
	return e.routerCmd.Process.Signal(sig)
}

func (e *Environment) IsLogReceivedFromOutput(ctx context.Context, contains string, timeout time.Duration) bool {
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	for {
		select {
		case line := <-e.cmdLogChannel:
			if strings.Contains(line, contains) {
				return true
			}
		case <-ctx.Done():
			return false
		}
	}
}

// BuildRouter runs `make build` inside the router directory and fails the test on error.
func buildRouterBin(t *testing.T, ctx context.Context) {
	t.Helper()

	// Ensure we only build once
	buildOnce.Do(func() {
		t.Log("Building router binary...")

		cmd := exec.Command("make", "build-race")
		cmd.Dir = routerDir
		err := runCmdWithLogs(t, ctx, cmd, true, nil) // Run the build command
		if err != nil {
			t.Fatalf("failed to execute runCmdWithLogs: %v", err)
		}

		// Determine the binary path after successful build
		binPath := filepath.Join(routerDir, "router") // Adjust if needed for Windows
		require.FileExists(t, binPath, "Router binary was not found after build")

		routerBin = binPath // Store the path for reuse
		t.Logf("Router binary built: %s", routerBin)
	})
}

// getRouterBinary ensures the router binary is built and returns its path.
func getRouterBinary(t *testing.T, ctx context.Context) string {
	buildRouterBin(t, ctx) // Ensure the router is built
	return routerBin       // Return cached binary path
}

type RunRouterBinConfigOptions struct {
	ConfigOverridePath       string
	OverrideDirectory        string
	AssertOnRouterBinaryLogs bool
}

// runRouterBin starts the router binary and returns an Environment.
func runRouterBin(t *testing.T, ctx context.Context, opts RunRouterBinConfigOptions, cfg *Config, binaryPath string) (*Environment, error) {
	t.Helper()

	fullBinPath, err := filepath.Abs(binaryPath)
	if err != nil {
		return nil, err
	}

	port := freeport.GetOne(t)
	listenerAddr := fmt.Sprintf("localhost:%d", port)
	token, err := generateJwtToken()
	if err != nil {
		return nil, err
	}
	testCdn := SetupCDNServer(t, freeport.GetOne(t))
	var envs []string

	envVars := map[string]string{
		"GRAPH_API_TOKEN":      token,
		"LISTEN_ADDR":          listenerAddr,
		"CDN_URL":              testCdn.URL,
		"METRICS_OTLP_ENABLED": "false",
		"RETRY_ENABLED":        "false",
		"SHUTDOWN_DELAY":       "30s",
		"CDN_CACHE_SIZE":       fmt.Sprintf("%d", 1024*1024),
		"DEMO_MODE":            fmt.Sprintf("%t", cfg.DemoMode),
	}

	// If user has passed in a config override path
	if opts.ConfigOverridePath != "" {
		envVars["CONFIG_PATH"] = opts.ConfigOverridePath
	}

	for key, val := range envVars {
		envs = append(envs, fmt.Sprintf("%s=%s", key, val))
	}

	cmd := exec.Command(fullBinPath)
	cmd.Env = envs

	if opts.OverrideDirectory != "" {
		cmd.Dir = opts.OverrideDirectory
	} else {
		cmd.Dir = t.TempDir()
	}

	var cmdLogChannel chan string
	if opts.AssertOnRouterBinaryLogs {
		cmdLogChannel = make(chan string, 100)
	}

	newCtx, cancel := context.WithCancelCause(ctx)

	err = runCmdWithLogs(t, ctx, cmd, false, cmdLogChannel)
	if err != nil {
		cancel(err)
		return nil, err
	}

	// Graceful shutdown on context cancel
	go func() {
		<-newCtx.Done()
		_ = cmd.Process.Signal(os.Interrupt)
	}()

	go func() {
		err := cmd.Wait()
		cancel(err)
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
		cmdLogChannel: cmdLogChannel,
	}

	// Wait for server readiness
	err = env.WaitForServer(newCtx, env.RouterURL+"/health/ready", 600, 60)
	if err != nil {
		return nil, err
	}

	return env, nil
}

func runCmdWithLogs(t *testing.T, ctx context.Context, cmd *exec.Cmd, waitToComplete bool, outputChan chan<- string) error {
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	r, w := io.Pipe()
	cmd.Stdout = w
	cmd.Stderr = w

	// Capture output in real-time
	go func() {
		scanner := bufio.NewScanner(r)
		for scanner.Scan() {
			line := scanner.Text()
			select {
			case <-ctx.Done(): // Stop logging after test exits
				if outputChan != nil {
					close(outputChan)
				}
				return
			default:
				t.Log(line)

				// If we want to listen to an output channel
				if outputChan != nil {
					select {
					case outputChan <- line:
					case <-ctx.Done():
						return
					}
				}
			}
		}
		if err := scanner.Err(); err != nil {
			t.Logf("error reading output: %v", err)
		}
	}()

	if waitToComplete {
		err := cmd.Run()
		if err != nil {
			return fmt.Errorf("failed to run router: %w", err)
		}
	} else {
		err := cmd.Start()
		if err != nil {
			return fmt.Errorf("failed to start router: %w", err)
		}
	}

	return nil
}

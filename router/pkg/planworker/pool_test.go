package planworker

import (
	"context"
	"errors"
	"fmt"
	"os"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"go.uber.org/zap"
	"go.uber.org/zap/zaptest/observer"
)

const (
	testVersion    = "1.2.3"
	testPlanFormat = "test-format"

	// workerProcessEnv makes the test binary act as a worker process.
	workerProcessEnv = "PLANWORKER_TEST_WORKER_PROCESS"
)

func TestMain(m *testing.M) {
	if os.Getenv(workerProcessEnv) != "" {
		err := Serve(os.Stdin, os.Stdout, newTestHandler(), ServeOptions{
			Version:      testVersion,
			PlanFormat:   testPlanFormat,
			Disconnected: func() { os.Exit(0) },
		})
		if err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
		os.Exit(0)
	}
	os.Exit(m.Run())
}

// testHandler stands in for a planner. The content of a request tells it what to do.
type testHandler struct {
	mu      sync.Mutex
	configs map[string]string
	// planning counts the requests being handled right now.
	planning *atomic.Int64
	// block, when set, holds every request until it is closed.
	block chan struct{}
}

func newTestHandler() *testHandler {
	return &testHandler{configs: make(map[string]string), planning: &atomic.Int64{}}
}

func (h *testHandler) Configure(config *Config) error {
	if strings.HasPrefix(string(config.Payload), "invalid") {
		return errors.New("payload is invalid")
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	h.configs[config.ID] = string(config.Payload)
	return nil
}

func (h *testHandler) Release(configID string) {
	h.mu.Lock()
	defer h.mu.Unlock()
	delete(h.configs, configID)
}

func (h *testHandler) loaded() []string {
	h.mu.Lock()
	defer h.mu.Unlock()
	var out []string
	for id := range h.configs {
		out = append(out, id)
	}
	return out
}

func (h *testHandler) Plan(request *Request) *Result {
	h.planning.Add(1)
	defer h.planning.Add(-1)

	if h.block != nil {
		<-h.block
	}

	h.mu.Lock()
	payload, ok := h.configs[request.ConfigID]
	h.mu.Unlock()
	if !ok {
		return &Result{Status: StatusFailed, Message: "configuration is not loaded"}
	}

	switch request.Content {
	case "hang":
		select {}
	case "exit":
		os.Exit(3)
	case "unsupported":
		return &Result{Status: StatusUnsupported, Message: "can't be transferred"}
	}
	return &Result{
		Status:            StatusOK,
		OperationDocument: request.Content,
		PlanningDuration:  time.Millisecond,
		// A blob that isn't valid JSON or UTF-8, like a real plan.
		Plan: []byte(fmt.Sprintf("\x00\xff%s|%s|%s|%d", payload, request.OperationName, request.Content, os.Getpid())),
	}
}

type pipeHandlers struct {
	mu       sync.Mutex
	handlers []*testHandler
	block    chan struct{}
}

func (p *pipeHandlers) new() Handler {
	p.mu.Lock()
	defer p.mu.Unlock()
	h := newTestHandler()
	h.block = p.block
	p.handlers = append(p.handlers, h)
	return h
}

func (p *pipeHandlers) all() []*testHandler {
	p.mu.Lock()
	defer p.mu.Unlock()
	return append([]*testHandler(nil), p.handlers...)
}

func (p *pipeHandlers) planning() int64 {
	var n int64
	for _, h := range p.all() {
		n += h.planning.Load()
	}
	return n
}

func newPipePool(t *testing.T, opts Options) (*Pool, *pipeHandlers) {
	t.Helper()
	handlers := &pipeHandlers{}
	if opts.Launcher == nil {
		opts.Launcher = &PipeLauncher{
			NewHandler: handlers.new,
			Options:    ServeOptions{Version: testVersion, PlanFormat: testPlanFormat},
		}
	}
	return newTestPool(t, opts), handlers
}

func newTestPool(t *testing.T, opts Options) *Pool {
	t.Helper()
	if opts.Workers == 0 {
		opts.Workers = 2
	}
	if opts.QueueSize == 0 {
		opts.QueueSize = 16
	}
	if opts.Timeout == 0 {
		opts.Timeout = 10 * time.Second
	}
	opts.Version = testVersion
	opts.PlanFormat = testPlanFormat
	pool, err := NewPool(opts)
	require.NoError(t, err)
	t.Cleanup(pool.Close)
	return pool
}

func newProcessPool(t *testing.T, opts Options) *Pool {
	t.Helper()
	opts.Launcher = &ProcessLauncher{
		Command: []string{os.Args[0]},
		Env:     []string{workerProcessEnv + "=1"},
	}
	return newTestPool(t, opts)
}

func TestPoolPlans(t *testing.T) {
	t.Parallel()

	pool, handlers := newPipePool(t, Options{Workers: 3, QueueSize: 64})
	pool.Register(&Config{ID: "a", Payload: []byte("graph-a")})
	pool.Register(&Config{ID: "b", Payload: []byte("graph-b")})
	require.NoError(t, pool.Start(t.Context()))

	// All workers are up and have loaded the configurations before the first request.
	require.Len(t, handlers.all(), 3)
	for _, h := range handlers.all() {
		require.ElementsMatch(t, []string{"a", "b"}, h.loaded())
	}

	var wg sync.WaitGroup
	for i := range 50 {
		wg.Go(func() {
			configID, graph := "a", "graph-a"
			if i%2 == 1 {
				configID, graph = "b", "graph-b"
			}
			content := fmt.Sprintf("query Q%d { a }", i)
			result, err := pool.Plan(context.Background(), &Request{
				ConfigID:      configID,
				Content:       content,
				OperationName: fmt.Sprintf("Q%d", i),
			})
			if !assertNoError(t, err) {
				return
			}
			assertEqual(t, StatusOK, result.Status)
			assertEqual(t, content, result.OperationDocument)
			assertEqual(t, time.Millisecond, result.PlanningDuration)
			assertEqual(t, fmt.Sprintf("\x00\xff%s|Q%d|%s|%d", graph, i, content, os.Getpid()), string(result.Plan))
		})
	}
	wg.Wait()

	require.Equal(t, Stats{Requests: 50, Starts: 3}, pool.Stats())
}

func assertNoError(t *testing.T, err error) bool {
	t.Helper()
	if err != nil {
		t.Errorf("unexpected error: %v", err)
		return false
	}
	return true
}

func assertEqual[T comparable](t *testing.T, expected, actual T) {
	t.Helper()
	if expected != actual {
		t.Errorf("expected %v, got %v", expected, actual)
	}
}

func TestPoolPassesOnResultsWithoutPlan(t *testing.T) {
	t.Parallel()

	pool, _ := newPipePool(t, Options{Workers: 1})
	pool.Register(&Config{ID: "a", Payload: []byte("graph-a")})
	require.NoError(t, pool.Start(t.Context()))

	result, err := pool.Plan(context.Background(), &Request{ConfigID: "a", Content: "unsupported"})
	require.NoError(t, err)
	require.Equal(t, StatusUnsupported, result.Status)
	require.Equal(t, "can't be transferred", result.Message)
	require.Empty(t, result.Plan)
}

func TestPoolLimitsParallelismAndQueue(t *testing.T) {
	t.Parallel()

	const (
		workers   = 2
		queueSize = 3
	)

	block := make(chan struct{})
	handlers := &pipeHandlers{block: block}
	pool := newTestPool(t, Options{
		Workers:   workers,
		QueueSize: queueSize,
		Launcher: &PipeLauncher{
			NewHandler: handlers.new,
			Options:    ServeOptions{Version: testVersion, PlanFormat: testPlanFormat},
		},
	})
	pool.Register(&Config{ID: "a", Payload: []byte("graph-a")})
	require.NoError(t, pool.Start(t.Context()))

	results := make(chan error, workers+queueSize)
	submit := func() {
		go func() {
			_, err := pool.Plan(context.Background(), &Request{ConfigID: "a", Content: "query { a }"})
			results <- err
		}()
	}

	// Occupy all workers.
	for range workers {
		submit()
	}
	require.Eventually(t, func() bool { return handlers.planning() == workers }, 5*time.Second, time.Millisecond)

	// Fill the queue. Nothing more is planned, because all workers are busy.
	for range queueSize {
		submit()
	}
	require.Eventually(t, func() bool { return len(pool.queue) == queueSize }, 5*time.Second, time.Millisecond)
	require.EqualValues(t, workers, handlers.planning())

	// There is no room for another request.
	_, err := pool.Plan(context.Background(), &Request{ConfigID: "a", Content: "query { a }"})
	require.ErrorIs(t, err, ErrQueueFull)

	close(block)
	for range workers + queueSize {
		require.NoError(t, <-results)
	}

	require.Equal(t, Stats{Requests: workers + queueSize, Rejected: 1, Starts: workers}, pool.Stats())
}

func TestPoolConfigurations(t *testing.T) {
	t.Parallel()

	t.Run("registered after start", func(t *testing.T) {
		t.Parallel()

		pool, handlers := newPipePool(t, Options{Workers: 2})
		require.NoError(t, pool.Start(t.Context()))

		pool.Register(&Config{ID: "late", Payload: []byte("graph-late")})

		// Idle workers load it in the background, a request doesn't have to trigger it.
		require.Eventually(t, func() bool {
			for _, h := range handlers.all() {
				if len(h.loaded()) != 1 {
					return false
				}
			}
			return true
		}, 5*time.Second, time.Millisecond)

		result, err := pool.Plan(context.Background(), &Request{ConfigID: "late", Content: "query { a }"})
		require.NoError(t, err)
		require.Equal(t, StatusOK, result.Status)
	})

	t.Run("released when nobody uses it anymore", func(t *testing.T) {
		t.Parallel()

		pool, handlers := newPipePool(t, Options{Workers: 2})
		// Two graphs share the configuration.
		pool.Register(&Config{ID: "shared", Payload: []byte("graph")})
		pool.Register(&Config{ID: "shared", Payload: []byte("graph")})
		require.NoError(t, pool.Start(t.Context()))

		loaded := func() int {
			n := 0
			for _, h := range handlers.all() {
				n += len(h.loaded())
			}
			return n
		}
		require.Equal(t, 2, loaded())

		pool.Unregister("shared")
		result, err := pool.Plan(context.Background(), &Request{ConfigID: "shared", Content: "query { a }"})
		require.NoError(t, err)
		require.Equal(t, StatusOK, result.Status, "the configuration is still in use by the other graph")
		require.Equal(t, 2, loaded())

		pool.Unregister("shared")
		require.Eventually(t, func() bool { return loaded() == 0 }, 5*time.Second, time.Millisecond)

		result, err = pool.Plan(context.Background(), &Request{ConfigID: "shared", Content: "query { a }"})
		require.NoError(t, err)
		require.Equal(t, StatusFailed, result.Status)
		require.Contains(t, result.Message, "not registered")
	})

	t.Run("rejected by the worker", func(t *testing.T) {
		t.Parallel()

		core, logs := observer.New(zap.ErrorLevel)
		pool, _ := newPipePool(t, Options{Workers: 1, Logger: zap.New(core)})
		pool.Register(&Config{ID: "good", Payload: []byte("graph")})
		pool.Register(&Config{ID: "bad", Payload: []byte("invalid graph")})
		// A configuration the workers can't load must not keep them from starting.
		require.NoError(t, pool.Start(t.Context()))

		for range 3 {
			result, err := pool.Plan(context.Background(), &Request{ConfigID: "bad", Content: "query { a }"})
			require.NoError(t, err)
			require.Equal(t, StatusFailed, result.Status)
			require.Contains(t, result.Message, "payload is invalid")
		}

		result, err := pool.Plan(context.Background(), &Request{ConfigID: "good", Content: "query { a }"})
		require.NoError(t, err)
		require.Equal(t, StatusOK, result.Status)

		// The worker was asked once, not for every request, and it was not restarted.
		require.Equal(t, 1, logs.FilterMessageSnippet("can't load a configuration").Len())
		require.EqualValues(t, 1, pool.Stats().Starts)
	})
}

func TestPoolStart(t *testing.T) {
	t.Parallel()

	t.Run("fails if a worker can't be started", func(t *testing.T) {
		t.Parallel()

		pool := newTestPool(t, Options{
			Launcher: &ProcessLauncher{Command: []string{"/does/not/exist"}},
		})
		err := pool.Start(t.Context())
		require.ErrorContains(t, err, "failed to start query planning worker")

		_, err = pool.Plan(context.Background(), &Request{ConfigID: "a"})
		require.ErrorIs(t, err, ErrClosed)
	})

	for name, serveOptions := range map[string]ServeOptions{
		"fails if the worker is another version":           {Version: "0.0.1", PlanFormat: testPlanFormat},
		"fails if the worker produces another plan format": {Version: testVersion, PlanFormat: "other"},
	} {
		t.Run(name, func(t *testing.T) {
			t.Parallel()

			handlers := &pipeHandlers{}
			pool := newTestPool(t, Options{
				Launcher: &PipeLauncher{NewHandler: handlers.new, Options: serveOptions},
			})
			err := pool.Start(t.Context())
			require.ErrorContains(t, err, "not compatible with this router")
		})
	}

	t.Run("fails if the worker doesn't answer in time", func(t *testing.T) {
		t.Parallel()

		pool := newTestPool(t, Options{
			StartTimeout: 50 * time.Millisecond,
			Launcher:     silentLauncher{},
		})
		err := pool.Start(t.Context())
		require.ErrorIs(t, err, ErrTimeout)
	})
}

// silentLauncher starts workers that never say anything.
type silentLauncher struct{}

func (silentLauncher) Launch() (Conn, error) {
	return &silentConn{closed: make(chan struct{})}, nil
}

type silentConn struct {
	closeOnce sync.Once
	closed    chan struct{}
}

func (c *silentConn) Read([]byte) (int, error) {
	<-c.closed
	return 0, errors.New("closed")
}

func (c *silentConn) Write(p []byte) (int, error) { return len(p), nil }

func (c *silentConn) Close() error {
	c.closeOnce.Do(func() { close(c.closed) })
	return nil
}

func TestPoolClose(t *testing.T) {
	t.Parallel()

	block := make(chan struct{})
	t.Cleanup(func() { close(block) })
	handlers := &pipeHandlers{block: block}
	pool := newTestPool(t, Options{
		Workers:   1,
		QueueSize: 1,
		Launcher: &PipeLauncher{
			NewHandler: handlers.new,
			Options:    ServeOptions{Version: testVersion, PlanFormat: testPlanFormat},
		},
	})
	pool.Register(&Config{ID: "a", Payload: []byte("graph-a")})
	require.NoError(t, pool.Start(t.Context()))

	// One request is being planned, one is waiting.
	results := make(chan error, 2)
	for range 2 {
		go func() {
			_, err := pool.Plan(context.Background(), &Request{ConfigID: "a", Content: "query { a }"})
			results <- err
		}()
	}
	require.Eventually(t, func() bool { return handlers.planning() == 1 && len(pool.queue) == 1 }, 5*time.Second, time.Millisecond)

	pool.Close()

	for range 2 {
		require.ErrorIs(t, <-results, ErrClosed)
	}
	_, err := pool.Plan(context.Background(), &Request{ConfigID: "a"})
	require.ErrorIs(t, err, ErrClosed)
}

func TestPoolCallerGivesUp(t *testing.T) {
	t.Parallel()

	block := make(chan struct{})
	handlers := &pipeHandlers{block: block}
	pool := newTestPool(t, Options{
		Workers:   1,
		QueueSize: 4,
		Launcher: &PipeLauncher{
			NewHandler: handlers.new,
			Options:    ServeOptions{Version: testVersion, PlanFormat: testPlanFormat},
		},
	})
	pool.Register(&Config{ID: "a", Payload: []byte("graph-a")})
	require.NoError(t, pool.Start(t.Context()))

	first := make(chan error, 1)
	go func() {
		_, err := pool.Plan(context.Background(), &Request{ConfigID: "a", Content: "query { a }"})
		first <- err
	}()
	require.Eventually(t, func() bool { return handlers.planning() == 1 }, 5*time.Second, time.Millisecond)

	// The second request waits in the queue until its caller gives up.
	ctx, cancel := context.WithCancel(context.Background())
	second := make(chan error, 1)
	go func() {
		_, err := pool.Plan(ctx, &Request{ConfigID: "a", Content: "query { a }"})
		second <- err
	}()
	require.Eventually(t, func() bool { return len(pool.queue) == 1 }, 5*time.Second, time.Millisecond)
	cancel()
	require.ErrorIs(t, <-second, context.Canceled)

	close(block)
	require.NoError(t, <-first)

	// The abandoned request is dropped instead of being planned for nobody.
	result, err := pool.Plan(context.Background(), &Request{ConfigID: "a", Content: "query { a }"})
	require.NoError(t, err)
	require.Equal(t, StatusOK, result.Status)
	require.EqualValues(t, 2, pool.Stats().Requests)
}

func TestWorkerProcesses(t *testing.T) {
	t.Parallel()

	workerPID := func(t *testing.T, pool *Pool) string {
		t.Helper()
		result, err := pool.Plan(context.Background(), &Request{ConfigID: "a", Content: "query { a }", OperationName: "Q"})
		require.NoError(t, err)
		require.Equal(t, StatusOK, result.Status)
		parts := strings.Split(string(result.Plan), "|")
		require.Len(t, parts, 4)
		require.Equal(t, "\x00\xffgraph-a", parts[0])
		return parts[3]
	}

	t.Run("plans in another process", func(t *testing.T) {
		t.Parallel()

		pool := newProcessPool(t, Options{Workers: 2})
		pool.Register(&Config{ID: "a", Payload: []byte("graph-a")})
		require.NoError(t, pool.Start(t.Context()))

		pids := map[string]struct{}{}
		for range 20 {
			pids[workerPID(t, pool)] = struct{}{}
		}
		require.NotContains(t, pids, fmt.Sprint(os.Getpid()))
		require.LessOrEqual(t, len(pids), 2)
	})

	t.Run("stops a worker that takes too long and replaces it", func(t *testing.T) {
		t.Parallel()

		pool := newProcessPool(t, Options{Workers: 1, Timeout: 500 * time.Millisecond})
		pool.Register(&Config{ID: "a", Payload: []byte("graph-a")})
		require.NoError(t, pool.Start(t.Context()))

		before := workerPID(t, pool)

		start := time.Now()
		_, err := pool.Plan(context.Background(), &Request{ConfigID: "a", Content: "hang"})
		require.ErrorIs(t, err, ErrTimeout)
		require.Less(t, time.Since(start), 5*time.Second)

		// The next request is answered by a new process, the old one is gone.
		after := workerPID(t, pool)
		require.NotEqual(t, before, after)
		require.Equal(t, Stats{Requests: 2, Timeouts: 1, Starts: 2}, pool.Stats())
	})

	t.Run("replaces a worker that dies", func(t *testing.T) {
		t.Parallel()

		pool := newProcessPool(t, Options{Workers: 1})
		pool.Register(&Config{ID: "a", Payload: []byte("graph-a")})
		require.NoError(t, pool.Start(t.Context()))

		before := workerPID(t, pool)

		_, err := pool.Plan(context.Background(), &Request{ConfigID: "a", Content: "exit"})
		require.ErrorIs(t, err, ErrWorkerFailed)

		after := workerPID(t, pool)
		require.NotEqual(t, before, after)
		require.Equal(t, Stats{Requests: 2, Starts: 2}, pool.Stats())
	})

	t.Run("a request that waited too long is not planned", func(t *testing.T) {
		t.Parallel()

		pool := newProcessPool(t, Options{Workers: 1, Timeout: 500 * time.Millisecond})
		pool.Register(&Config{ID: "a", Payload: []byte("graph-a")})
		require.NoError(t, pool.Start(t.Context()))

		results := make(chan error, 2)
		for range 2 {
			go func() {
				_, err := pool.Plan(context.Background(), &Request{ConfigID: "a", Content: "hang"})
				results <- err
			}()
		}
		for range 2 {
			require.ErrorIs(t, <-results, ErrTimeout)
		}

		workerPID(t, pool)
		// The request that timed out in the queue never reached a worker. Otherwise
		// it would have cost another worker.
		require.Equal(t, Stats{Requests: 1, Timeouts: 2, Starts: 2}, pool.Stats())
	})
}

// deafLauncher starts workers that say hello and then stop reading, like a worker
// process that is stuck while the pipe to it is full.
type deafLauncher struct {
	inner Launcher
	// writing counts the writes that are blocked.
	writing *atomic.Int64
}

func (d deafLauncher) Launch() (Conn, error) {
	conn, err := d.inner.Launch()
	if err != nil {
		return nil, err
	}
	return &deafConn{Conn: conn, writing: d.writing, closed: make(chan struct{})}, nil
}

type deafConn struct {
	Conn
	writing   *atomic.Int64
	closeOnce sync.Once
	closed    chan struct{}
}

func (c *deafConn) Write([]byte) (int, error) {
	c.writing.Add(1)
	defer c.writing.Add(-1)
	<-c.closed
	return 0, errors.New("closed")
}

func (c *deafConn) Close() error {
	c.closeOnce.Do(func() { close(c.closed) })
	return c.Conn.Close()
}

func TestPoolDoesNotWaitForeverToSendARequest(t *testing.T) {
	t.Parallel()

	newLauncher := func() deafLauncher {
		handlers := &pipeHandlers{}
		return deafLauncher{
			inner: &PipeLauncher{
				NewHandler: handlers.new,
				Options:    ServeOptions{Version: testVersion, PlanFormat: testPlanFormat},
			},
			writing: &atomic.Int64{},
		}
	}

	t.Run("request", func(t *testing.T) {
		t.Parallel()

		pool := newTestPool(t, Options{Workers: 1, Timeout: 100 * time.Millisecond, Launcher: newLauncher()})
		// Without a configuration to load, the workers start without being written to.
		require.NoError(t, pool.Start(t.Context()))
		pool.Register(&Config{ID: "a", Payload: []byte("graph-a")})

		_, err := pool.Plan(context.Background(), &Request{ConfigID: "a", Content: "query { a }"})
		require.ErrorIs(t, err, ErrTimeout)
	})

	t.Run("close", func(t *testing.T) {
		t.Parallel()

		launcher := newLauncher()
		pool := newTestPool(t, Options{Workers: 1, Launcher: launcher})
		require.NoError(t, pool.Start(t.Context()))
		pool.Register(&Config{ID: "a", Payload: []byte("graph-a")})

		result := make(chan error, 1)
		go func() {
			_, err := pool.Plan(context.Background(), &Request{ConfigID: "a", Content: "query { a }"})
			result <- err
		}()
		require.Eventually(t, func() bool { return launcher.writing.Load() == 1 }, 5*time.Second, time.Millisecond)

		// Close returns although a worker is in the middle of a write that never completes.
		pool.Close()
		require.ErrorIs(t, <-result, ErrClosed)
	})
}

func TestNewPoolValidatesOptions(t *testing.T) {
	t.Parallel()

	valid := Options{Workers: 1, QueueSize: 1, Timeout: time.Second, Launcher: silentLauncher{}}

	_, err := NewPool(valid)
	require.NoError(t, err)

	for name, change := range map[string]func(*Options){
		"workers":  func(o *Options) { o.Workers = 0 },
		"queue":    func(o *Options) { o.QueueSize = 0 },
		"timeout":  func(o *Options) { o.Timeout = 0 },
		"launcher": func(o *Options) { o.Launcher = nil },
	} {
		t.Run(name, func(t *testing.T) {
			opts := valid
			change(&opts)
			_, err := NewPool(opts)
			require.Error(t, err)
		})
	}
}

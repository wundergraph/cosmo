package planworker

import (
	"context"
	"errors"
	"fmt"
	"io"
	"slices"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"go.uber.org/zap"
)

var (
	// ErrQueueFull is returned when all workers are busy and the queue has no room left.
	ErrQueueFull = errors.New("query planning queue is full")
	// ErrTimeout is returned when a request did not finish in time. If a worker was
	// already planning the operation, it has been stopped.
	ErrTimeout = errors.New("query planning timed out")
	// ErrClosed is returned for requests on a pool that is shut down.
	ErrClosed = errors.New("query planning workers are shut down")
	// ErrWorkerFailed is returned when the worker went away while planning the operation.
	ErrWorkerFailed = errors.New("query planning worker failed")
)

// Conn is the connection to a single worker.
type Conn interface {
	io.Reader
	io.Writer
	// Close stops the worker immediately, even if it is busy.
	Close() error
}

// Launcher starts workers.
type Launcher interface {
	Launch() (Conn, error)
}

type Options struct {
	// Workers is the number of workers and therefore the number of operations
	// that are planned in parallel.
	Workers int
	// QueueSize is the number of requests that can wait for a free worker.
	QueueSize int
	// Timeout limits how long a request can take, including the time it waits
	// in the queue. A worker that is still busy at that point is stopped.
	Timeout time.Duration
	// StartTimeout limits how long a worker can take to start and to load its
	// configurations.
	StartTimeout time.Duration
	// Version and PlanFormat have to match what the workers report.
	Version    string
	PlanFormat string
	Launcher   Launcher
	Logger     *zap.Logger
}

// Stats are counters describing the activity of a pool since it was created.
type Stats struct {
	// Requests is the number of requests answered by a worker.
	Requests uint64
	// Timeouts is the number of requests that ran out of time.
	Timeouts uint64
	// Rejected is the number of requests turned down because the queue was full.
	Rejected uint64
	// Starts is the number of workers started, including restarts.
	Starts uint64
}

// Pool distributes planning requests across a fixed number of workers.
type Pool struct {
	opts   Options
	logger *zap.Logger
	queue  chan *job

	configsMu sync.Mutex
	configs   map[string]*registeredConfig
	// reconcile has one channel per worker. A signal tells the worker that the
	// registered configurations changed.
	reconcile []chan struct{}

	startOnce sync.Once
	// started receives the result of the first start attempt of every worker.
	started chan error

	closeOnce sync.Once
	closed    chan struct{}
	wg        sync.WaitGroup

	requests, timeouts, rejected, starts atomic.Uint64
}

type registeredConfig struct {
	config *Config
	// refs counts the registrations, because two graphs can share a configuration.
	refs int
}

type job struct {
	ctx      context.Context
	request  *Request
	deadline time.Time
	done     chan jobResult
}

type jobResult struct {
	result *Result
	err    error
}

func NewPool(opts Options) (*Pool, error) {
	if opts.Workers < 1 {
		return nil, errors.New("at least one worker is required")
	}
	if opts.QueueSize < 1 {
		// Without a queue, a request would be turned down whenever no worker happens
		// to be waiting for one at that very moment.
		return nil, errors.New("queue size must be at least one")
	}
	if opts.Timeout <= 0 {
		return nil, errors.New("timeout must be positive")
	}
	if opts.Launcher == nil {
		return nil, errors.New("launcher is required")
	}
	if opts.StartTimeout <= 0 {
		opts.StartTimeout = time.Minute
	}
	if opts.Logger == nil {
		opts.Logger = zap.NewNop()
	}
	p := &Pool{
		opts:      opts,
		logger:    opts.Logger,
		queue:     make(chan *job, opts.QueueSize),
		configs:   make(map[string]*registeredConfig),
		reconcile: make([]chan struct{}, opts.Workers),
		started:   make(chan error, opts.Workers),
		closed:    make(chan struct{}),
	}
	for i := range p.reconcile {
		p.reconcile[i] = make(chan struct{}, 1)
	}
	return p, nil
}

// Register makes a configuration available to requests. Workers start loading it right
// away, and requests for it wait until the worker handling them has it loaded.
// Every call has to be paired with a call to Unregister.
func (p *Pool) Register(config *Config) {
	p.configsMu.Lock()
	if existing, ok := p.configs[config.ID]; ok {
		existing.refs++
	} else {
		p.configs[config.ID] = &registeredConfig{config: config, refs: 1}
	}
	p.configsMu.Unlock()
	p.signalReconcile()
}

// Unregister releases a configuration. Workers drop it once nobody uses it anymore.
func (p *Pool) Unregister(id string) {
	p.configsMu.Lock()
	if existing, ok := p.configs[id]; ok {
		existing.refs--
		if existing.refs <= 0 {
			delete(p.configs, id)
		}
	}
	p.configsMu.Unlock()
	p.signalReconcile()
}

func (p *Pool) signalReconcile() {
	for _, ch := range p.reconcile {
		select {
		case ch <- struct{}{}:
		default:
			// The worker already knows that it has to catch up.
		}
	}
}

func (p *Pool) config(id string) *Config {
	p.configsMu.Lock()
	defer p.configsMu.Unlock()
	if registered, ok := p.configs[id]; ok {
		return registered.config
	}
	return nil
}

// registeredConfigs returns the registered configurations in a stable order.
func (p *Pool) registeredConfigs() []*Config {
	p.configsMu.Lock()
	defer p.configsMu.Unlock()
	out := make([]*Config, 0, len(p.configs))
	for _, registered := range p.configs {
		out = append(out, registered.config)
	}
	slices.SortFunc(out, func(a, b *Config) int {
		return strings.Compare(a.ID, b.ID)
	})
	return out
}

// Start starts all workers and waits until they are ready to plan. It fails if any of
// them can't be started, in which case the pool is closed.
func (p *Pool) Start(ctx context.Context) error {
	p.startOnce.Do(func() {
		for i := range p.opts.Workers {
			p.wg.Add(1)
			go p.runWorker(i)
		}
	})
	for range p.opts.Workers {
		select {
		case err := <-p.started:
			if err != nil {
				p.Close()
				return err
			}
		case <-ctx.Done():
			p.Close()
			return ctx.Err()
		case <-p.closed:
			return ErrClosed
		}
	}
	return nil
}

// Close stops all workers. Requests that are in flight or waiting fail with ErrClosed.
func (p *Pool) Close() {
	p.closeOnce.Do(func() {
		close(p.closed)
	})
	p.wg.Wait()
}

func (p *Pool) Stats() Stats {
	return Stats{
		Requests: p.requests.Load(),
		Timeouts: p.timeouts.Load(),
		Rejected: p.rejected.Load(),
		Starts:   p.starts.Load(),
	}
}

// Plan queues the request and waits for a worker to answer it. The context only
// controls how long the caller waits. Once a worker picked the request up, it is
// not interrupted before the timeout of the pool.
func (p *Pool) Plan(ctx context.Context, request *Request) (*Result, error) {
	j := &job{
		ctx:      ctx,
		request:  request,
		deadline: time.Now().Add(p.opts.Timeout),
		done:     make(chan jobResult, 1),
	}

	select {
	case <-p.closed:
		return nil, ErrClosed
	default:
	}

	select {
	case p.queue <- j:
	default:
		p.rejected.Add(1)
		return nil, ErrQueueFull
	}

	timer := time.NewTimer(time.Until(j.deadline))
	defer timer.Stop()

	select {
	case res := <-j.done:
		if errors.Is(res.err, ErrTimeout) {
			p.timeouts.Add(1)
		}
		return res.result, res.err
	case <-timer.C:
		// Either the request never left the queue, or the worker planning it is
		// about to be stopped.
		p.timeouts.Add(1)
		return nil, ErrTimeout
	case <-ctx.Done():
		return nil, ctx.Err()
	case <-p.closed:
		return nil, ErrClosed
	}
}

const (
	minRestartDelay = 100 * time.Millisecond
	maxRestartDelay = 10 * time.Second
)

func (p *Pool) runWorker(index int) {
	defer p.wg.Done()

	logger := p.logger.With(zap.Int("worker", index))

	var (
		w            *worker
		restartDelay time.Duration
		reported     bool
	)
	// report passes the outcome of the first start attempt to Start.
	report := func(err error) {
		if !reported {
			reported = true
			p.started <- err
		}
	}
	defer func() {
		if w != nil {
			w.close()
		}
	}()

	for {
		if w == nil {
			if restartDelay > 0 {
				select {
				case <-p.closed:
					return
				case <-time.After(restartDelay):
				}
			}
			var err error
			w, err = p.startWorker(logger)
			if err != nil {
				report(fmt.Errorf("failed to start query planning worker: %w", err))
				logger.Error("Failed to start query planning worker", zap.Error(err), zap.Duration("retry_in", nextRestartDelay(restartDelay)))
				restartDelay = nextRestartDelay(restartDelay)
				continue
			}
			restartDelay = 0
			report(nil)
		}

		select {
		case <-p.closed:
			return
		case <-p.reconcile[index]:
			if err := w.reconcile(p, logger, time.Now().Add(p.opts.StartTimeout)); err != nil {
				if !errors.Is(err, ErrClosed) {
					logger.Warn("Query planning worker failed to load its configurations, restarting it", zap.Error(err))
				}
				w.close()
				w = nil
				restartDelay = minRestartDelay
			}
		case in := <-w.frames:
			// The worker has nothing to say unless asked, so this is the worker going away.
			logger.Warn("Query planning worker stopped unexpectedly, restarting it", zap.Error(in.err))
			w.close()
			w = nil
			restartDelay = minRestartDelay
		case j := <-p.queue:
			if j.ctx.Err() != nil || !time.Now().Before(j.deadline) {
				// Nobody is waiting for the result anymore.
				continue
			}
			result, err := w.plan(p, logger, j)
			if err != nil {
				if errors.Is(err, ErrTimeout) {
					logger.Warn("Query planning timed out, stopping the worker",
						zap.String("operation_name", j.request.OperationName),
						zap.Duration("timeout", p.opts.Timeout),
					)
				} else if !errors.Is(err, ErrClosed) {
					logger.Warn("Query planning worker failed, restarting it",
						zap.String("operation_name", j.request.OperationName),
						zap.Error(err),
					)
				}
				// After a failure we don't know what state the worker and the stream
				// are in. A fresh worker is the only safe way to continue.
				w.close()
				w = nil
				restartDelay = minRestartDelay
			} else {
				p.requests.Add(1)
			}
			j.done <- jobResult{result: result, err: err}
		}
	}
}

func nextRestartDelay(current time.Duration) time.Duration {
	if current < minRestartDelay {
		return minRestartDelay
	}
	return min(current*2, maxRestartDelay)
}

type incomingFrame struct {
	frame *frame
	err   error
}

// worker is the router's view of a single running worker.
type worker struct {
	conn   Conn
	frames chan incomingFrame
	// configured are the IDs of the configurations the worker has loaded.
	configured map[string]struct{}
	// rejected are the configurations the worker could not load, with the reason.
	// Loading a configuration is deterministic, there is no point in trying again.
	rejected  map[string]string
	closeOnce sync.Once
	closed    chan struct{}
}

func (p *Pool) startWorker(logger *zap.Logger) (*worker, error) {
	conn, err := p.opts.Launcher.Launch()
	if err != nil {
		return nil, err
	}
	p.starts.Add(1)

	w := &worker{
		conn:       conn,
		frames:     make(chan incomingFrame),
		configured: make(map[string]struct{}),
		rejected:   make(map[string]string),
		closed:     make(chan struct{}),
	}
	go w.read()

	deadline := time.Now().Add(p.opts.StartTimeout)

	f, err := w.receive(p, deadline)
	if err != nil {
		w.close()
		return nil, fmt.Errorf("worker did not introduce itself: %w", err)
	}
	var hello Hello
	if err := f.decode(messageHello, &hello); err != nil {
		w.close()
		return nil, err
	}
	if hello.ProtocolVersion != ProtocolVersion || hello.Version != p.opts.Version || hello.PlanFormat != p.opts.PlanFormat {
		w.close()
		return nil, fmt.Errorf(
			"worker is not compatible with this router, it must be the same build: worker has version %q, protocol %d and plan format %q, the router has version %q, protocol %d and plan format %q",
			hello.Version, hello.ProtocolVersion, hello.PlanFormat,
			p.opts.Version, ProtocolVersion, p.opts.PlanFormat,
		)
	}

	if err := w.reconcile(p, logger, deadline); err != nil {
		w.close()
		return nil, err
	}

	logger.Debug("Query planning worker started", zap.Int("worker_pid", hello.PID))

	return w, nil
}

// read forwards everything the worker sends until the connection breaks.
func (w *worker) read() {
	for {
		f, err := readFrame(w.conn)
		select {
		case w.frames <- incomingFrame{frame: f, err: err}:
		case <-w.closed:
			return
		}
		if err != nil {
			return
		}
	}
}

func (w *worker) close() {
	w.closeOnce.Do(func() {
		close(w.closed)
		_ = w.conn.Close()
	})
}

// send writes a message to the worker.
//
// A write blocks for as long as the worker doesn't read, which a worker that is stuck
// never does. Closing the connection is the only way to interrupt a write, so that is
// what happens at the deadline. The worker is unusable afterwards.
func (w *worker) send(p *Pool, deadline time.Time, typ messageType, header any, blob []byte) error {
	var (
		done             = make(chan struct{})
		timedOut, closed atomic.Bool
	)
	go func() {
		timer := time.NewTimer(time.Until(deadline))
		defer timer.Stop()
		select {
		case <-done:
		case <-timer.C:
			timedOut.Store(true)
			w.close()
		case <-p.closed:
			closed.Store(true)
			w.close()
		}
	}()
	err := writeFrame(w.conn, typ, header, blob)
	close(done)
	switch {
	case err == nil:
		return nil
	case timedOut.Load():
		return ErrTimeout
	case closed.Load():
		return ErrClosed
	}
	return fmt.Errorf("%w: %w", ErrWorkerFailed, err)
}

// receive waits for the next message of the worker.
func (w *worker) receive(p *Pool, deadline time.Time) (*frame, error) {
	timer := time.NewTimer(time.Until(deadline))
	defer timer.Stop()

	select {
	case in := <-w.frames:
		if in.err != nil {
			return nil, fmt.Errorf("%w: %w", ErrWorkerFailed, in.err)
		}
		return in.frame, nil
	case <-timer.C:
		return nil, ErrTimeout
	case <-p.closed:
		return nil, ErrClosed
	}
}

// reconcile makes the worker load the registered configurations it doesn't have yet
// and drop the ones that are no longer registered.
//
// A configuration the worker rejects is not an error here. The worker is fine, it
// just can't plan for that graph, which requests for it are told.
func (w *worker) reconcile(p *Pool, logger *zap.Logger, deadline time.Time) error {
	registered := p.registeredConfigs()
	isRegistered := func(id string) bool {
		return slices.ContainsFunc(registered, func(c *Config) bool { return c.ID == id })
	}
	for id := range w.rejected {
		if !isRegistered(id) {
			delete(w.rejected, id)
		}
	}
	for id := range w.configured {
		if isRegistered(id) {
			continue
		}
		if err := w.send(p, deadline, messageRelease, &configureHeader{ID: id}, nil); err != nil {
			return fmt.Errorf("failed to release configuration: %w", err)
		}
		delete(w.configured, id)
	}
	for _, config := range registered {
		if _, err := w.configure(p, logger, config, deadline); err != nil {
			return err
		}
	}
	return nil
}

// configure makes sure the worker has loaded the configuration. If the worker can't
// load it, the reason is returned as rejection. An error means the worker is broken.
func (w *worker) configure(p *Pool, logger *zap.Logger, config *Config, deadline time.Time) (rejection string, err error) {
	if _, ok := w.configured[config.ID]; ok {
		return "", nil
	}
	if reason, ok := w.rejected[config.ID]; ok {
		return reason, nil
	}
	if err := w.send(p, deadline, messageConfigure, &configureHeader{ID: config.ID}, config.Payload); err != nil {
		return "", fmt.Errorf("failed to send configuration: %w", err)
	}
	f, err := w.receive(p, deadline)
	if err != nil {
		return "", fmt.Errorf("failed to load configuration: %w", err)
	}
	var result configureResultHeader
	if err := f.decode(messageConfigureResult, &result); err != nil {
		return "", fmt.Errorf("%w: %w", ErrWorkerFailed, err)
	}
	if result.Error != "" {
		w.rejected[config.ID] = result.Error
		logger.Error("Query planning worker can't load a configuration, operations of that graph are not planned by workers",
			zap.String("config_id", config.ID),
			zap.String("error", result.Error),
		)
		return result.Error, nil
	}
	w.configured[config.ID] = struct{}{}
	return "", nil
}

func (w *worker) plan(p *Pool, logger *zap.Logger, j *job) (*Result, error) {
	config := p.config(j.request.ConfigID)
	if config == nil {
		// Not a problem of the worker, it stays usable.
		return &Result{
			Status:  StatusFailed,
			Message: fmt.Sprintf("configuration %q is not registered", j.request.ConfigID),
		}, nil
	}
	rejection, err := w.configure(p, logger, config, j.deadline)
	if err != nil {
		return nil, err
	}
	if rejection != "" {
		return &Result{
			Status:  StatusFailed,
			Message: fmt.Sprintf("worker failed to load configuration: %s", rejection),
		}, nil
	}
	if err := w.send(p, j.deadline, messagePlan, j.request, nil); err != nil {
		return nil, fmt.Errorf("failed to send request: %w", err)
	}
	f, err := w.receive(p, j.deadline)
	if err != nil {
		return nil, err
	}
	var result Result
	if err := f.decode(messagePlanResult, &result); err != nil {
		return nil, fmt.Errorf("%w: %w", ErrWorkerFailed, err)
	}
	result.Plan = f.blob
	return &result, nil
}

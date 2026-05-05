package storage

import (
	"context"
	"errors"
	"sort"
	"sync"
	"sync/atomic"
	"time"

	"github.com/wundergraph/graphql-go-tools/v2/pkg/ast"
)

const (
	defaultSessionTTL     = 30 * time.Minute
	defaultMaxSessions    = 1_000
	defaultMaxBundleBytes = 1 << 20
)

type MemoryConfig struct {
	SessionTTL     time.Duration
	MaxSessions    int
	MaxBundleBytes int
	Renderer       Renderer
	Now            func() time.Time
}

type MemoryBackend struct {
	sessionTTL     time.Duration
	maxSessions    int
	maxBundleBytes int
	renderer       Renderer
	now            func() time.Time

	sessions sync.Map

	schemaMu sync.RWMutex
	schema   *ast.Document

	schemaVer atomic.Uint64

	lifecycleMu sync.Mutex
	cancel      context.CancelFunc
	done        chan struct{}
}

type memSession struct {
	mu          sync.Mutex
	ops         []SessionOp
	lastUsed    time.Time
	bundle      string
	bundleValid bool
}

type sessionSnapshot struct {
	id       string
	lastUsed time.Time
}

func NewMemoryBackend(config MemoryConfig) *MemoryBackend {
	if config.SessionTTL <= 0 {
		config.SessionTTL = defaultSessionTTL
	}
	if config.MaxSessions <= 0 {
		config.MaxSessions = defaultMaxSessions
	}
	if config.MaxBundleBytes < 0 {
		config.MaxBundleBytes = 0
	}
	if config.MaxBundleBytes == 0 {
		config.MaxBundleBytes = defaultMaxBundleBytes
	}
	if config.Now == nil {
		config.Now = time.Now
	}

	return &MemoryBackend{
		sessionTTL:     config.SessionTTL,
		maxSessions:    config.MaxSessions,
		maxBundleBytes: config.MaxBundleBytes,
		renderer:       config.Renderer,
		now:            config.Now,
	}
}

func (b *MemoryBackend) Append(ctx context.Context, sessionID string, ops []SessionOp) ([]SessionOp, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if len(ops) == 0 {
		return nil, nil
	}

	session := b.loadOrCreateSession(sessionID)
	session.mu.Lock()
	appended := make([]SessionOp, 0, len(ops))
	taken := make(map[string]struct{}, len(session.ops)+len(ops))
	for _, op := range session.ops {
		taken[op.Name] = struct{}{}
	}
	for _, op := range ops {
		op.Name = SuffixedName(NormalizeName(op.Name), taken)
		taken[op.Name] = struct{}{}
		session.ops = append(session.ops, op)
		appended = append(appended, op)
	}
	session.lastUsed = b.now()
	session.bundle = ""
	session.bundleValid = false
	session.mu.Unlock()

	b.enforceMaxSessions()
	return appended, nil
}

func (b *MemoryBackend) GetOp(ctx context.Context, sessionID string, name string) (SessionOp, bool, error) {
	if err := ctx.Err(); err != nil {
		return SessionOp{}, false, err
	}

	value, ok := b.sessions.Load(sessionID)
	if !ok {
		return SessionOp{}, false, nil
	}
	session := value.(*memSession)
	session.mu.Lock()
	defer session.mu.Unlock()

	session.lastUsed = b.now()
	for _, op := range session.ops {
		if op.Name == name {
			return op, true, nil
		}
	}
	return SessionOp{}, false, nil
}

func (b *MemoryBackend) ListNames(ctx context.Context, sessionID string) ([]string, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}

	value, ok := b.sessions.Load(sessionID)
	if !ok {
		return nil, nil
	}
	session := value.(*memSession)
	session.mu.Lock()
	defer session.mu.Unlock()

	session.lastUsed = b.now()
	names := make([]string, 0, len(session.ops))
	for _, op := range session.ops {
		names = append(names, op.Name)
	}
	return names, nil
}

func (b *MemoryBackend) Bundle(ctx context.Context, sessionID string) (string, error) {
	if err := ctx.Err(); err != nil {
		return "", err
	}

	value, ok := b.sessions.Load(sessionID)
	if !ok {
		return b.renderCapped(ctx, nil)
	}
	session := value.(*memSession)

	session.mu.Lock()
	defer session.mu.Unlock()

	session.lastUsed = b.now()
	if session.bundleValid {
		return session.bundle, nil
	}

	if b.renderer == nil {
		return "", errors.New("code mode storage renderer is not configured")
	}

	ops := append([]SessionOp(nil), session.ops...)
	bundle, err := b.renderCapped(ctx, ops)
	if err != nil {
		return "", err
	}

	session.bundle = bundle
	session.bundleValid = true
	return bundle, nil
}

func (b *MemoryBackend) Reset(ctx context.Context, sessionID string) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	b.sessions.Delete(sessionID)
	return nil
}

func (b *MemoryBackend) SetSchema(schema *ast.Document) {
	b.schemaMu.Lock()
	b.schema = schema
	b.schemaMu.Unlock()

	b.schemaVer.Add(1)
	b.clearSessions()
}

func (b *MemoryBackend) Schema() *ast.Document {
	b.schemaMu.RLock()
	defer b.schemaMu.RUnlock()
	return b.schema
}

func (b *MemoryBackend) SchemaVersion() uint64 {
	return b.schemaVer.Load()
}

func (b *MemoryBackend) Start(ctx context.Context) error {
	b.lifecycleMu.Lock()
	defer b.lifecycleMu.Unlock()

	if b.cancel != nil {
		return nil
	}

	runCtx, cancel := context.WithCancel(ctx)
	b.cancel = cancel
	b.done = make(chan struct{})
	go b.runSweeper(runCtx, b.done)
	return nil
}

func (b *MemoryBackend) Stop() error {
	b.lifecycleMu.Lock()
	cancel := b.cancel
	done := b.done
	b.cancel = nil
	b.done = nil
	b.lifecycleMu.Unlock()

	if cancel == nil {
		return nil
	}
	cancel()
	<-done
	return nil
}

func (b *MemoryBackend) loadOrCreateSession(sessionID string) *memSession {
	now := b.now()
	session := &memSession{lastUsed: now}
	value, _ := b.sessions.LoadOrStore(sessionID, session)
	return value.(*memSession)
}

func (b *MemoryBackend) renderCapped(ctx context.Context, ops []SessionOp) (string, error) {
	bundle, err := b.renderer.Render(ctx, ops, b.Schema())
	if err != nil {
		return "", err
	}
	if b.maxBundleBytes <= 0 || len(bundle) <= b.maxBundleBytes {
		return bundle, nil
	}

	for keep := len(ops) - 1; keep >= 0; keep-- {
		if err := ctx.Err(); err != nil {
			return "", err
		}
		truncated, err := b.renderer.Render(ctx, ops[:keep], b.Schema())
		if err != nil {
			return "", err
		}
		if len(truncated) <= b.maxBundleBytes {
			return truncated, nil
		}
	}
	return "", nil
}

func (b *MemoryBackend) runSweeper(ctx context.Context, done chan<- struct{}) {
	defer close(done)

	interval := b.sessionTTL / 4
	if interval <= 0 {
		interval = time.Second
	}
	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			b.sweepIdle()
			b.enforceMaxSessions()
		}
	}
}

func (b *MemoryBackend) sweepIdle() {
	if b.sessionTTL <= 0 {
		return
	}

	cutoff := b.now().Add(-b.sessionTTL)
	b.sessions.Range(func(key, value any) bool {
		session := value.(*memSession)
		session.mu.Lock()
		expired := !session.lastUsed.After(cutoff)
		session.mu.Unlock()
		if expired {
			b.sessions.Delete(key)
		}
		return true
	})
}

func (b *MemoryBackend) enforceMaxSessions() {
	if b.maxSessions <= 0 {
		return
	}

	snapshots := make([]sessionSnapshot, 0)
	b.sessions.Range(func(key, value any) bool {
		session := value.(*memSession)
		session.mu.Lock()
		snapshots = append(snapshots, sessionSnapshot{id: key.(string), lastUsed: session.lastUsed})
		session.mu.Unlock()
		return true
	})
	if len(snapshots) <= b.maxSessions {
		return
	}

	sort.Slice(snapshots, func(i, j int) bool {
		if snapshots[i].lastUsed.Equal(snapshots[j].lastUsed) {
			return snapshots[i].id < snapshots[j].id
		}
		return snapshots[i].lastUsed.Before(snapshots[j].lastUsed)
	})
	for _, snapshot := range snapshots[:len(snapshots)-b.maxSessions] {
		b.sessions.Delete(snapshot.id)
	}
}

func (b *MemoryBackend) clearSessions() {
	b.sessions.Range(func(key, _ any) bool {
		b.sessions.Delete(key)
		return true
	})
}

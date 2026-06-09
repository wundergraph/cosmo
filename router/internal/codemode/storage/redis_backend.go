package storage

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sync"
	"sync/atomic"
	"time"

	"github.com/redis/go-redis/v9"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/ast"
	"go.uber.org/zap"
)

const defaultRedisKeyPrefix = "cosmo_code_mode"

var _ SessionStorage = (*RedisBackend)(nil)

type RedisConfig struct {
	Client     redis.UniversalClient
	KeyPrefix  string
	SessionTTL time.Duration
	Renderer   Renderer
	Logger     *zap.Logger
	Now        func() time.Time
}

type RedisBackend struct {
	client     redis.UniversalClient
	keyPrefix  string
	sessionTTL time.Duration
	renderer   Renderer
	logger     *zap.Logger
	now        func() time.Time

	schemaMu  sync.RWMutex
	schema    *ast.Document
	schemaVer atomic.Uint64
}

type redisOpEntry struct {
	SessionOp
	LastUsed time.Time `json:"last_used"`
}

type redisBundleEntry struct {
	Bundle     string    `json:"bundle"`
	SchemaVer  uint64    `json:"schema_ver"`
	RenderedAt time.Time `json:"rendered_at"`
}

func NewRedisBackend(cfg RedisConfig) (*RedisBackend, error) {
	if cfg.Client == nil {
		return nil, errors.New("code mode redis storage client is not configured")
	}
	if cfg.KeyPrefix == "" {
		cfg.KeyPrefix = defaultRedisKeyPrefix
	}
	if cfg.SessionTTL <= 0 {
		cfg.SessionTTL = defaultSessionTTL
	}
	if cfg.Logger == nil {
		cfg.Logger = zap.NewNop()
	}
	if cfg.Now == nil {
		cfg.Now = time.Now
	}

	return &RedisBackend{
		client:     cfg.Client,
		keyPrefix:  cfg.KeyPrefix,
		sessionTTL: cfg.SessionTTL,
		renderer:   cfg.Renderer,
		logger:     cfg.Logger,
		now:        cfg.Now,
	}, nil
}

func (b *RedisBackend) Append(ctx context.Context, sessionID string, ops []SessionOp) ([]SessionOp, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if len(ops) == 0 {
		return nil, nil
	}

	backoff := 5 * time.Millisecond
	var appended []SessionOp
	for {
		if err := ctx.Err(); err != nil {
			return nil, err
		}

		opsKey := b.opsKey(sessionID)
		bundleKey := b.bundleKey(sessionID)
		now := b.now()
		err := b.client.Watch(ctx, func(tx *redis.Tx) error {
			entries, err := b.readOps(ctx, tx, opsKey)
			if err != nil {
				return err
			}

			taken := make(map[string]struct{}, len(entries)+len(ops))
			for _, entry := range entries {
				taken[entry.Name] = struct{}{}
			}
			appended = make([]SessionOp, 0, len(ops))
			for _, op := range ops {
				op.Name = SuffixedName(NormalizeName(op.Name), taken)
				taken[op.Name] = struct{}{}
				entries = append(entries, redisOpEntry{
					SessionOp: op,
					LastUsed:  now,
				})
				appended = append(appended, op)
			}
			payload, err := json.Marshal(entries)
			if err != nil {
				return err
			}

			_, err = tx.TxPipelined(ctx, func(pipe redis.Pipeliner) error {
				pipe.Set(ctx, opsKey, payload, 0)
				pipe.Expire(ctx, opsKey, b.sessionTTL)
				pipe.Del(ctx, bundleKey)
				return nil
			})
			return err
		}, opsKey)
		if err == nil {
			return appended, nil
		}

		b.logger.Debug("retrying code mode redis append",
			zap.String("session_id", sessionID),
			zap.Error(err),
		)
		if err := sleepWithContext(ctx, backoff); err != nil {
			return nil, err
		}
		backoff *= 2
		if backoff > 100*time.Millisecond {
			backoff = 100 * time.Millisecond
		}
	}
}

func (b *RedisBackend) GetOp(ctx context.Context, sessionID string, name string) (SessionOp, bool, error) {
	if err := ctx.Err(); err != nil {
		return SessionOp{}, false, err
	}

	opsKey := b.opsKey(sessionID)
	entries, err := b.readOps(ctx, b.client, opsKey)
	if err != nil {
		return SessionOp{}, false, err
	}

	for i, entry := range entries {
		if entry.Name != name {
			continue
		}
		entries[i].LastUsed = b.now()
		b.touchOpBestEffort(ctx, opsKey, name)
		return entry.SessionOp, true, nil
	}
	return SessionOp{}, false, nil
}

func (b *RedisBackend) ListNames(ctx context.Context, sessionID string) ([]string, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}

	entries, err := b.readOps(ctx, b.client, b.opsKey(sessionID))
	if err != nil {
		return nil, err
	}

	names := make([]string, 0, len(entries))
	for _, entry := range entries {
		names = append(names, entry.Name)
	}
	return names, nil
}

func (b *RedisBackend) Bundle(ctx context.Context, sessionID string) (string, error) {
	if err := ctx.Err(); err != nil {
		return "", err
	}

	bundleKey := b.bundleKey(sessionID)
	cached, err := b.client.Get(ctx, bundleKey).Bytes()
	if err == nil {
		var entry redisBundleEntry
		if err := json.Unmarshal(cached, &entry); err != nil {
			return "", fmt.Errorf("decode code mode redis bundle: %w", err)
		}
		if entry.SchemaVer == b.SchemaVersion() {
			return entry.Bundle, nil
		}
	} else if !errors.Is(err, redis.Nil) {
		return "", err
	}

	opsKey := b.opsKey(sessionID)
	entries, err := b.readOps(ctx, b.client, opsKey)
	if err != nil {
		return "", err
	}
	if len(entries) == 0 {
		if b.renderer == nil {
			return "", errors.New("code mode storage renderer is not configured")
		}
		return b.renderer.Render(ctx, nil, b.Schema())
	}
	if b.renderer == nil {
		return "", errors.New("code mode storage renderer is not configured")
	}

	ops := make([]SessionOp, 0, len(entries))
	for _, entry := range entries {
		ops = append(ops, entry.SessionOp)
	}
	bundle, err := b.renderer.Render(ctx, ops, b.Schema())
	if err != nil {
		return "", err
	}

	payload, err := json.Marshal(redisBundleEntry{
		Bundle:     bundle,
		SchemaVer:  b.SchemaVersion(),
		RenderedAt: b.now(),
	})
	if err != nil {
		return "", err
	}
	if err := b.setWithTTL(ctx, bundleKey, payload); err != nil {
		b.logger.Warn("failed to cache code mode redis bundle",
			zap.String("session_id", sessionID),
			zap.Error(err),
		)
	}
	return bundle, nil
}

func (b *RedisBackend) Reset(ctx context.Context, sessionID string) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	return b.client.Del(ctx, b.opsKey(sessionID), b.bundleKey(sessionID)).Err()
}

func (b *RedisBackend) SetSchema(schema *ast.Document) {
	b.schemaMu.Lock()
	b.schema = schema
	b.schemaMu.Unlock()

	b.schemaVer.Add(1)
}

func (b *RedisBackend) Schema() *ast.Document {
	b.schemaMu.RLock()
	defer b.schemaMu.RUnlock()
	return b.schema
}

func (b *RedisBackend) SchemaVersion() uint64 {
	return b.schemaVer.Load()
}

func (b *RedisBackend) Start(context.Context) error {
	return nil
}

func (b *RedisBackend) Stop() error {
	return nil
}

func (b *RedisBackend) opsKey(sessionID string) string {
	return fmt.Sprintf("%s:s:%d:%s:ops", b.keyPrefix, b.SchemaVersion(), sessionID)
}

func (b *RedisBackend) bundleKey(sessionID string) string {
	return fmt.Sprintf("%s:s:%d:%s:bundle", b.keyPrefix, b.SchemaVersion(), sessionID)
}

type redisStringGetter interface {
	Get(context.Context, string) *redis.StringCmd
}

func (b *RedisBackend) readOps(ctx context.Context, getter redisStringGetter, key string) ([]redisOpEntry, error) {
	raw, err := getter.Get(ctx, key).Bytes()
	if errors.Is(err, redis.Nil) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}

	var entries []redisOpEntry
	if err := json.Unmarshal(raw, &entries); err != nil {
		return nil, fmt.Errorf("decode code mode redis ops: %w", err)
	}
	return entries, nil
}

func (b *RedisBackend) touchOpBestEffort(ctx context.Context, key string, name string) {
	err := b.client.Watch(ctx, func(tx *redis.Tx) error {
		entries, err := b.readOps(ctx, tx, key)
		if err != nil {
			return err
		}

		found := false
		for i := range entries {
			if entries[i].Name == name {
				entries[i].LastUsed = b.now()
				found = true
				break
			}
		}
		if !found {
			return nil
		}

		payload, err := json.Marshal(entries)
		if err != nil {
			return err
		}
		_, err = tx.TxPipelined(ctx, func(pipe redis.Pipeliner) error {
			pipe.Set(ctx, key, payload, 0)
			pipe.Expire(ctx, key, b.sessionTTL)
			return nil
		})
		return err
	}, key)
	if err != nil && !errors.Is(err, redis.TxFailedErr) {
		b.logger.Warn("failed to update code mode redis op last_used", zap.Error(err))
	}
}

func (b *RedisBackend) setWithTTL(ctx context.Context, key string, value []byte) error {
	if err := b.client.Set(ctx, key, value, 0).Err(); err != nil {
		return err
	}
	return b.client.Expire(ctx, key, b.sessionTTL).Err()
}

func sleepWithContext(ctx context.Context, duration time.Duration) error {
	timer := time.NewTimer(duration)
	defer timer.Stop()

	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}

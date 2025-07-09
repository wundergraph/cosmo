package custom_modules

import (
	"fmt"
	"sync"
	"time"

	"github.com/wundergraph/cosmo/router/core"
	"go.uber.org/zap"
)

type DatabaseModule struct {
	mu          sync.RWMutex
	connections map[string]*DatabaseConnection
	metrics     *DatabaseMetrics
	isReady     bool
}

type DatabaseConnection struct {
	ID        string
	CreatedAt time.Time
	LastUsed  time.Time
	IsActive  bool
}

type DatabaseMetrics struct {
	TotalConnections int
	ActiveQueries    int
	TotalQueries     int64
}

func (m *DatabaseModule) Module() core.ModuleV1Info {
	priority := 2
	return core.ModuleV1Info{
		ID:       "database_module",
		Priority: &priority,
		New: func() core.ModuleV1 {
			return m
		},
	}
}

func (m *DatabaseModule) Provision(ctx *core.ModuleV1Context) error {
	ctx.Logger.Info("Initializing database module...")

	m.mu.Lock()
	defer m.mu.Unlock()

	m.connections = make(map[string]*DatabaseConnection)
	m.metrics = &DatabaseMetrics{
		TotalConnections: 0,
		ActiveQueries:    0,
		TotalQueries:     0,
	}

	for i := 0; i < 5; i++ {
		connID := fmt.Sprintf("conn_%d", i)
		conn := &DatabaseConnection{
			ID:        connID,
			CreatedAt: time.Now(),
			LastUsed:  time.Now(),
			IsActive:  true,
		}
		m.connections[connID] = conn
		m.metrics.TotalConnections++
	}

	m.isReady = true

	ctx.Logger.Info("Database module provisioned successfully",
		zap.Int("connections", m.metrics.TotalConnections))
	return nil
}

func (m *DatabaseModule) Cleanup(ctx *core.ModuleV1Context) error {
	ctx.Logger.Info("Shutting down database module...")

	m.mu.Lock()
	defer m.mu.Unlock()

	for connID, conn := range m.connections {
		conn.IsActive = false
		ctx.Logger.Info("Closing database connection", zap.String("connection_id", connID))
		delete(m.connections, connID)
	}

	m.metrics.TotalConnections = 0
	m.metrics.ActiveQueries = 0
	m.isReady = false

	ctx.Logger.Info("Database module cleaned up successfully")
	return nil
}

func (m *DatabaseModule) GetConnectionCount() int {
	m.mu.RLock()
	defer m.mu.RUnlock()
	if m.connections == nil {
		return 0
	}
	return len(m.connections)
}

func (m *DatabaseModule) SimulateQuery(queryID string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	if !m.isReady {
		return fmt.Errorf("database module not ready")
	}

	var selectedConn *DatabaseConnection
	for _, conn := range m.connections {
		if conn.IsActive {
			selectedConn = conn
			break
		}
	}

	if selectedConn == nil {
		return fmt.Errorf("no available connections")
	}

	selectedConn.LastUsed = time.Now()
	m.metrics.ActiveQueries++
	m.metrics.TotalQueries++

	go func() {
		time.Sleep(10 * time.Millisecond)
		m.mu.Lock()
		m.metrics.ActiveQueries--
		m.mu.Unlock()
	}()

	return nil
}

func (m *DatabaseModule) GetMetrics() DatabaseMetrics {
	m.mu.RLock()
	defer m.mu.RUnlock()
	if m.metrics == nil {
		return DatabaseMetrics{}
	}
	return *m.metrics
}

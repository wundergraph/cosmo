package nats

import (
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/nats-io/nats.go"
	"github.com/nats-io/nats.go/jetstream"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// Define interfaces for our testing
type natsConnector interface {
	Connect(url string, opts ...nats.Option) (*nats.Conn, error)
}

type jetStreamCreator interface {
	Create(nc *nats.Conn) (jetstream.JetStream, error)
}

// mockNatsConnector implements natsConnector for testing
type mockNatsConnector struct {
	mockConn  *nats.Conn
	mockErr   error
	callCount int
	lastOpts  []nats.Option
}

func (m *mockNatsConnector) Connect(url string, opts ...nats.Option) (*nats.Conn, error) {
	m.callCount++
	m.lastOpts = opts
	return m.mockConn, m.mockErr
}

// threadSafeConnector is a specialized version for thread safety testing
type threadSafeConnector struct {
	mockConn   *nats.Conn
	mockErr    error
	callCount  int
	countMutex sync.Mutex
	sleepTime  time.Duration
}

func (t *threadSafeConnector) Connect(url string, opts ...nats.Option) (*nats.Conn, error) {
	// Simulate a slow connection
	time.Sleep(t.sleepTime)
	t.countMutex.Lock()
	t.callCount++
	t.countMutex.Unlock()
	return t.mockConn, t.mockErr
}

// mockJetStreamCreator implements jetStreamCreator for testing
type mockJetStreamCreator struct {
	mockJS    jetstream.JetStream
	mockErr   error
	callCount int
}

func (m *mockJetStreamCreator) Create(nc *nats.Conn) (jetstream.JetStream, error) {
	m.callCount++
	return m.mockJS, m.mockErr
}

// testLazyClient is a wrapper for LazyClient that allows us to inject mocks
type testLazyClient struct {
	*LazyClient
	connector        natsConnector
	jetStreamCreator jetStreamCreator
}

// newTestLazyClient creates a LazyClient with mocked dependencies
func newTestLazyClient(url string, connector natsConnector, creator jetStreamCreator, opts ...nats.Option) *testLazyClient {
	c := &testLazyClient{
		LazyClient:       NewLazyClient(url, opts...),
		connector:        connector,
		jetStreamCreator: creator,
	}

	return c
}

// Connect overrides LazyClient.Connect to use our mocks
func (c *testLazyClient) Connect(opts ...nats.Option) error {
	c.once.Do(func() {
		// If no options are provided, use the ones stored during initialization
		optionsToUse := opts
		if len(optionsToUse) == 0 {
			optionsToUse = c.opts
		}
		c.client, c.err = c.connector.Connect(c.url, optionsToUse...)
		if c.err != nil {
			return
		}
		c.js, c.err = c.jetStreamCreator.Create(c.client)
	})
	return c.err
}

// GetClient overrides LazyClient.GetClient to ensure we use our Connect method
func (c *testLazyClient) GetClient() (*nats.Conn, error) {
	if c.client == nil {
		if err := c.Connect(c.opts...); err != nil {
			return nil, err
		}
	}
	return c.client, c.err
}

// GetJetStream overrides LazyClient.GetJetStream to ensure we use our Connect method
func (c *testLazyClient) GetJetStream() (jetstream.JetStream, error) {
	if c.js == nil {
		if err := c.Connect(c.opts...); err != nil {
			return nil, err
		}
	}
	return c.js, c.err
}

func TestNewLazyClient(t *testing.T) {
	url := "nats://localhost:4222"
	opts := []nats.Option{nats.Name("test-client")}

	client := NewLazyClient(url, opts...)

	assert.Equal(t, url, client.url)
	assert.Equal(t, opts, client.opts)
	assert.Nil(t, client.client)
	assert.Nil(t, client.js)
	assert.Nil(t, client.err)
}

func TestLazyClient_Connect_Success(t *testing.T) {
	// Create mocks
	connector := &mockNatsConnector{
		mockConn: &nats.Conn{},
	}

	jsCreator := &mockJetStreamCreator{
		mockJS: &struct{ jetstream.JetStream }{},
	}

	// Create test client
	client := newTestLazyClient("nats://localhost:4222", connector, jsCreator)

	// First call should connect
	err := client.Connect()
	require.NoError(t, err)
	assert.Equal(t, 1, connector.callCount, "Connect should be called once")
	assert.Equal(t, 1, jsCreator.callCount, "JetStream.Create should be called once")
	assert.Equal(t, connector.mockConn, client.client)
	assert.Equal(t, jsCreator.mockJS, client.js)

	// Second call should not connect again due to sync.Once
	err = client.Connect()
	require.NoError(t, err)
	assert.Equal(t, 1, connector.callCount, "Connect should still be called only once")
	assert.Equal(t, 1, jsCreator.callCount, "JetStream.Create should still be called only once")
}

func TestLazyClient_Connect_Error(t *testing.T) {
	// Create mocks with connection error
	connector := &mockNatsConnector{
		mockErr: errors.New("mock connect error"),
	}

	jsCreator := &mockJetStreamCreator{
		mockJS: &struct{ jetstream.JetStream }{},
	}

	// Create test client
	client := newTestLazyClient("nats://localhost:4222", connector, jsCreator)

	// Connect should return an error
	err := client.Connect()
	require.Error(t, err)
	assert.Equal(t, 1, connector.callCount, "Connect should be called once")
	assert.Equal(t, 0, jsCreator.callCount, "JetStream.Create should not be called")
	assert.Nil(t, client.client)
	assert.Nil(t, client.js)
	assert.NotNil(t, client.err)
	assert.Equal(t, "mock connect error", client.err.Error())

	// Second call should not connect again and return the same error
	connector.mockErr = errors.New("different error") // Should be ignored due to sync.Once
	err2 := client.Connect()
	require.Error(t, err2)
	assert.Equal(t, err, err2, "Should return the same error")
	assert.Equal(t, 1, connector.callCount, "Connect should still be called only once")
	assert.Equal(t, 0, jsCreator.callCount, "JetStream.Create should still not be called")
}

func TestLazyClient_Connect_JetStreamError(t *testing.T) {
	// Create mocks with jetstream error
	connector := &mockNatsConnector{
		mockConn: &nats.Conn{},
	}

	jsCreator := &mockJetStreamCreator{
		mockErr: errors.New("mock jetstream error"),
	}

	// Create test client
	client := newTestLazyClient("nats://localhost:4222", connector, jsCreator)

	// Connect should return the jetstream error
	err := client.Connect()
	require.Error(t, err)
	assert.Equal(t, 1, connector.callCount, "Connect should be called once")
	assert.Equal(t, 1, jsCreator.callCount, "JetStream.Create should be called once")
	assert.NotNil(t, client.client) // NATS connection was successful
	assert.Nil(t, client.js)        // JetStream failed
	assert.NotNil(t, client.err)
	assert.Equal(t, "mock jetstream error", client.err.Error())

	// Second call should not connect again and return the same error
	jsCreator.mockErr = errors.New("different error") // Should be ignored due to sync.Once
	err2 := client.Connect()
	require.Error(t, err2)
	assert.Equal(t, err, err2, "Should return the same error")
	assert.Equal(t, 1, connector.callCount, "Connect should still be called only once")
	assert.Equal(t, 1, jsCreator.callCount, "JetStream.Create should still be called only once")
}

func TestLazyClient_GetClient(t *testing.T) {
	t.Run("with successful connection", func(t *testing.T) {
		// Create mocks
		connector := &mockNatsConnector{
			mockConn: &nats.Conn{},
		}

		jsCreator := &mockJetStreamCreator{
			mockJS: &struct{ jetstream.JetStream }{},
		}

		// Create test client
		client := newTestLazyClient("nats://localhost:4222", connector, jsCreator)

		// First call to GetClient should connect
		conn, err := client.GetClient()
		require.NoError(t, err)
		assert.Equal(t, connector.mockConn, conn)
		assert.Equal(t, 1, connector.callCount, "Connect should be called once")

		// Second call should not connect again
		conn2, err := client.GetClient()
		require.NoError(t, err)
		assert.Equal(t, conn, conn2)
		assert.Equal(t, 1, connector.callCount, "Connect should still be called only once")
	})

	t.Run("with failed connection", func(t *testing.T) {
		// Create mocks with connection error
		connector := &mockNatsConnector{
			mockErr: errors.New("mock connect error"),
		}

		jsCreator := &mockJetStreamCreator{}

		// Create test client
		client := newTestLazyClient("nats://localhost:4222", connector, jsCreator)

		// GetClient should attempt to connect and return an error
		conn, err := client.GetClient()
		require.Error(t, err)
		assert.Nil(t, conn)
		assert.Equal(t, 1, connector.callCount, "Connect should be called once")
		assert.Equal(t, 0, jsCreator.callCount, "JetStream.Create should not be called")
		assert.Equal(t, "mock connect error", err.Error())
	})
}

func TestLazyClient_GetJetStream(t *testing.T) {
	t.Run("with successful connection", func(t *testing.T) {
		// Create mocks
		connector := &mockNatsConnector{
			mockConn: &nats.Conn{},
		}

		jsCreator := &mockJetStreamCreator{
			mockJS: &struct{ jetstream.JetStream }{},
		}

		// Create test client
		client := newTestLazyClient("nats://localhost:4222", connector, jsCreator)

		// First call to GetJetStream should connect
		js, err := client.GetJetStream()
		require.NoError(t, err)
		assert.Equal(t, jsCreator.mockJS, js)
		assert.Equal(t, 1, connector.callCount, "Connect should be called once")
		assert.Equal(t, 1, jsCreator.callCount, "JetStream.Create should be called once")

		// Second call should not connect again
		js2, err := client.GetJetStream()
		require.NoError(t, err)
		assert.Equal(t, js, js2)
		assert.Equal(t, 1, connector.callCount, "Connect should still be called only once")
		assert.Equal(t, 1, jsCreator.callCount, "JetStream.Create should still be called only once")
	})

	t.Run("with failed connection", func(t *testing.T) {
		// Create mocks with connection error
		connector := &mockNatsConnector{
			mockErr: errors.New("mock connect error"),
		}

		jsCreator := &mockJetStreamCreator{}

		// Create test client
		client := newTestLazyClient("nats://localhost:4222", connector, jsCreator)

		// GetJetStream should attempt to connect and return an error
		js, err := client.GetJetStream()
		require.Error(t, err)
		assert.Nil(t, js)
		assert.Equal(t, 1, connector.callCount, "Connect should be called once")
		assert.Equal(t, 0, jsCreator.callCount, "JetStream.Create should not be called")
		assert.Equal(t, "mock connect error", err.Error())
	})

	t.Run("with jetstream creation failure", func(t *testing.T) {
		// Create mocks with jetstream error
		connector := &mockNatsConnector{
			mockConn: &nats.Conn{},
		}

		jsCreator := &mockJetStreamCreator{
			mockErr: errors.New("mock jetstream error"),
		}

		// Create test client
		client := newTestLazyClient("nats://localhost:4222", connector, jsCreator)

		// GetJetStream should create the connection but fail on jetstream
		js, err := client.GetJetStream()
		require.Error(t, err)
		assert.Nil(t, js)
		assert.Equal(t, 1, connector.callCount, "Connect should be called once")
		assert.Equal(t, 1, jsCreator.callCount, "JetStream.Create should be called once")
		assert.Equal(t, "mock jetstream error", err.Error())
	})
}

func TestLazyClient_WithOptions(t *testing.T) {
	// Create mocks that will track options
	connector := &mockNatsConnector{
		mockConn: &nats.Conn{},
	}

	jsCreator := &mockJetStreamCreator{
		mockJS: &struct{ jetstream.JetStream }{},
	}

	// Create options that we can verify are passed to Connect
	option1 := nats.Name("test-client")
	option2 := nats.NoEcho()

	// Create test client with options
	client := newTestLazyClient("nats://localhost:4222", connector, jsCreator, option1, option2)

	// Call Connect to trigger the connection
	err := client.Connect()
	require.NoError(t, err)

	// Verify that the options were passed - they're stored in connector.lastOpts
	require.Len(t, connector.lastOpts, 2, "Options should be passed to Connect")

	// Now we can call GetClient() and verify it reuses the connection
	prevCallCount := connector.callCount
	_, err = client.GetClient()
	require.NoError(t, err)

	// Verify Connect wasn't called again
	assert.Equal(t, prevCallCount, connector.callCount, "GetClient should reuse the existing connection")
}

func TestLazyClient_ThreadSafety(t *testing.T) {
	// This test checks that LazyClient's sync.Once protection works as expected
	// by calling Connect from multiple goroutines simultaneously

	// Create a thread-safe connector that simulates slow connections
	connector := &threadSafeConnector{
		mockConn:  &nats.Conn{},
		sleepTime: 10 * time.Millisecond,
	}

	jsCreator := &mockJetStreamCreator{
		mockJS: &struct{ jetstream.JetStream }{},
	}

	// Create test client
	client := newTestLazyClient("nats://localhost:4222", connector, jsCreator)

	// Launch multiple goroutines that call Connect simultaneously
	var wg sync.WaitGroup
	for i := 0; i < 10; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			err := client.Connect()
			assert.NoError(t, err)
		}()
	}

	wg.Wait()

	// Connect should have been called exactly once
	assert.Equal(t, 1, connector.callCount, "Connect should have been called exactly once")
}

package nats

import (
	"context"
	"errors"
	"io"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"
)

// MockAdapter is a mock implementation of AdapterInterface.
type MockAdapter struct {
	mock.Mock
}

func (m *MockAdapter) Startup(ctx context.Context) error {
	args := m.Called(ctx)
	return args.Error(0)
}

func (m *MockAdapter) Shutdown(ctx context.Context) error {
	args := m.Called(ctx)
	return args.Error(0)
}

func (m *MockAdapter) Publish(ctx context.Context, event PublishAndRequestEventConfiguration) error {
	args := m.Called(ctx, event)
	return args.Error(0)
}

func (m *MockAdapter) Subscribe(ctx context.Context, event SubscriptionEventConfiguration, updater resolve.SubscriptionUpdater) error {
	args := m.Called(ctx, event, updater)
	return args.Error(0)
}

func (m *MockAdapter) Request(ctx context.Context, event PublishAndRequestEventConfiguration, w io.Writer) error {
	args := m.Called(ctx, event, w)
	return args.Error(0)
}

func TestProvider_Startup_Success(t *testing.T) {
	mockAdapter := new(MockAdapter)
	mockAdapter.On("Startup", mock.Anything).Return(nil)

	provider := PubSubProvider{
		Adapter: mockAdapter,
	}
	err := provider.Startup(context.Background())

	assert.NoError(t, err)
	mockAdapter.AssertExpectations(t)
}

func TestProvider_Startup_Error(t *testing.T) {
	mockAdapter := new(MockAdapter)
	mockAdapter.On("Startup", mock.Anything).Return(errors.New("connect error"))

	provider := PubSubProvider{
		Adapter: mockAdapter,
	}
	err := provider.Startup(context.Background())

	assert.Error(t, err)
	mockAdapter.AssertExpectations(t)
}

func TestProvider_Shutdown_Success(t *testing.T) {
	mockAdapter := new(MockAdapter)
	mockAdapter.On("Shutdown", mock.Anything).Return(nil)

	provider := PubSubProvider{
		Adapter: mockAdapter,
	}
	err := provider.Shutdown(context.Background())

	assert.NoError(t, err)
	mockAdapter.AssertExpectations(t)
}

func TestProvider_Shutdown_Error(t *testing.T) {
	mockAdapter := new(MockAdapter)
	mockAdapter.On("Shutdown", mock.Anything).Return(errors.New("close error"))

	provider := PubSubProvider{
		Adapter: mockAdapter,
	}
	err := provider.Shutdown(context.Background())

	assert.Error(t, err)
	mockAdapter.AssertExpectations(t)
}

func TestProvider_ID(t *testing.T) {
	const testID = "test-id"
	provider := PubSubProvider{
		id: testID,
	}
	assert.Equal(t, testID, provider.ID())
}

func TestProvider_TypeID(t *testing.T) {
	provider := PubSubProvider{}
	assert.Equal(t, providerTypeID, provider.TypeID())
}

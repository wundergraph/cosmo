package datasource

import (
	"context"
	"errors"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
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

func TestProvider_Startup_Success(t *testing.T) {
	mockAdapter := new(MockAdapter)
	mockAdapter.On("Startup", mock.Anything).Return(nil)

	provider := PubSubProviderImpl{
		Adapter: mockAdapter,
	}
	err := provider.Startup(context.Background())

	assert.NoError(t, err)
	mockAdapter.AssertExpectations(t)
}

func TestProvider_Startup_Error(t *testing.T) {
	mockAdapter := new(MockAdapter)
	mockAdapter.On("Startup", mock.Anything).Return(errors.New("connect error"))

	provider := PubSubProviderImpl{
		Adapter: mockAdapter,
	}
	err := provider.Startup(context.Background())

	assert.Error(t, err)
	mockAdapter.AssertExpectations(t)
}

func TestProvider_Shutdown_Success(t *testing.T) {
	mockAdapter := new(MockAdapter)
	mockAdapter.On("Shutdown", mock.Anything).Return(nil)

	provider := PubSubProviderImpl{
		Adapter: mockAdapter,
	}
	err := provider.Shutdown(context.Background())

	assert.NoError(t, err)
	mockAdapter.AssertExpectations(t)
}

func TestProvider_Shutdown_Error(t *testing.T) {
	mockAdapter := new(MockAdapter)
	mockAdapter.On("Shutdown", mock.Anything).Return(errors.New("close error"))

	provider := PubSubProviderImpl{
		Adapter: mockAdapter,
	}
	err := provider.Shutdown(context.Background())

	assert.Error(t, err)
	mockAdapter.AssertExpectations(t)
}

func TestProvider_ID(t *testing.T) {
	const testID = "test-id"
	provider := PubSubProviderImpl{
		id: testID,
	}
	assert.Equal(t, testID, provider.ID())
}

func TestProvider_TypeID(t *testing.T) {
	const providerTypeID = "test-type-id"
	provider := PubSubProviderImpl{
		typeID: providerTypeID,
	}
	assert.Equal(t, providerTypeID, provider.TypeID())
}

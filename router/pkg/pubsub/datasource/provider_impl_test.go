package datasource

import (
	"context"
	"errors"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
)

func TestProvider_Startup_Success(t *testing.T) {
	mockAdapter := NewMockLifecycle(t)
	mockAdapter.On("Startup", mock.Anything).Return(nil)

	provider := PubSubProviderImpl{
		Adapter: mockAdapter,
	}
	err := provider.Startup(context.Background())

	assert.NoError(t, err)
}

func TestProvider_Startup_Error(t *testing.T) {
	mockAdapter := NewMockLifecycle(t)
	mockAdapter.On("Startup", mock.Anything).Return(errors.New("connect error"))

	provider := PubSubProviderImpl{
		Adapter: mockAdapter,
	}
	err := provider.Startup(context.Background())

	assert.Error(t, err)
}

func TestProvider_Shutdown_Success(t *testing.T) {
	mockAdapter := NewMockLifecycle(t)
	mockAdapter.On("Shutdown", mock.Anything).Return(nil)

	provider := PubSubProviderImpl{
		Adapter: mockAdapter,
	}
	err := provider.Shutdown(context.Background())

	assert.NoError(t, err)
}

func TestProvider_Shutdown_Error(t *testing.T) {
	mockAdapter := NewMockLifecycle(t)
	mockAdapter.On("Shutdown", mock.Anything).Return(errors.New("close error"))

	provider := PubSubProviderImpl{
		Adapter: mockAdapter,
	}
	err := provider.Shutdown(context.Background())

	assert.Error(t, err)
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

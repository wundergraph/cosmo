package connectrpc

import (
	"net/http"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"
)

// TestConstructorValidation consolidates all constructor validation tests
// from handler_test.go, server_test.go, and vanguard_service_test.go
func TestConstructorValidation(t *testing.T) {
	t.Parallel()

	logger := zap.NewNop()
	httpClient := &http.Client{}

	tests := []struct {
		name        string
		constructor func() (interface{}, error)
		wantErr     string
	}{
		// RPCHandler validation
		{
			name: "RPCHandler: empty graphql endpoint",
			constructor: func() (interface{}, error) {
				return NewRPCHandler(HandlerConfig{
					HTTPClient:        httpClient,
					Logger:            logger,
					OperationRegistry: NewOperationRegistry(logger),
					ProtoLoader:       NewProtoLoader(logger),
				})
			},
			wantErr: "graphql endpoint cannot be empty",
		},
		{
			name: "RPCHandler: nil http client",
			constructor: func() (interface{}, error) {
				return NewRPCHandler(HandlerConfig{
					GraphQLEndpoint:   "http://localhost:4000/graphql",
					Logger:            logger,
					OperationRegistry: NewOperationRegistry(logger),
					ProtoLoader:       NewProtoLoader(logger),
				})
			},
			wantErr: "http client cannot be nil",
		},
		{
			name: "RPCHandler: missing operation registry",
			constructor: func() (interface{}, error) {
				return NewRPCHandler(HandlerConfig{
					GraphQLEndpoint: "http://localhost:4000/graphql",
					HTTPClient:      httpClient,
					Logger:          logger,
					ProtoLoader:     NewProtoLoader(logger),
				})
			},
			wantErr: "operation registry is required",
		},
		{
			name: "RPCHandler: missing proto loader",
			constructor: func() (interface{}, error) {
				return NewRPCHandler(HandlerConfig{
					GraphQLEndpoint:   "http://localhost:4000/graphql",
					HTTPClient:        httpClient,
					Logger:            logger,
					OperationRegistry: NewOperationRegistry(logger),
				})
			},
			wantErr: "proto loader is required",
		},

		// Server validation
		{
			name: "Server: empty services directory",
			constructor: func() (interface{}, error) {
				return NewServer(ServerConfig{
					GraphQLEndpoint: "http://localhost:4000/graphql",
				})
			},
			wantErr: "services directory must be provided",
		},
		{
			name: "Server: empty graphql endpoint",
			constructor: func() (interface{}, error) {
				return NewServer(ServerConfig{
					ServicesDir: "samples/services",
				})
			},
			wantErr: "graphql endpoint cannot be empty",
		},

		// VanguardService validation
		{
			name: "VanguardService: nil handler",
			constructor: func() (interface{}, error) {
				protoLoader := NewProtoLoader(logger)
				err := protoLoader.LoadFromDirectory("samples/services/employee.v1")
				if err != nil {
					return nil, err
				}
				return NewVanguardService(VanguardServiceConfig{
					Handler:     nil,
					ProtoLoader: protoLoader,
					Logger:      logger,
				})
			},
			wantErr: "handler cannot be nil",
		},
		{
			name: "VanguardService: nil proto loader",
			constructor: func() (interface{}, error) {
				return NewVanguardService(VanguardServiceConfig{
					Handler:     &RPCHandler{},
					ProtoLoader: nil,
					Logger:      logger,
				})
			},
			wantErr: "proto loader cannot be nil",
		},
		{
			name: "VanguardService: no proto services",
			constructor: func() (interface{}, error) {
				protoLoader := NewProtoLoader(logger)
				return NewVanguardService(VanguardServiceConfig{
					Handler:     &RPCHandler{},
					ProtoLoader: protoLoader,
					Logger:      logger,
				})
			},
			wantErr: "no proto services found",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result, err := tt.constructor()
			assert.Error(t, err)
			assert.Nil(t, result)
			assert.Contains(t, err.Error(), tt.wantErr)
		})
	}
}

// TestConstructorDefaults tests that constructors apply sensible defaults
func TestConstructorDefaults(t *testing.T) {
	t.Parallel()

	t.Run("RPCHandler: adds protocol to endpoint", func(t *testing.T) {
		handler, err := NewRPCHandler(HandlerConfig{
			GraphQLEndpoint:   "localhost:4000/graphql",
			HTTPClient:        &http.Client{},
			OperationRegistry: NewOperationRegistry(zap.NewNop()),
			ProtoLoader:       NewProtoLoader(zap.NewNop()),
		})

		require.NoError(t, err)
		assert.Equal(t, "http://localhost:4000/graphql", handler.graphqlEndpoint)
	})

	t.Run("Server: adds protocol to endpoint", func(t *testing.T) {
		server, err := NewServer(ServerConfig{
			ServicesDir:     "samples/services",
			GraphQLEndpoint: "localhost:4000/graphql",
		})

		require.NoError(t, err)
		assert.Equal(t, "http://localhost:4000/graphql", server.config.GraphQLEndpoint)
	})

	t.Run("Server: uses default listen address", func(t *testing.T) {
		server, err := NewServer(ServerConfig{
			ServicesDir:     "samples/services",
			GraphQLEndpoint: "http://localhost:4000/graphql",
		})

		require.NoError(t, err)
		assert.Equal(t, "0.0.0.0:5026", server.config.ListenAddr)
	})
}
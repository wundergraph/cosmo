package trace

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"

	"go.uber.org/zap"
)

func TestStartAgent(t *testing.T) {

	const (
		endpoint = "localhost:1234"
	)
	c1 := &Config{
		Name: "foo",
	}
	c2 := &Config{
		Name: "bla",
		Exporters: []*Exporter{{
			Endpoint: endpoint,
		}},
	}
	c3 := &Config{
		Name:    "otlphttp",
		Version: "1.0.0",
		Exporters: []*Exporter{{
			Endpoint: endpoint,
			Headers: map[string]string{
				"Authorization": "Bearer token",
			},
			HTTPPath: "/v1/traces",
		}},
	}

	log := zap.NewNop()

	instanceID := "instanceID"

	_, err := NewTracerProvider(context.Background(), log, c1, instanceID)
	assert.NoError(t, err)

	_, err = NewTracerProvider(context.Background(), log, c2, instanceID)
	assert.NoError(t, err)

	_, err = NewTracerProvider(context.Background(), log, c3, instanceID)
	assert.NoError(t, err)
}

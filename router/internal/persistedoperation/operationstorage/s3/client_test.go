package s3

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router/internal/persistedoperation"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
)

func TestPersistedOperationNotFound(t *testing.T) {
	t.Parallel()

	var requestedPath string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requestedPath = r.URL.Path
		// Mimic the S3 API response for a missing object
		w.Header().Set("Content-Type", "application/xml")
		w.WriteHeader(http.StatusNotFound)
		_, _ = w.Write([]byte(`<?xml version="1.0" encoding="UTF-8"?>
<Error><Code>NoSuchKey</Code><Message>The specified key does not exist.</Message><Key>` + strings.TrimPrefix(r.URL.Path, "/") + `</Key></Error>`))
	}))
	t.Cleanup(server.Close)

	client, err := NewClient(strings.TrimPrefix(server.URL, "http://"), &Options{
		AccessKeyID:      "access-key",
		SecretAccessKey:  "secret-key",
		Region:           "us-east-1",
		BucketName:       "operations",
		ObjectPathPrefix: "prefix",
		TraceProvider:    sdktrace.NewTracerProvider(),
	})
	require.NoError(t, err)

	content, err := client.PersistedOperation(t.Context(), "my-client", "does-not-exist")
	assert.Nil(t, content)
	assert.Equal(t, "/operations/prefix/does-not-exist.json", requestedPath)

	var notFound *persistedoperation.PersistentOperationNotFoundError
	require.True(t, errors.As(err, &notFound), "expected PersistentOperationNotFoundError, got %T: %v", err, err)
	assert.Equal(t, "my-client", notFound.ClientName)
	assert.Equal(t, "does-not-exist", notFound.Sha256Hash)
}

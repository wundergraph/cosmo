package exporter

import (
	"time"
)

type RetryOptions struct {
	Enabled     bool
	MaxDuration time.Duration
	Interval    time.Duration
	MaxRetry    int
}

const (
	defaultExportTimeout          = time.Duration(10) * time.Second
	defaultExportRetryMaxDuration = time.Duration(10) * time.Second
	defaultExportRetryInterval    = time.Duration(5) * time.Second
	defaultExportMaxRetryAttempts = 5
	defaultMaxBatchItems          = 1024
	defaultMaxQueueSize           = 1024 * 10
	defaultBatchInterval          = time.Duration(10) * time.Second
)

type Settings struct {
	// BatchSize is the maximum number of items to be sent in a single batch.
	BatchSize int
	// QueueSize is the maximum number of batches allowed in queue at a given time.
	QueueSize int
	// Interval is the interval at which the queue is flushed.
	Interval time.Duration
	// Retry is the retry options for the exporter.
	RetryOptions RetryOptions
	// ExportTimeout is the timeout for the export request.
	ExportTimeout time.Duration
}

func NewDefaultSettings() *Settings {
	return &Settings{
		BatchSize:     defaultMaxBatchItems,
		QueueSize:     defaultMaxQueueSize,
		Interval:      defaultBatchInterval,
		ExportTimeout: defaultExportTimeout,
		RetryOptions: RetryOptions{
			Enabled:     true,
			MaxRetry:    defaultExportMaxRetryAttempts,
			MaxDuration: defaultExportRetryMaxDuration,
			Interval:    defaultExportRetryInterval,
		},
	}
}

func NewSettings(batchSize, queueSize int, batchInterval, exportTimeout time.Duration, retryEnabled bool, retryMaxAttempts int, retryMaxDuration, retryMaxInterval time.Duration) *Settings {
	settings := NewDefaultSettings()
	if batchSize > 0 {
		settings.BatchSize = batchSize
	}
	if queueSize > 0 {
		settings.QueueSize = queueSize
	}
	if batchInterval > 0 {
		settings.Interval = batchInterval
	}
	if exportTimeout > 0 {
		settings.ExportTimeout = exportTimeout
	}
	settings.RetryOptions.Enabled = retryEnabled
	if retryMaxAttempts > 0 {
		settings.RetryOptions.MaxRetry = retryMaxAttempts
	}
	if retryMaxDuration > 0 {
		settings.RetryOptions.MaxDuration = retryMaxDuration
	}
	if retryMaxInterval > 0 {
		settings.RetryOptions.Interval = retryMaxInterval
	}
	return settings
}

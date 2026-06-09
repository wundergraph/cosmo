package sandbox

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/hashicorp/go-retryablehttp"
	"github.com/wundergraph/cosmo/router/internal/codemode/storage"
	"go.uber.org/zap"
)

const (
	defaultRequestTimeout            = 5 * time.Second
	defaultMemoryLimitBytes          = 16 << 20
	defaultMaxInputSizeBytes         = 64 << 10
	defaultMaxOutputSizeBytes        = 1 << 20
	defaultMaxResultBytes            = 32 << 10
	defaultMaxToolInvocationsPerCall = 256
	defaultMaxResponseBodyBytes      = 10 << 20
	defaultRetryAttempts             = 3
	defaultRetryCeiling              = 60 * time.Second
	defaultMaxConcurrent             = 4
)

type Sandbox struct {
	cfg       Config
	sem       chan struct{}
	http      *http.Client
	allowList map[string]struct{}
}

type Config struct {
	RouterGraphQLEndpoint     string
	RequestTimeout            time.Duration
	MemoryLimitBytes          int
	MaxInputSizeBytes         int
	MaxOutputSizeBytes        int
	MaxResultBytes            int
	MaxToolInvocationsPerCall int
	MaxResponseBodyBytes      int
	RetryAttempts             int
	RetryCeiling              time.Duration
	MaxConcurrent             int
	HeaderAllowList           []string
	StorageLookup             func(ctx context.Context, sessionID string, name string) (storage.SessionOp, bool, error)
	Logger                    *zap.Logger
	Now                       func() time.Time
	HTTPClient                *http.Client
}

type ExecuteRequest struct {
	SessionID      string
	ToolNames      []string
	WrappedJS      string
	SourceMap      []byte
	RequestHeaders http.Header
	ApprovalGate   ApprovalGate
}

type ExecuteResult struct {
	OK         bool
	Result     json.RawMessage
	Error      *ErrorEnvelope
	Warnings   []SerializationWarning
	Truncated  bool
	OutputSize int
	HostCalls  int
}

type ErrorEnvelope struct {
	Name    string         `json:"name"`
	Message string         `json:"message"`
	Stack   string         `json:"stack"`
	Cause   *ErrorEnvelope `json:"cause,omitempty"`
}

// SerializationWarning records a non-serializable value found in the script's
// return value. The bad value is replaced in the response with the sentinel
// string "<<non-serializable: KIND>>" where KIND matches the reported Kind.
type SerializationWarning struct {
	Path string `json:"path"`
	Kind string `json:"kind"`
}

type ApprovalGate interface {
	Decide(ctx context.Context, req ApprovalRequest) (ApprovalDecision, error)
}

type ApprovalRequest struct {
	Name   string
	Source string
	Vars   json.RawMessage
}

type ApprovalDecision struct {
	Approved bool
	Reason   string
}

type approveAllGate struct{}

var AutoApprove ApprovalGate = approveAllGate{}

func (approveAllGate) Decide(context.Context, ApprovalRequest) (ApprovalDecision, error) {
	return ApprovalDecision{Approved: true}, nil
}

func New(cfg Config) (*Sandbox, error) {
	cfg = withDefaults(cfg)
	if cfg.MaxConcurrent <= 0 {
		return nil, errors.New("sandbox max concurrent must be positive")
	}
	if cfg.StorageLookup == nil {
		cfg.StorageLookup = func(context.Context, string, string) (storage.SessionOp, bool, error) {
			return storage.SessionOp{}, false, nil
		}
	}
	if cfg.Logger == nil {
		cfg.Logger = zap.NewNop()
	}
	if cfg.Now == nil {
		cfg.Now = time.Now
	}

	client := cfg.HTTPClient
	if client == nil {
		retryClient := retryablehttp.NewClient()
		retryClient.RetryMax = cfg.RetryAttempts
		retryClient.RetryWaitMax = cfg.RetryCeiling
		retryClient.Logger = nil
		client = retryClient.StandardClient()
	}

	return &Sandbox{
		cfg:       cfg,
		sem:       make(chan struct{}, cfg.MaxConcurrent),
		http:      client,
		allowList: headerAllowList(cfg.HeaderAllowList),
	}, nil
}

func withDefaults(cfg Config) Config {
	if cfg.RequestTimeout <= 0 {
		cfg.RequestTimeout = defaultRequestTimeout
	}
	if cfg.MemoryLimitBytes <= 0 {
		cfg.MemoryLimitBytes = defaultMemoryLimitBytes
	}
	if cfg.MaxInputSizeBytes <= 0 {
		cfg.MaxInputSizeBytes = defaultMaxInputSizeBytes
	}
	if cfg.MaxOutputSizeBytes <= 0 {
		cfg.MaxOutputSizeBytes = defaultMaxOutputSizeBytes
	}
	if cfg.MaxResultBytes <= 0 {
		cfg.MaxResultBytes = defaultMaxResultBytes
	}
	if cfg.MaxToolInvocationsPerCall <= 0 {
		cfg.MaxToolInvocationsPerCall = defaultMaxToolInvocationsPerCall
	}
	if cfg.MaxResponseBodyBytes <= 0 {
		cfg.MaxResponseBodyBytes = defaultMaxResponseBodyBytes
	}
	if cfg.RetryAttempts <= 0 {
		cfg.RetryAttempts = defaultRetryAttempts
	}
	if cfg.RetryCeiling <= 0 {
		cfg.RetryCeiling = defaultRetryCeiling
	}
	if cfg.MaxConcurrent <= 0 {
		cfg.MaxConcurrent = defaultMaxConcurrent
	}
	return cfg
}

package httpclient

import (
	"net/http"
	"sync"
)

const defaultMaxConcurrentSupervisedRequests = 128

// CancellationObserver receives lifecycle events from supervised requests.
// Implementations must be concurrency safe and must not block.
type CancellationObserver interface {
	HardCancellation(req *http.Request)
	AbandonedRequests(req *http.Request, delta int64)
	LateCompletion(req *http.Request)
	LimitReached(req *http.Request)
}

type CancelableRoundTripperOptions struct {
	// ShouldSupervise limits the cancellation boundary to requests that need it.
	ShouldSupervise func(req *http.Request) bool
	// Key identifies the independent concurrency pool for a request.
	Key func(req *http.Request) string
	// Limit returns the maximum number of delegates that may run for the key.
	Limit func(req *http.Request) int
	// Observer records hard-cancellation lifecycle metrics.
	Observer CancellationObserver
	// Supervisor shares per-key capacity across multiple transport wrappers.
	Supervisor *CancellationSupervisor
}

type CancellationSupervisor struct {
	limiters sync.Map // map[string]*requestLimiter
}

func NewCancellationSupervisor() *CancellationSupervisor {
	return &CancellationSupervisor{}
}

// CancelableRoundTripper provides a hard cancellation boundary around selected
// delegate requests. The net/http contract requires RoundTrip implementations to
// return promptly when the request context is canceled, but custom transports and
// hooks do not always honor that contract. Running a selected delegate separately
// prevents one such operation from blocking its caller indefinitely.
//
// Each supervised delegate reserves a per-key slot until the delegate itself
// returns. A canceled delegate therefore cannot be replaced by an unbounded number
// of additional goroutines. If it returns late, its response body is closed.
type CancelableRoundTripper struct {
	delegate   http.RoundTripper
	options    CancelableRoundTripperOptions
	supervisor *CancellationSupervisor
}

type requestLimiter struct {
	slots chan struct{}
}

func NewCancelableRoundTripper(delegate http.RoundTripper, options CancelableRoundTripperOptions) *CancelableRoundTripper {
	supervisor := options.Supervisor
	if supervisor == nil {
		supervisor = NewCancellationSupervisor()
	}
	return &CancelableRoundTripper{delegate: delegate, options: options, supervisor: supervisor}
}

type roundTripResult struct {
	response *http.Response
	err      error
}

func (c *CancelableRoundTripper) RoundTrip(req *http.Request) (*http.Response, error) {
	if c.options.ShouldSupervise == nil || !c.options.ShouldSupervise(req) {
		return c.delegate.RoundTrip(req)
	}
	if err := req.Context().Err(); err != nil {
		return nil, err
	}

	limiter := c.limiter(req)
	select {
	case limiter.slots <- struct{}{}:
	case <-req.Context().Done():
		c.limitReached(req)
		return nil, req.Context().Err()
	}

	result := make(chan roundTripResult)
	callerCanceled := make(chan struct{})

	go func() {
		defer func() { <-limiter.slots }()

		resp, err := c.delegate.RoundTrip(req)
		select {
		case result <- roundTripResult{response: resp, err: err}:
		case <-req.Context().Done():
			// The caller records the abandonment before closing this channel.
			<-callerCanceled
			if resp != nil && resp.Body != nil {
				_ = resp.Body.Close()
			}
			c.lateCompletion(req)
			c.abandonedRequests(req, -1)
		}
	}()

	select {
	case result := <-result:
		return result.response, result.err
	case <-req.Context().Done():
		c.hardCancellation(req)
		c.abandonedRequests(req, 1)
		close(callerCanceled)
		return nil, req.Context().Err()
	}
}

func (c *CancelableRoundTripper) limiter(req *http.Request) *requestLimiter {
	key := ""
	if c.options.Key != nil {
		key = c.options.Key(req)
	}
	limit := defaultMaxConcurrentSupervisedRequests
	if c.options.Limit != nil {
		if configured := c.options.Limit(req); configured > 0 {
			limit = configured
		}
	}
	created := &requestLimiter{slots: make(chan struct{}, limit)}
	actual, _ := c.supervisor.limiters.LoadOrStore(key, created)
	return actual.(*requestLimiter)
}

func (c *CancelableRoundTripper) hardCancellation(req *http.Request) {
	if c.options.Observer != nil {
		c.options.Observer.HardCancellation(req)
	}
}

func (c *CancelableRoundTripper) abandonedRequests(req *http.Request, delta int64) {
	if c.options.Observer != nil {
		c.options.Observer.AbandonedRequests(req, delta)
	}
}

func (c *CancelableRoundTripper) lateCompletion(req *http.Request) {
	if c.options.Observer != nil {
		c.options.Observer.LateCompletion(req)
	}
}

func (c *CancelableRoundTripper) limitReached(req *http.Request) {
	if c.options.Observer != nil {
		c.options.Observer.LimitReached(req)
	}
}

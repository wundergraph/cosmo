package cdn

import "time"

// SetConfigFetchRetryWait shortens the retry backoff so tests don't sleep.
func SetConfigFetchRetryWait(f *SplitFetcher, d time.Duration) {
	f.configFetchRetryWait = d
}

package sandbox

import "context"

func (s *Sandbox) acquire(ctx context.Context) error {
	select {
	case s.sem <- struct{}{}:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

func (s *Sandbox) release() {
	<-s.sem
}

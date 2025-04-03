package timex

import (
	"math/rand"
	"time"
)

// randomDuration returns a random duration between 0 and maximum
//
// !! DOES NOT USE CRYPTO RANDOM !!
func RandomDuration(maximum time.Duration) time.Duration {
	if maximum < 0 {
		panic("negative duration")
	}

	// rand.Int63n will panic if its argument <= 0
	if maximum == 0 {
		return 0
	}

	return time.Duration(rand.Int63n(int64(maximum)))
}

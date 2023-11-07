// Package docker implements helper functions we use while running under Docker.
// This should only be used for development purposes.
package docker

import (
	"os"
)

const (
	// dockerInternalHost is the hostname used by docker to access the host machine
	// with bridge networking. We use it for automatic fallbacks when requests to localhost fail.
	dockerInternalHost = "host.docker.internal"
)

func Inside() bool {
	// Check if we are running inside docker by
	// testing by checking if /.dockerenv exists
	//
	// This is not documented by Docker themselves, but it's the only
	// method that has been working reliably for several years.
	st, err := os.Stat("/.dockerenv")
	return err == nil && !st.IsDir()
}

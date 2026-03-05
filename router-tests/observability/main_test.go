package integration

import (
	"os"
	"testing"
)

func TestMain(m *testing.M) {
	// Change to router-tests root so relative testdata paths resolve correctly
	os.Chdir("..")
	os.Exit(m.Run())
}

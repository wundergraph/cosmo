package grpccommon

import (
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
)

func PrepareCommand(cmd *exec.Cmd, startupConfig GRPCStartupParams) error {
	// This is the same as SkipHostEnv false, except
	// that we set the base env variables first so that any params
	// that may contain the same name are not overridden
	cmd.Env = append(cmd.Env, os.Environ()...)

	configJson, err := json.Marshal(startupConfig)
	if err != nil {
		return fmt.Errorf("failed to create plugin startup config: %w", err)
	}

	cmd.Env = append(cmd.Env, fmt.Sprintf("%s=%s", "startup_config", configJson))

	// Run build tagged extra command prep for OS-specific options
	PrepareCommandForOS(cmd)

	return nil
}

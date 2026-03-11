package grpcpluginoci

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"

	v1 "github.com/google/go-containerregistry/pkg/v1"
	"github.com/wundergraph/cosmo/router/pkg/grpcconnector/grpccommon"
	"go.uber.org/zap"
)

func (d *GRPCPlugin) PreparePlugin(img v1.Image) (*exec.Cmd, error) {
	// 1. Create temp dir
	workDir, err := os.MkdirTemp("", "plugin-direct-*")
	if err != nil {
		return nil, fmt.Errorf("failed to create temp dir: %w", err)
	}
	d.workDir = workDir

	defer func() {
		if err != nil {
			_ = os.RemoveAll(workDir)
		}
	}()

	// 2. Extract image to directory
	if err := os.MkdirAll(workDir, 0o755); err != nil {
		return nil, fmt.Errorf("failed to create untar dir: %w", err)
	}
	d.logger.Info("Extracting OCI image to directory", zap.String("directory", workDir))

	if err := UnpackImageToDir(img, workDir); err != nil {
		return nil, fmt.Errorf("failed to extract image to dir: %w", err)
	}

	config, err := img.ConfigFile()
	if err != nil {
		return nil, fmt.Errorf("failed to load image config")
	}

	// Build the command according to OCI spec
	var cmdArgs []string
	if len(config.Config.Entrypoint) > 0 {
		cmdArgs = append(cmdArgs, config.Config.Entrypoint...)
		if len(config.Config.Cmd) > 0 {
			cmdArgs = append(cmdArgs, config.Config.Cmd...)
		}
	} else if len(config.Config.Cmd) > 0 {
		cmdArgs = append(cmdArgs, config.Config.Cmd...)
	} else {
		return nil, fmt.Errorf("no entrypoint or cmd specified in image config")
	}

	// The first argument is the executable, which should be in workDir
	execPath := filepath.Join(workDir, cmdArgs[0])
	if _, err := os.Stat(execPath); err != nil {
		return nil, fmt.Errorf("entrypoint binary not found: %w", err)
	}
	finalArgs := cmdArgs[1:]

	cmd := exec.Command(execPath, finalArgs...)
	cmd.Dir = workDir

	err = grpccommon.PrepareCommand(cmd, d.startupConfig)
	if err != nil {
		return nil, fmt.Errorf("failed to prepare plugin command: %w", err)
	}

	return cmd, nil
}

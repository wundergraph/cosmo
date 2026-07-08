package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/labstack/echo/v5"
	"github.com/lmittmann/tint"
)

func newLogger(format string) (*slog.Logger, error) {
	switch format {
	case "json":
		return slog.New(slog.NewJSONHandler(os.Stderr, nil)), nil
	case "text":
		return slog.New(tint.NewHandler(os.Stderr, nil)), nil
	default:
		return nil, fmt.Errorf("unknown log format %q (want text or json)", format)
	}
}

func main() {
	cfg, err := loadConfig()
	if err != nil {
		slog.Error("loading config", "err", err)
		os.Exit(1)
	}

	logger, err := newLogger(cfg.LogFormat)
	if err != nil {
		slog.Error("creating logger", "err", err)
		os.Exit(1)
	}

	slog.SetDefault(logger)

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	sc := echo.StartConfig{
		Address:         cfg.ListenAddr,
		HideBanner:      true,
		GracefulTimeout: 15 * time.Second,
		BeforeServeFunc: func(s *http.Server) error {
			s.ReadHeaderTimeout = 10 * time.Second
			return nil
		},
	}

	if err := sc.Start(ctx, newServer(cfg, logger)); err != nil && !errors.Is(err, http.ErrServerClosed) {
		logger.Error("server", "err", err)
		os.Exit(1)
	}
}

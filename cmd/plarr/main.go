package main

import (
	"context"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/victor141516/Plarr/internal/cache"
	"github.com/victor141516/Plarr/internal/config"
	"github.com/victor141516/Plarr/internal/media"
	"github.com/victor141516/Plarr/internal/probe"
	"github.com/victor141516/Plarr/internal/server"
	"github.com/victor141516/Plarr/internal/transcode"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		slog.Error("invalid configuration", "error", err)
		os.Exit(1)
	}
	log := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: cfg.LogLevel}))
	cacheManager := cache.New(cfg.CacheDir, cfg.CacheLimit)
	if err = cacheManager.ClearStartup(); err != nil {
		log.Error("cache startup cleanup failed", "error", err)
		os.Exit(1)
	}
	transcoder := transcode.New(cfg.FFmpegPath, cacheManager, cfg.Renditions, cfg.Hardware, cfg.PreviewCPUPercent, log)
	app := &server.Server{Config: cfg, Media: media.Resolver{Root: cfg.MediaRoot}, Probe: probe.Client{Path: cfg.FFprobePath}, Transcode: transcoder, Cache: cacheManager, Log: log}
	srv := &http.Server{Addr: cfg.ListenAddr, Handler: app.Handler(), ReadHeaderTimeout: 10 * time.Second, IdleTimeout: 90 * time.Second}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	go func() {
		log.Info("Plarr listening", "address", cfg.ListenAddr, "publicOrigin", cfg.PublicOrigin, "mediaRoot", cfg.MediaRoot)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Error("HTTP server failed", "error", err)
			stop()
		}
	}()
	<-ctx.Done()
	shutdown, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	_ = srv.Shutdown(shutdown)
}

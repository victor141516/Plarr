package config

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

type Rendition struct {
	Label        string `json:"label"`
	Height       int    `json:"height"`
	VideoBitrate int    `json:"videoBitrate"`
}
type Config struct {
	ListenAddr, MediaRoot, PublicOrigin, CacheDir, FFmpegPath, FFprobePath, FrontendDir string
	CacheLimit                                                                          int64
	Hardware                                                                            []string
	Renditions                                                                          []Rendition
	AllowedParentOrigins                                                                map[string]bool
	LogLevel                                                                            slog.Level
}

func Load() (Config, error) {
	cwd, _ := os.Getwd()
	c := Config{ListenAddr: env("PLARR_LISTEN_ADDR", ":8090"), MediaRoot: env("PLARR_MEDIA_ROOT", filepath.Join(cwd, "media")), PublicOrigin: strings.TrimRight(env("PLARR_PUBLIC_ORIGIN", "http://localhost:8090"), "/"), CacheDir: env("PLARR_CACHE_DIR", filepath.Join(cwd, "cache")), FFmpegPath: env("PLARR_FFMPEG_PATH", "ffmpeg"), FFprobePath: env("PLARR_FFPROBE_PATH", "ffprobe"), FrontendDir: env("PLARR_FRONTEND_DIR", filepath.Join(cwd, "web", "dist")), CacheLimit: bytes("PLARR_CACHE_LIMIT", 10<<30), Hardware: list("PLARR_HARDWARE_ACCELERATION", "auto"), AllowedParentOrigins: map[string]bool{}, LogLevel: level("PLARR_LOG_LEVEL", slog.LevelInfo), Renditions: []Rendition{{"2160p", 2160, 16_000_000}, {"1080p", 1080, 8_000_000}, {"720p", 720, 5_000_000}, {"480p", 480, 2_500_000}, {"360p", 360, 1_000_000}, {"240p", 240, 350_000}}}
	if raw := strings.TrimSpace(os.Getenv("PLARR_RENDITION_LADDER")); raw != "" {
		if err := json.Unmarshal([]byte(raw), &c.Renditions); err != nil {
			return c, errors.New("PLARR_RENDITION_LADDER must be valid JSON")
		}
	}
	u, err := url.Parse(c.PublicOrigin)
	if err != nil || u.Scheme == "" || u.Host == "" {
		return c, errors.New("PLARR_PUBLIC_ORIGIN must be an absolute URL")
	}
	for _, v := range list("PLARR_ALLOWED_PARENT_ORIGINS", "") {
		if v == "" {
			continue
		}
		p, e := url.Parse(strings.TrimRight(v, "/"))
		if e != nil || p.Scheme == "" || p.Host == "" {
			return c, errors.New("PLARR_ALLOWED_PARENT_ORIGINS contains an invalid origin")
		}
		c.AllowedParentOrigins[p.Scheme+"://"+p.Host] = true
	}
	for _, d := range []string{c.MediaRoot, c.CacheDir} {
		if err = os.MkdirAll(d, 0o750); err != nil {
			return c, err
		}
	}
	root, err := filepath.EvalSymlinks(c.MediaRoot)
	if err != nil {
		return c, err
	}
	c.MediaRoot = root
	return c, nil
}
func level(name string, fallback slog.Level) slog.Level {
	var parsed slog.Level
	if err := parsed.UnmarshalText([]byte(env(name, fallback.String()))); err != nil {
		return fallback
	}
	return parsed
}
func env(n, d string) string {
	if v := strings.TrimSpace(os.Getenv(n)); v != "" {
		return v
	}
	return d
}
func list(n, d string) []string {
	raw := env(n, d)
	parts := strings.Split(raw, ",")
	for i := range parts {
		parts[i] = strings.TrimSpace(parts[i])
	}
	return parts
}
func bytes(n string, d int64) int64 {
	v := strings.TrimSpace(os.Getenv(n))
	if v == "" {
		return d
	}
	mult := int64(1)
	if len(v) >= 2 {
		last := strings.ToUpper(v[len(v)-2:])
		if last == "GB" {
			mult = 1 << 30
			v = v[:len(v)-2]
		} else if last == "MB" {
			mult = 1 << 20
			v = v[:len(v)-2]
		}
	}
	num, err := strconv.ParseInt(strings.TrimSpace(v), 10, 64)
	if err != nil {
		return d
	}
	return num * mult
}

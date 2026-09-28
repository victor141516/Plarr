package transcode

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/victor141516/Plarr/internal/config"
)

const generatedSegmentPollInterval = 25 * time.Millisecond

// ErrHLSWindowExpired tells the client to reopen playback at its current
// absolute position. Appending a new FFmpeg process to an interrupted video
// playlist is unsafe: fragmented MP4 rewrites its init segment and can make
// the already-published fragments jump backwards on the media timeline.
var ErrHLSWindowExpired = errors.New("HLS generation window expired")

func hlsVideoCacheKey(m *Manager, path string, rendition config.Rendition, start float64, color ColorMode) string {
	return m.key(path, hlsVideoCacheVersion, rendition.Label, string(color), seekKey(start))
}

// expireInterruptedHLSWindow atomically retires a partial audio or video cache
// only when no FFmpeg process still owns it. Appending a new process can change
// the source-keyframe pre-roll or rewrite an fMP4 init segment, so every lane
// must reopen at the player's current absolute position instead.
func (m *Manager) expireInterruptedHLSWindow(key, target, segmentSuffix string) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.running[key] != nil {
		return false
	}
	state := inspectPlaylist(target, segmentSuffix)
	if state.segments == 0 || state.complete {
		return false
	}
	if err := os.RemoveAll(filepath.Dir(target)); err != nil {
		m.Log.Warn("interrupted HLS window could not be retired", "operation", "hls.resume", "cacheKey", key, "error", err)
		return false
	}
	return true
}

func (m *Manager) waitForGeneratedFile(ctx context.Context, key, target string) error {
	if _, err := os.Stat(target); err == nil {
		return nil
	}

	m.mu.Lock()
	active := m.running[key]
	m.mu.Unlock()
	if active == nil {
		return fmt.Errorf("generated segment is unavailable: %w", os.ErrNotExist)
	}

	ticker := time.NewTicker(generatedSegmentPollInterval)
	defer ticker.Stop()
	for {
		if _, err := os.Stat(target); err == nil {
			return nil
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-active.done:
			if _, err := os.Stat(target); err == nil {
				return nil
			}
			if active.err != nil {
				return active.err
			}
			return fmt.Errorf("generation completed without requested segment: %w", os.ErrNotExist)
		case <-ticker.C:
		}
	}
}

// repairPlaylistForResume removes a trailing playlist entry whose segment was
// never atomically published. FFmpeg may update an event playlist immediately
// before a canceled process finishes writing that segment. Leaving the entry
// in place makes append_list resume after the missing file, creating a
// permanent hole for an HLS client.
func repairPlaylistForResume(target, segmentSuffix string) playlistState {
	contents, err := os.ReadFile(target)
	if err != nil {
		return playlistState{}
	}
	lines := strings.Split(string(contents), "\n")
	lastPublishedLine := -1
	foundMissing := false
	for index, rawLine := range lines {
		line := strings.TrimSpace(rawLine)
		if strings.HasPrefix(line, "#") || !strings.HasSuffix(line, segmentSuffix) {
			continue
		}
		if _, err := os.Stat(filepath.Join(filepath.Dir(target), filepath.Base(line))); err != nil {
			foundMissing = true
			break
		}
		lastPublishedLine = index
	}
	if !foundMissing {
		return inspectPlaylist(target, segmentSuffix)
	}
	if lastPublishedLine < 0 {
		_ = os.Remove(target)
		return playlistState{}
	}
	repaired := strings.Join(lines[:lastPublishedLine+1], "\n") + "\n"
	if err := os.WriteFile(target, []byte(repaired), 0o640); err != nil {
		return inspectPlaylist(target, segmentSuffix)
	}
	return inspectPlaylist(target, segmentSuffix)
}

// EnsureHLSSegment resumes an interrupted rendition and waits for the exact
// segment requested by hls.js. A non-empty partial playlist is not sufficient:
// after a session lease expires it can legitimately reference the next segment
// before that file has been published.
func (m *Manager) EnsureHLSSegment(ctx context.Context, path string, rendition config.Rendition, start float64, session string, color ColorMode, sourceHDR bool, name string) (string, error) {
	key := hlsVideoCacheKey(m, path, rendition, start, color)
	target := filepath.Join(m.Cache.Root, key, name)
	if _, err := os.Stat(target); err == nil {
		return target, nil
	}
	playlist := filepath.Join(m.Cache.Root, key, "index.m3u8")
	suffix := ".ts"
	if color == ColorHDR {
		suffix = ".m4s"
	}
	if inspectPlaylist(playlist, suffix).complete {
		return "", fmt.Errorf("requested segment is absent from a complete playlist: %w", os.ErrNotExist)
	}
	if _, err := m.HLS(ctx, path, rendition, start, session, color, sourceHDR); err != nil {
		return "", err
	}
	if err := m.waitForGeneratedFile(ctx, key, target); err != nil {
		return "", err
	}
	return target, nil
}

func originalHLSCacheKey(m *Manager, path string, start float64, videoCodec string, audioIndex int, copyAudio bool) string {
	audioMode := "encode"
	if audioIndex < 0 {
		audioMode = "none"
	} else if copyAudio {
		audioMode = "copy"
	}
	return m.key(path, originalCacheVersion, videoCodec, strconv.Itoa(audioIndex), audioMode, seekKey(start))
}

func (m *Manager) EnsureOriginalHLSSegment(ctx context.Context, path string, start float64, session, videoCodec string, audioIndex int, copyAudio bool, name string, channels ...int) (string, error) {
	key := originalHLSCacheKey(m, path, start, videoCodec, audioIndex, copyAudio)
	target := filepath.Join(m.Cache.Root, key, name)
	if _, err := os.Stat(target); err == nil {
		return target, nil
	}
	playlist := filepath.Join(m.Cache.Root, key, "index.m3u8")
	if inspectPlaylist(playlist, ".m4s").complete {
		return "", fmt.Errorf("requested original segment is absent from a complete playlist: %w", os.ErrNotExist)
	}
	if _, err := m.OriginalHLS(ctx, path, start, session, videoCodec, audioIndex, copyAudio, channels...); err != nil {
		return "", err
	}
	if err := m.waitForGeneratedFile(ctx, key, target); err != nil {
		return "", err
	}
	return target, nil
}

func audioHLSCacheKey(m *Manager, path string, index int, start float64, copySource bool, sourceCodec string) string {
	mode := "encode"
	if copySource {
		mode = "copy"
	}
	return m.key(path, hlsAudioCacheVersion, mode, sourceCodec, strconv.Itoa(index), seekKey(start))
}

func (m *Manager) EnsureAudioHLSSegment(ctx context.Context, path string, index int, start float64, session string, copySource bool, sourceCodec string, channels int, name string) (string, error) {
	key := audioHLSCacheKey(m, path, index, start, copySource, sourceCodec)
	target := filepath.Join(m.Cache.Root, key, name)
	if _, err := os.Stat(target); err == nil {
		return target, nil
	}
	playlist := filepath.Join(m.Cache.Root, key, "index.m3u8")
	if inspectPlaylist(playlist, audioHLSSuffix(copySource, sourceCodec)).complete {
		return "", fmt.Errorf("requested audio segment is absent from a complete playlist: %w", os.ErrNotExist)
	}
	if _, err := m.AudioHLS(ctx, path, index, start, session, copySource, sourceCodec, channels); err != nil {
		return "", err
	}
	if err := m.waitForGeneratedFile(ctx, key, target); err != nil {
		return "", err
	}
	return target, nil
}

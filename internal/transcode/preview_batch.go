package transcode

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

const (
	previewCacheVersion = "timeline-preview-v2"
	previewBatchVersion = "timeline-preview-batch-v1"
)

type previewFrame struct {
	second float64
	target string
}

func previewTimeKey(second float64) string {
	return strconv.FormatFloat(float64(int64(second*1000+0.5))/1000, 'f', 3, 64)
}

func timelinePreviewPlan(duration float64, depth int) []float64 {
	if duration <= 0 || depth < 0 {
		return nil
	}
	seen := map[string]bool{}
	result := make([]float64, 0, intPow(3, depth))
	for level := 0; level <= depth; level++ {
		count := intPow(3, level)
		for index := 0; index < count; index++ {
			second := (float64(index) + 0.5) * duration / float64(count)
			key := previewTimeKey(second)
			if seen[key] {
				continue
			}
			seen[key] = true
			value, _ := strconv.ParseFloat(key, 64)
			result = append(result, value)
		}
	}
	return result
}

func intPow(base, exponent int) int {
	result := 1
	for range exponent {
		result *= base
	}
	return result
}

func ffconcatQuote(path string) string {
	return strings.ReplaceAll(filepath.ToSlash(path), "'", "'\\''")
}

func previewConcatManifest(path string, timestamps []float64, duration float64) string {
	var manifest strings.Builder
	manifest.WriteString("ffconcat version 1.0\n")
	quoted := ffconcatQuote(path)
	for _, second := range timestamps {
		end := second + 1
		if end > duration {
			end = duration
		}
		manifest.WriteString("file '")
		manifest.WriteString(quoted)
		manifest.WriteString("'\n")
		manifest.WriteString("inpoint ")
		manifest.WriteString(previewTimeKey(second))
		manifest.WriteByte('\n')
		manifest.WriteString("outpoint ")
		manifest.WriteString(previewTimeKey(end))
		manifest.WriteByte('\n')
		manifest.WriteString("duration 1.000\n")
	}
	return manifest.String()
}

func previewBatchArgs(manifest, outputPattern string, frameCount int, cuda bool) []string {
	args := []string{
		"-hide_banner", "-loglevel", "error", "-y",
		"-threads", "1", "-filter_threads", "1", "-filter_complex_threads", "1",
	}
	if cuda {
		args = append(args, "-hwaccel", "cuda", "-hwaccel_output_format", "cuda")
	}
	args = append(args,
		"-f", "concat", "-safe", "0", "-segment_time_metadata", "1",
		"-i", manifest,
		"-map", "0:v:0",
	)
	filter := "select=concatdec_select,scale=-2:80:flags=fast_bilinear,format=yuvj420p,fps=1"
	if cuda {
		filter = "select=concatdec_select,scale_cuda=-2:80:format=yuv420p,hwdownload,format=yuv420p,fps=1,format=yuvj420p"
	}
	return append(args,
		"-vf", filter,
		"-frames:v", strconv.Itoa(frameCount),
		"-q:v", "8", "-an", "-atomic_writing", "1", "-f", "image2",
		outputPattern,
	)
}

func (m *Manager) previewTarget(path string, second float64) (string, string) {
	key := m.key(path, previewCacheVersion, previewTimeKey(second))
	return key, filepath.Join(m.Cache.Root, key+".jpg")
}

func (m *Manager) previewBatchKey(path string) string {
	return m.key(path, previewBatchVersion)
}

func (m *Manager) previewBatch(path string) *job {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.running[m.previewBatchKey(path)]
}

// StartTimelinePreviewBatch starts one prioritized FFmpeg pass for the complete
// ternary preview tree. Frames are moved into the stable cache as soon as each
// JPEG is complete, so clients can progressively refine the timeline without
// spawning one decoder per thumbnail.
func (m *Manager) StartTimelinePreviewBatch(path string, duration float64, depth int, session string) {
	if duration <= 0 || depth < 0 {
		return
	}
	m.TouchSession(session)
	key := m.previewBatchKey(path)
	m.mu.Lock()
	if _, exists := m.running[key]; exists {
		m.mu.Unlock()
		return
	}
	ctx, cancel := context.WithCancel(context.Background())
	active := &job{done: make(chan struct{}), cancel: cancel, session: session, lane: "preview"}
	m.running[key] = active
	m.mu.Unlock()

	go func() {
		defer cancel()
		active.err = m.generateTimelinePreviewBatch(ctx, path, duration, depth)
		close(active.done)
		m.mu.Lock()
		if m.running[key] == active {
			delete(m.running, key)
		}
		m.mu.Unlock()
	}()
}

func (m *Manager) CancelTimelinePreviewBatch(session string) {
	if session == "" {
		return
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, active := range m.running {
		if active.session == session && active.lane == "preview" && active.cancel != nil {
			active.cancel()
		}
	}
}

func (m *Manager) generateTimelinePreviewBatch(ctx context.Context, path string, duration float64, depth int) error {
	select {
	case m.previewSlots <- struct{}{}:
		defer func() { <-m.previewSlots }()
	case <-ctx.Done():
		return ctx.Err()
	}

	plan := timelinePreviewPlan(duration, depth)
	missing := make([]previewFrame, 0, len(plan))
	for _, second := range plan {
		_, target := m.previewTarget(path, second)
		if _, err := os.Stat(target); errors.Is(err, os.ErrNotExist) {
			missing = append(missing, previewFrame{second: second, target: target})
		}
	}
	if len(missing) == 0 {
		return nil
	}

	cudaStrategy := videoStrategy{name: "preview-batch-nvidia-cuda"}
	if m.enabled("nvidia") && m.filters["scale_cuda"] && !m.strategyFailed(cudaStrategy, ColorSDR) {
		remaining, err := m.runTimelinePreviewStrategy(ctx, path, duration, missing, true)
		if err == nil && len(remaining) == 0 {
			m.Log.Info("FFmpeg timeline preview path selected", "operation", "preview.batch", "backend", cudaStrategy.name, "frames", len(missing))
			return m.Cache.Evict()
		}
		if ctx.Err() != nil {
			return ctx.Err()
		}
		m.rememberStrategyFailure(cudaStrategy, ColorSDR)
		m.Log.Warn("GPU timeline preview batch unavailable; using CPU for remaining frames", "operation", "preview.batch", "backend", cudaStrategy.name, "remaining", len(remaining), "error", err)
		missing = remaining
	}
	if len(missing) > 0 {
		remaining, err := m.runTimelinePreviewStrategy(ctx, path, duration, missing, false)
		if err != nil {
			return err
		}
		if len(remaining) > 0 {
			return fmt.Errorf("timeline preview batch completed with %d missing frames", len(remaining))
		}
		m.Log.Info("FFmpeg timeline preview path selected", "operation", "preview.batch", "backend", "cpu", "frames", len(missing))
	}
	return m.Cache.Evict()
}

func (m *Manager) runTimelinePreviewStrategy(ctx context.Context, path string, duration float64, frames []previewFrame, cuda bool) ([]previewFrame, error) {
	temporary, err := os.MkdirTemp(m.Cache.Root, "timeline-preview-")
	if err != nil {
		return frames, err
	}
	defer os.RemoveAll(temporary)

	timestamps := make([]float64, len(frames))
	for index, frame := range frames {
		timestamps[index] = frame.second
	}
	manifestPath := filepath.Join(temporary, "timeline.ffconcat")
	if err := os.WriteFile(manifestPath, []byte(previewConcatManifest(path, timestamps, duration)), 0o600); err != nil {
		return frames, err
	}
	outputPattern := filepath.Join(temporary, "frame-%03d.jpg")
	cmd := m.previewCommand(ctx, previewBatchArgs(manifestPath, outputPattern, len(frames), cuda))
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	stopThrottle, err := m.startPreviewCommand(ctx, cmd)
	if err != nil {
		return frames, err
	}
	done := make(chan error, 1)
	go func() {
		err := cmd.Wait()
		stopThrottle()
		done <- err
	}()

	publish := func() {
		for index, frame := range frames {
			if _, err := os.Stat(frame.target); err == nil {
				continue
			}
			source := filepath.Join(temporary, fmt.Sprintf("frame-%03d.jpg", index+1))
			if _, err := os.Stat(source); err != nil {
				continue
			}
			if err := os.Rename(source, frame.target); err != nil && !errors.Is(err, os.ErrExist) {
				m.Log.Warn("timeline preview frame could not be published", "operation", "preview.publish", "second", frame.second, "error", err)
			}
		}
	}

	ticker := time.NewTicker(20 * time.Millisecond)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			<-done
			publish()
			return missingPreviewFrames(frames), ctx.Err()
		case err := <-done:
			publish()
			remaining := missingPreviewFrames(frames)
			if err != nil {
				return remaining, fmt.Errorf("FFmpeg preview batch failed: %w: %s", err, strings.TrimSpace(stderr.String()))
			}
			return remaining, nil
		case <-ticker.C:
			publish()
		}
	}
}

func missingPreviewFrames(frames []previewFrame) []previewFrame {
	missing := make([]previewFrame, 0)
	for _, frame := range frames {
		if _, err := os.Stat(frame.target); err != nil {
			missing = append(missing, frame)
		}
	}
	return missing
}

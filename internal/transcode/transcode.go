package transcode

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/victor141516/Plarr/internal/cache"
	"github.com/victor141516/Plarr/internal/config"
	"github.com/victor141516/Plarr/internal/probe"
)

const (
	hlsAudioBitrate      = 48_000
	hlsSegmentSeconds    = 2
	hlsVideoCacheVersion = "hls-v13-no-reorder"
	hlsAudioCacheVersion = "audio-hls-v9-aligned"
	originalCacheVersion = "original-av-hls-v4-aac-audio"
	downloadAudioBitrate = 96_000
	defaultSessionIdle   = 15 * time.Second
)

type Manager struct {
	FFmpeg              string
	Cache               *cache.Manager
	Renditions          []config.Rendition
	Hardware            []string
	Log                 *slog.Logger
	mu                  sync.Mutex
	running             map[string]*job
	encoders            map[string]bool
	filters             map[string]bool
	failedStrategies    map[string]bool
	strategyDiagnostics map[string]*playbackStrategyTrace
	sessionLeases       map[string]*sessionLease
	sessionLeaseSeq     uint64
	sessionIdle         time.Duration
	previewSlots        chan struct{}
	previewResources    previewResources
}
type job struct {
	done      chan struct{}
	err       error
	cancel    context.CancelFunc
	session   string
	seekToken string
	lane      string
}

type sessionLease struct {
	generation uint64
	timer      *time.Timer
}

func New(ffmpeg string, c *cache.Manager, r []config.Rendition, hw []string, previewCPUPercent float64, log *slog.Logger) *Manager {
	resources := detectPreviewResources(previewCPUPercent)
	m := &Manager{FFmpeg: ffmpeg, Cache: c, Renditions: r, Hardware: hw, Log: log, running: map[string]*job{}, encoders: map[string]bool{}, filters: map[string]bool{}, failedStrategies: map[string]bool{}, strategyDiagnostics: map[string]*playbackStrategyTrace{}, sessionLeases: map[string]*sessionLease{}, sessionIdle: defaultSessionIdle, previewSlots: make(chan struct{}, 1), previewResources: resources}
	if resources.limiterAvailable {
		log.Info("timeline preview resource budget configured", "operation", "preview.resources", "assignedCPUs", resources.assignedCPUs, "cpuPercent", previewCPUPercent, "limit", resources.limit)
	} else {
		log.Warn("timeline preview CPU limiter unavailable; thread and priority safeguards remain active", "operation", "preview.resources", "assignedCPUs", resources.assignedCPUs, "cpuPercent", previewCPUPercent)
	}
	if out, err := exec.Command(ffmpeg, "-hide_banner", "-encoders").CombinedOutput(); err == nil {
		for _, encoder := range []string{"h264_nvenc", "hevc_nvenc", "h264_qsv", "h264_vaapi", "hevc_vaapi", "libx265"} {
			m.encoders[encoder] = strings.Contains(string(out), encoder)
		}
	}
	if out, err := exec.Command(ffmpeg, "-hide_banner", "-filters").CombinedOutput(); err == nil {
		for _, filter := range []string{"scale_cuda", "scale_vaapi", "zscale", "tonemap", "tonemap_cuda", "tonemap_opencl"} {
			m.filters[filter] = strings.Contains(string(out), filter)
		}
	}
	return m
}

type videoStrategy struct {
	name        string
	beforeInput []string
	args        []string
}

type ColorMode string

const (
	ColorSDR ColorMode = "sdr"
	ColorHDR ColorMode = "hdr"
)

func (m *Manager) Capabilities() map[string]any {
	detected := []string{}
	for _, name := range []string{"h264_nvenc", "hevc_nvenc", "h264_qsv", "h264_vaapi", "hevc_vaapi"} {
		if m.encoders[name] {
			detected = append(detected, name)
		}
	}
	return map[string]any{"detectedEncoders": detected, "configured": m.Hardware, "cpuFallback": true}
}

func (m *Manager) enabled(name string) bool {
	for _, configured := range m.Hardware {
		configured = strings.ToLower(strings.TrimSpace(configured))
		if configured == "auto" || configured == "all" || configured == name {
			return true
		}
	}
	return false
}

func (m *Manager) videoStrategies(height int, color ColorMode, sourceHDR bool) []videoStrategy {
	softwareFilter := fmt.Sprintf("scale=-2:%d,format=yuv420p", height)
	openCLToneMapFilter := ""
	if color == ColorHDR {
		softwareFilter = fmt.Sprintf("scale=-2:%d,format=yuv420p10le", height)
	} else if sourceHDR {
		softwareFilter = fmt.Sprintf("zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv,scale=-2:%d,format=yuv420p", height)
		openCLToneMapFilter = fmt.Sprintf("scale=-2:%d:flags=fast_bilinear,format=p010le,hwupload,tonemap_opencl=tonemap=hable:desat=0:format=nv12:range=tv:primaries=bt709:transfer=bt709:matrix=bt709,hwdownload,format=nv12", height)
	}
	strategies := []videoStrategy{}
	if color == ColorHDR {
		// NVENC Main 10 rejects output sizes below 240p on supported NVIDIA
		// drivers. Keep the guard for custom rendition ladders and fall back to
		// the compatible software path instead of repeatedly crashing NVENC.
		if height >= 240 && m.enabled("nvidia") && m.encoders["hevc_nvenc"] {
			if m.filters["scale_cuda"] {
				strategies = append(strategies, videoStrategy{"nvidia-cuda", []string{"-hwaccel", "cuda", "-hwaccel_output_format", "cuda", "-threads", "1"}, []string{"-vf", fmt.Sprintf("scale_cuda=-2:%d:format=p010le", height), "-c:v", "hevc_nvenc", "-preset", "p4", "-profile:v", "main10", "-tag:v", "hvc1", "-forced-idr", "1", "-no-scenecut", "1", "-strict_gop", "1"}})
			}
			strategies = append(strategies, videoStrategy{"nvidia", nil, []string{"-vf", softwareFilter, "-c:v", "hevc_nvenc", "-preset", "p4", "-profile:v", "main10", "-pix_fmt", "p010le", "-tag:v", "hvc1", "-forced-idr", "1", "-no-scenecut", "1", "-strict_gop", "1"}})
		}
		if deviceExists() {
			strategies = append(strategies, m.vaapiStrategies(height, color, sourceHDR, softwareFilter)...)
		}
		strategies = append(strategies, videoStrategy{"cpu", nil, []string{"-vf", softwareFilter, "-c:v", "libx265", "-preset", "veryfast", "-profile:v", "main10", "-pix_fmt", "yuv420p10le", "-tag:v", "hvc1", "-x265-params", "open-gop=0:scenecut=0"}})
		return strategies
	}
	if m.enabled("nvidia") && m.encoders["h264_nvenc"] {
		if sourceHDR && m.filters["tonemap_cuda"] && m.filters["scale_cuda"] {
			// Jellyfin FFmpeg's CUDA tone mapper keeps decode, resize, HDR-to-SDR
			// conversion, and encode on the GPU. NVENC's zerolatency option is omitted:
			// current NVIDIA drivers can reject tone-mapped frames with it and leave the
			// CUDA context in an illegal-address state. Runtime failures are remembered
			// by strategy name so a broken CUDA path is attempted only once.
			cudaToneMapFilter := fmt.Sprintf("scale_cuda=-2:%d:format=p010le,tonemap_cuda=tonemap=hable:desat=0:format=nv12:range=tv:primaries=bt709:transfer=bt709:matrix=bt709:tradeoff=1:tonemap_mode=auto", height)
			strategies = append(strategies, videoStrategy{
				"nvidia-cuda-tonemap",
				[]string{"-hwaccel", "cuda", "-hwaccel_output_format", "cuda", "-threads", "1"},
				[]string{"-vf", cudaToneMapFilter, "-c:v", "h264_nvenc", "-preset", "p4", "-profile:v", "high", "-forced-idr", "1", "-no-scenecut", "1", "-strict_gop", "1"},
			})
		}
		if sourceHDR && m.filters["tonemap_opencl"] {
			// OpenCL is useful on native Linux drivers that expose an OpenCL ICD.
			// WSL commonly exposes CUDA but no Linux OpenCL platform, in which case
			// this strategy fails once and runVideo continues to software tone mapping.
			strategies = append(strategies, videoStrategy{
				"nvidia-opencl",
				[]string{"-init_hw_device", "opencl=ocl", "-filter_hw_device", "ocl"},
				[]string{"-vf", openCLToneMapFilter, "-c:v", "h264_nvenc", "-preset", "p4", "-profile:v", "high", "-forced-idr", "1", "-no-scenecut", "1", "-strict_gop", "1"},
			})
		}
		// Probe the actual encoder for custom rendition sizes. If a GPU rejects
		// one, runVideo falls back without retrying that failed strategy.
		if !sourceHDR && m.filters["scale_cuda"] {
			strategies = append(strategies, videoStrategy{"nvidia-cuda", []string{"-hwaccel", "cuda", "-hwaccel_output_format", "cuda", "-threads", "1"}, []string{"-vf", fmt.Sprintf("scale_cuda=-2:%d:format=nv12", height), "-c:v", "h264_nvenc", "-preset", "p4", "-profile:v", "high", "-forced-idr", "1", "-no-scenecut", "1", "-strict_gop", "1"}})
		}
		strategies = append(strategies, videoStrategy{"nvidia", nil, []string{"-vf", softwareFilter, "-c:v", "h264_nvenc", "-preset", "p4", "-profile:v", "high", "-forced-idr", "1", "-no-scenecut", "1", "-strict_gop", "1"}})
	}
	if m.enabled("intel") && m.encoders["h264_qsv"] && deviceExists() {
		strategies = append(strategies, videoStrategy{"intel-qsv", nil, []string{"-vf", softwareFilter + ",format=nv12", "-c:v", "h264_qsv", "-preset", "veryfast", "-profile:v", "high"}})
	}
	if deviceExists() {
		strategies = append(strategies, m.vaapiStrategies(height, color, sourceHDR, softwareFilter)...)
	}
	strategies = append(strategies, videoStrategy{"cpu", nil, []string{"-vf", softwareFilter, "-c:v", "libx264", "-preset", "veryfast", "-tune", "zerolatency", "-profile:v", "high", "-level", "4.1", "-x264-params", "open-gop=0:scenecut=0"}})
	return strategies
}

func deviceExists() bool {
	_, err := os.Stat("/dev/dri/renderD128")
	return err == nil
}

func strategyArgs(prefix []string, strategy videoStrategy, suffix []string) []string {
	inputAt := -1
	for i, arg := range prefix {
		if arg == "-i" {
			inputAt = i
			break
		}
	}
	args := make([]string, 0, len(prefix)+len(strategy.beforeInput)+len(strategy.args)+len(suffix))
	if inputAt < 0 {
		args = append(args, prefix...)
		args = append(args, strategy.beforeInput...)
	} else {
		args = append(args, prefix[:inputAt]...)
		args = append(args, strategy.beforeInput...)
		args = append(args, prefix[inputAt:]...)
	}
	args = append(args, strategy.args...)
	return append(args, suffix...)
}

func strategyFailureKey(strategy videoStrategy, color ColorMode) string {
	return strategy.name + ":" + string(color)
}

func (m *Manager) strategyFailed(strategy videoStrategy, color ColorMode) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.failedStrategies[strategyFailureKey(strategy, color)]
}

func (m *Manager) rememberStrategyFailure(strategy videoStrategy, color ColorMode) {
	if strategy.name == "cpu" {
		return
	}
	m.mu.Lock()
	m.failedStrategies[strategyFailureKey(strategy, color)] = true
	m.mu.Unlock()
}

func (m *Manager) runVideo(ctx context.Context, prefix, suffix []string, height int, color ColorMode, sourceHDR bool, cleanup func(), diagnosticSession, diagnosticKey string) error {
	var last error
	for _, strategy := range m.videoStrategies(height, color, sourceHDR) {
		if m.strategyFailed(strategy, color) {
			m.recordVideoStrategy(diagnosticSession, diagnosticKey, strategy.name, "skipped", "Unavailable after an earlier runtime failure.")
			continue
		}
		m.recordVideoStrategy(diagnosticSession, diagnosticKey, strategy.name, "running", "")
		args := strategyArgs(prefix, strategy, suffix)
		if err := m.run(ctx, args); err == nil {
			m.updateVideoStrategy(diagnosticSession, diagnosticKey, strategy.name, "succeeded", "", true)
			m.Log.Info("FFmpeg video path selected", "operation", "transcode", "backend", strategy.name)
			return nil
		} else {
			last = err
			if ctx.Err() != nil {
				m.updateVideoStrategy(diagnosticSession, diagnosticKey, strategy.name, "canceled", "Playback changed or closed.", false)
				return ctx.Err()
			}
			m.updateVideoStrategy(diagnosticSession, diagnosticKey, strategy.name, "failed", strategyErrorSummary(err), false)
			m.rememberStrategyFailure(strategy, color)
			cleanup()
			m.Log.Warn("FFmpeg video path unavailable; trying fallback", "operation", "transcode", "backend", strategy.name, "error", err)
		}
	}
	return last
}
func (m *Manager) key(path string, parts ...string) string {
	sum := sha256.Sum256([]byte(path + "\x00" + strings.Join(parts, "\x00")))
	return hex.EncodeToString(sum[:])
}
func seekKey(start float64) string { return strconv.FormatInt(int64(start*1000+.5), 10) }

// hlsStartNumber is the stable media-sequence base for one seek window.
// FFmpeg's append_list mode already advances by the number of segments in the
// existing playlist. Adding that count here as well makes every resumed job
// jump twice, which hls.js rejects as a media-sequence mismatch.
func hlsStartNumber(start float64, _ int) int {
	if start < 0 {
		start = 0
	}
	return int(start / float64(hlsSegmentSeconds))
}

func hlsVideoInputArgs(path string, inputStart float64) []string {
	args := []string{"-hide_banner", "-loglevel", "error", "-y"}
	if inputStart > 0 {
		args = append(args, "-copyts", "-start_at_zero", "-ss", strconv.FormatFloat(inputStart, 'f', 3, 64), "-noaccurate_seek")
	}
	return append(args, "-i", path, "-map", "0:v:0", "-an")
}

func hlsForceKeyFrames() string {
	// A stream-copied Original rendition can only start fragments at source
	// keyframes. Mirroring those keyframes in every encoded rendition keeps
	// alternate HLS levels on the same fragment and PTS timeline, irrespective
	// of the source GOP cadence.
	return "source"
}

func hlsVideoOutputArgs(r config.Rendition, start float64, completedSegments int, color ColorMode, dir, target string) []string {
	segmentSeconds := strconv.Itoa(hlsSegmentSeconds)
	args := []string{
		"-fps_mode", "passthrough",
		// Audio lives in a separate HLS lane. B-frame reordering gives video
		// negative DTS; the muxer then shifts only that lane (NVENC: two frames),
		// causing a persistent A/V offset. Preserve presentation timestamps by
		// disabling reordering rather than enabling NVENC's unsafe zerolatency.
		"-bf", "0",
		"-flags", "+cgop",
		"-b:v", strconv.Itoa(r.VideoBitrate),
		"-maxrate", strconv.Itoa(int(float64(r.VideoBitrate) * 1.15)),
		"-bufsize", strconv.Itoa(r.VideoBitrate * 2),
		"-force_key_frames", hlsForceKeyFrames(),
	}
	segmentSuffix := ".ts"
	if color == ColorHDR {
		segmentSuffix = ".m4s"
		args = append(args,
			"-color_primaries", "bt2020",
			"-color_trc", "smpte2084",
			"-colorspace", "bt2020nc",
			"-muxdelay", "0",
			"-f", "hls",
			"-hls_time", segmentSeconds,
			"-hls_playlist_type", "event",
			"-hls_segment_type", "fmp4",
			"-hls_fmp4_init_filename", "init.mp4",
			"-hls_flags", "append_list+independent_segments",
		)
	} else {
		args = append(args,
			"-color_primaries", "bt709",
			"-color_trc", "bt709",
			"-colorspace", "bt709",
			// MPEG-TS otherwise adds its historical 1.4 second mux offset while
			// the external AAC lane starts at the source PTS.
			"-muxdelay", "0",
			"-f", "hls",
			"-hls_time", segmentSeconds,
			"-hls_playlist_type", "event",
			"-hls_flags", "append_list+independent_segments",
		)
	}
	return append(args,
		"-start_number", strconv.Itoa(hlsStartNumber(start, completedSegments)),
		"-hls_segment_filename", filepath.Join(dir, "segment-%05d"+segmentSuffix),
		target,
	)
}

func (m *Manager) HLS(ctx context.Context, path string, r config.Rendition, start float64, session string, color ColorMode, sourceHDR bool) (string, error) {
	startKey := seekKey(start)
	key := hlsVideoCacheKey(m, path, r, start, color)
	dir := filepath.Join(m.Cache.Root, key)
	target := filepath.Join(dir, "index.m3u8")
	m.beginVideoDiagnostics(session, key, r.Label, r.Height, color, sourceHDR)
	segmentSuffix := ".ts"
	if color == ColorHDR {
		segmentSuffix = ".m4s"
	}
	state := inspectPlaylist(target, segmentSuffix)
	if state.complete {
		m.markVideoCacheSelected(session, key)
		now := time.Now()
		_ = os.Chtimes(target, now, now)
		return target, nil
	}
	if m.expireInterruptedHLSWindow(key, target, segmentSuffix) {
		return target, ErrHLSWindowExpired
	}
	return target, m.stream(ctx, key, target, segmentSuffix, session, startKey, "video", func(jobCtx context.Context) error {
		if err := os.MkdirAll(dir, 0o750); err != nil {
			return err
		}
		state := repairPlaylistForResume(target, segmentSuffix)
		height := r.Height
		if height <= 0 {
			return errors.New("invalid source resolution")
		}
		inputStart := start + state.duration
		prefix := hlsVideoInputArgs(path, inputStart)
		suffix := hlsVideoOutputArgs(r, start, state.segments, color, dir, target)
		if err := m.runVideo(jobCtx, prefix, suffix, height, color, sourceHDR, func() {
			if state.segments == 0 {
				_ = os.RemoveAll(dir)
				_ = os.MkdirAll(dir, 0o750)
			}
		}, session, key); err != nil {
			return err
		}
		return m.Cache.Evict()
	})
}

// ReadyHLS avoids running ffprobe again for every playlist refresh and media
// segment after a rendition has already started publishing.
func (m *Manager) ReadyHLS(path string, r config.Rendition, start float64, color ColorMode) (string, bool) {
	key := hlsVideoCacheKey(m, path, r, start, color)
	target := filepath.Join(m.Cache.Root, key, "index.m3u8")
	segmentSuffix := ".ts"
	if color == ColorHDR {
		segmentSuffix = ".m4s"
	}
	return target, playlistReady(target, segmentSuffix)
}

// OriginalHLS packages the selected original video and audio into one
// fragmented-MP4 playlist. Keeping both streams in the same FFmpeg process
// gives the muxer ownership of one timeline and one set of segment boundaries.
// The video is always copied; only incompatible audio is encoded to AAC.
func (m *Manager) OriginalHLS(ctx context.Context, path string, start float64, session, videoCodec string, audioIndex int, copyAudio bool) (string, error) {
	startKey := seekKey(start)
	key := originalHLSCacheKey(m, path, start, videoCodec, audioIndex, copyAudio)
	dir := filepath.Join(m.Cache.Root, key)
	target := filepath.Join(dir, "index.m3u8")
	state := inspectPlaylist(target, ".m4s")
	if state.complete {
		now := time.Now()
		_ = os.Chtimes(target, now, now)
		return target, nil
	}
	if m.expireInterruptedHLSWindow(key, target, ".m4s") {
		return target, ErrHLSWindowExpired
	}
	return target, m.stream(ctx, key, target, ".m4s", session, startKey, "video", func(jobCtx context.Context) error {
		if err := os.MkdirAll(dir, 0o750); err != nil {
			return err
		}
		state := repairPlaylistForResume(target, ".m4s")
		inputStart := start + state.duration
		args := originalHLSArgs(path, inputStart, dir, target, state.segments, videoCodec, audioIndex, copyAudio)
		if state.segments == 0 {
			_ = os.RemoveAll(dir)
			if err := os.MkdirAll(dir, 0o750); err != nil {
				return err
			}
		}
		if err := m.run(jobCtx, args); err != nil {
			if state.segments == 0 && !errors.Is(err, context.Canceled) {
				_ = os.RemoveAll(dir)
			}
			return err
		}
		return m.Cache.Evict()
	})
}

func (m *Manager) ReadyOriginalHLS(path string, start float64, videoCodec string, audioIndex int, copyAudio bool) (string, bool) {
	key := originalHLSCacheKey(m, path, start, videoCodec, audioIndex, copyAudio)
	target := filepath.Join(m.Cache.Root, key, "index.m3u8")
	return target, playlistReady(target, ".m4s")
}

func originalHLSArgs(path string, start float64, dir, target string, completedSegments int, videoCodec string, audioIndex int, copyAudio bool) []string {
	seek := strconv.FormatFloat(start, 'f', 3, 64)
	args := []string{"-hide_banner", "-loglevel", "error", "-y"}
	if start > 0 {
		// Stream-copy video necessarily begins at the preceding source keyframe.
		// Keep that same pre-roll for every selected audio mode so the muxer owns
		// one continuous A/V timeline.
		args = append(args, "-copyts", "-start_at_zero", "-ss", seek, "-noaccurate_seek")
	}
	args = append(args, "-i", path, "-map", "0:v:0")
	if audioIndex >= 0 {
		args = append(args, "-map", fmt.Sprintf("0:%d?", audioIndex))
	} else {
		args = append(args, "-an")
	}
	args = append(args, "-c:v", "copy")
	if strings.EqualFold(videoCodec, "hevc") {
		args = append(args, "-tag:v", "hvc1")
	}
	if audioIndex >= 0 {
		if copyAudio {
			args = append(args, "-c:a", "copy")
		} else {
			args = append(args, "-c:a", "aac", "-b:a", strconv.Itoa(hlsAudioBitrate), "-ac", "1", "-ar", "32000")
			if start > 0 {
				args = append(args, "-af", fmt.Sprintf("volume=enable='lt(t,%.3f)':volume=0", start))
			}
		}
	}
	segmentSeconds := strconv.Itoa(hlsSegmentSeconds)
	return append(args,
		"-muxdelay", "0",
		"-f", "hls",
		"-hls_time", segmentSeconds,
		"-hls_playlist_type", "event",
		"-hls_segment_type", "fmp4",
		"-hls_fmp4_init_filename", "init.mp4",
		"-hls_flags", "append_list+independent_segments",
		"-start_number", strconv.Itoa(hlsStartNumber(start, completedSegments)),
		"-hls_segment_filename", filepath.Join(dir, "segment-%05d.m4s"),
		target,
	)
}

func (m *Manager) AudioHLS(ctx context.Context, path string, index int, start float64, session string, copySource bool) (string, error) {
	startKey := seekKey(start)
	key := audioHLSCacheKey(m, path, index, start, copySource)
	dir := filepath.Join(m.Cache.Root, key)
	target := filepath.Join(dir, "index.m3u8")
	if inspectPlaylist(target, ".aac").complete {
		return target, nil
	}
	if m.expireInterruptedHLSWindow(key, target, ".aac") {
		return target, ErrHLSWindowExpired
	}
	return target, m.stream(ctx, key, target, ".aac", session, startKey, "audio", func(jobCtx context.Context) error {
		if err := os.MkdirAll(dir, 0o750); err != nil {
			return err
		}
		state := repairPlaylistForResume(target, ".aac")
		inputStart := start + state.duration
		args := audioHLSArgs(path, index, inputStart, dir, target, hlsStartNumber(start, state.segments), copySource)
		if err := m.run(jobCtx, args); err != nil {
			if state.segments == 0 && !errors.Is(err, context.Canceled) {
				_ = os.RemoveAll(dir)
			}
			return err
		}
		return m.Cache.Evict()
	})
}

func (m *Manager) ReadyAudioHLS(path string, index int, start float64, copySource bool) (string, bool) {
	key := audioHLSCacheKey(m, path, index, start, copySource)
	target := filepath.Join(m.Cache.Root, key, "index.m3u8")
	return target, playlistReady(target, ".aac")
}

func audioHLSArgs(path string, index int, start float64, dir, target string, startNumber int, copySource bool) []string {
	args := []string{"-hide_banner", "-loglevel", "error", "-y"}
	if start > 0 {
		args = append(args, "-copyts", "-start_at_zero")
		args = append(args, "-ss", strconv.FormatFloat(start, 'f', 3, 64))
		// Audio is shared by every adaptive video level, including stream-copy
		// Original. Retaining the source pre-roll is therefore an invariant, not
		// an Original-only mode.
		args = append(args, "-noaccurate_seek")
	}
	args = append(args, "-i", path, "-map", fmt.Sprintf("0:%d", index), "-vn", "-c:a")
	if copySource {
		args = append(args, "copy")
	} else {
		args = append(args, "aac", "-b:a", strconv.Itoa(hlsAudioBitrate), "-ac", "1", "-ar", "32000")
		if start > 0 {
			args = append(args, "-af", fmt.Sprintf("volume=enable='lt(t,%.3f)':volume=0", start))
		}
	}
	return append(args,
		"-muxdelay", "0",
		"-f", "hls",
		"-hls_time", strconv.Itoa(hlsSegmentSeconds),
		"-hls_playlist_type", "event",
		"-hls_flags", "append_list",
		"-start_number", strconv.Itoa(startNumber),
		"-hls_segment_filename", filepath.Join(dir, "audio-%05d.aac"),
		target,
	)
}

func (m *Manager) CancelSession(session string) {
	if session == "" {
		return
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if lease := m.sessionLeases[session]; lease != nil {
		lease.timer.Stop()
		delete(m.sessionLeases, session)
	}
	for _, active := range m.running {
		if active.session == session && active.cancel != nil {
			active.cancel()
		}
	}
}

// TouchSession renews the short lease owned by a visible, active player. HLS
// jobs intentionally outlive individual playlist requests so the next segment
// can be produced without a request gap, but they must not outlive the player
// itself. If the browser disappears without sending an explicit close event,
// the lease expires and cancels every FFmpeg process owned by that session.
func (m *Manager) TouchSession(session string) {
	if session == "" {
		return
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.sessionLeases == nil {
		m.sessionLeases = map[string]*sessionLease{}
	}
	if previous := m.sessionLeases[session]; previous != nil && previous.timer != nil {
		previous.timer.Stop()
	}
	m.sessionLeaseSeq++
	generation := m.sessionLeaseSeq
	timeout := m.sessionIdle
	if timeout <= 0 {
		timeout = defaultSessionIdle
	}
	lease := &sessionLease{generation: generation}
	lease.timer = time.AfterFunc(timeout, func() {
		m.expireSession(session, generation)
	})
	m.sessionLeases[session] = lease
}

func (m *Manager) expireSession(session string, generation uint64) {
	m.mu.Lock()
	defer m.mu.Unlock()
	lease := m.sessionLeases[session]
	if lease == nil || lease.generation != generation {
		return
	}
	delete(m.sessionLeases, session)
	for _, active := range m.running {
		if active.session == session && active.cancel != nil {
			active.cancel()
		}
	}
}

// StreamRemux keeps the source video bit-for-bit and changes only its
// container. Audio is copied when MP4 supports it and converted otherwise.
func streamRemuxArgs(path string, p probe.Result, start float64, audioIndex int) []string {
	audioCodec := ""
	for _, track := range p.Audio {
		if audioIndex < 0 || track.Index == audioIndex {
			audioCodec = strings.ToLower(track.CodecName)
			break
		}
	}
	audioNeedsTranscode := audioCodec != "" && audioCodec != "aac"
	seek := strconv.FormatFloat(start, 'f', 3, 64)
	args := []string{"-hide_banner", "-loglevel", "error"}
	if start > 0 {
		// Remuxed video is copied and begins at the preceding source keyframe.
		// Retain the same audio pre-roll whether audio is copied or encoded.
		args = append(args, "-copyts", "-start_at_zero", "-ss", seek, "-noaccurate_seek")
	}
	audioMap := "0:a:0?"
	if audioIndex >= 0 {
		audioMap = fmt.Sprintf("0:%d?", audioIndex)
	}
	args = append(args, "-i", path, "-map", "0:v:0", "-map", audioMap, "-c:v", "copy")
	if audioCodec == "aac" {
		args = append(args, "-c:a", "copy")
	} else {
		if audioNeedsTranscode && start > 0 {
			args = append(args, "-af", fmt.Sprintf("volume=enable='lt(t,%s)':volume=0", seek))
		}
		args = append(args, "-c:a", "aac", "-b:a", "160k")
	}
	args = append(args, "-movflags", "frag_keyframe+empty_moov+default_base_moof", "-frag_duration", "2000000", "-f", "mp4", "pipe:1")
	return args
}

func (m *Manager) StreamRemux(ctx context.Context, path string, p probe.Result, start float64, audioIndex int, dst io.Writer) (bool, error) {
	args := streamRemuxArgs(path, p, start, audioIndex)
	w := &startupWriter{dst: dst, limit: 16 << 10}
	err := m.runToWriter(ctx, args, w)
	if err == nil {
		err = w.Flush()
	}
	return w.committed, err
}
func (m *Manager) Download(ctx context.Context, path string, p probe.Result, r config.Rendition) (string, error) {
	key := m.key(path, "download", r.Label)
	target := filepath.Join(m.Cache.Root, key+".mp4")
	if _, err := os.Stat(target); err == nil {
		return target, nil
	}
	return target, m.single(ctx, key, func() error {
		height := r.Height
		if p.Video != nil && height > p.Video.Height {
			height = p.Video.Height
		}
		prefix := []string{"-hide_banner", "-loglevel", "error", "-y", "-i", path, "-map", "0:v:0", "-map", "0:a:0?"}
		suffix := []string{"-fps_mode", "passthrough", "-b:v", strconv.Itoa(r.VideoBitrate), "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", target}
		if err := m.runVideo(ctx, prefix, suffix, height, ColorSDR, probe.IsHDR(p.Video), func() { _ = os.Remove(target) }, "", ""); err != nil {
			return err
		}
		return m.Cache.Evict()
	})
}

// StreamDownload writes a fragmented MP4 as FFmpeg produces it. The small
// startup buffer lets a broken hardware encoder fail before any response bytes
// are committed, so the CPU fallback can still produce a clean download.
func (m *Manager) StreamDownload(ctx context.Context, path string, p probe.Result, r config.Rendition, dst io.Writer) (bool, error) {
	height := r.Height
	if p.Video != nil && height > p.Video.Height {
		height = p.Video.Height
	}
	if height <= 0 {
		return false, errors.New("invalid source resolution")
	}
	prefix := []string{"-hide_banner", "-loglevel", "error", "-i", path, "-map", "0:v:0", "-map", "0:a:0?"}
	suffix := []string{
		"-fps_mode", "passthrough",
		"-b:v", strconv.Itoa(r.VideoBitrate),
		"-maxrate", strconv.Itoa(int(float64(r.VideoBitrate) * 1.15)),
		"-bufsize", strconv.Itoa(r.VideoBitrate * 2),
		"-g", "48",
		"-c:a", "aac", "-b:a", strconv.Itoa(downloadAudioBitrate), "-ac", "2",
		"-movflags", "frag_keyframe+empty_moov+default_base_moof",
		"-frag_duration", "2000000", "-f", "mp4", "pipe:1",
	}
	var last error
	for _, strategy := range m.videoStrategies(height, ColorSDR, probe.IsHDR(p.Video)) {
		if m.strategyFailed(strategy, ColorSDR) {
			continue
		}
		writer := &startupWriter{dst: dst, limit: 16 << 10}
		args := strategyArgs(prefix, strategy, suffix)
		err := m.runToWriter(ctx, args, writer)
		if err == nil {
			if flushErr := writer.Flush(); flushErr != nil {
				return writer.committed, flushErr
			}
			m.Log.Info("FFmpeg video path selected", "operation", "download.stream", "backend", strategy.name)
			return writer.committed, nil
		}
		last = err
		if writer.committed || ctx.Err() != nil {
			return writer.committed, err
		}
		m.rememberStrategyFailure(strategy, ColorSDR)
		m.Log.Warn("FFmpeg video path unavailable; trying fallback", "operation", "download.stream", "backend", strategy.name, "error", err)
	}
	return false, last
}

type startupWriter struct {
	dst       io.Writer
	buffer    bytes.Buffer
	limit     int
	committed bool
}

func (w *startupWriter) Write(p []byte) (int, error) {
	if w.committed {
		return w.dst.Write(p)
	}
	n, _ := w.buffer.Write(p)
	if w.buffer.Len() < w.limit {
		return n, nil
	}
	if err := w.Flush(); err != nil {
		return 0, err
	}
	return n, nil
}

func (w *startupWriter) Flush() error {
	if w.committed || w.buffer.Len() == 0 {
		return nil
	}
	n, err := w.dst.Write(w.buffer.Bytes())
	if n > 0 {
		w.committed = true
	}
	if err == nil && n != w.buffer.Len() {
		err = io.ErrShortWrite
	}
	w.buffer.Reset()
	return err
}
func (m *Manager) Subtitle(ctx context.Context, path string, index int) (string, error) {
	key := m.key(path, "subtitle", strconv.Itoa(index))
	target := filepath.Join(m.Cache.Root, key+".vtt")
	if _, err := os.Stat(target); err == nil {
		return target, nil
	}
	return target, m.single(ctx, key, func() error {
		return m.run(ctx, []string{"-hide_banner", "-loglevel", "error", "-y", "-i", path, "-map", fmt.Sprintf("0:%d", index), "-f", "webvtt", target})
	})
}

func previewFrameArgs(path string, second float64, target string) []string {
	return []string{
		"-hide_banner", "-loglevel", "error", "-y",
		"-ss", previewTimeKey(second),
		"-i", path,
		"-map", "0:v:0",
		"-frames:v", "1",
		"-vf", "scale=-2:80:flags=fast_bilinear,format=yuvj420p",
		"-q:v", "8",
		"-an",
		"-f", "image2",
		target,
	}
}

func previewFrameCUDAArgs(path string, second float64, target string) []string {
	return []string{
		"-hide_banner", "-loglevel", "error", "-y",
		"-hwaccel", "cuda",
		"-hwaccel_output_format", "cuda",
		"-threads", "1",
		"-ss", previewTimeKey(second),
		"-i", path,
		"-map", "0:v:0",
		"-frames:v", "1",
		"-vf", "scale_cuda=-2:80:format=yuv420p,hwdownload,format=yuv420p,format=yuvj420p",
		"-q:v", "8",
		"-an",
		"-f", "image2",
		target,
	}
}

// PreviewFrame extracts one tiny frame for a ten-second timeline bucket. It is
// generated only when hovered, cached independently, and tied to the HTTP
// request context so abandoned pointer movement stops FFmpeg immediately.
func (m *Manager) PreviewFrame(ctx context.Context, path string, second float64) (string, error) {
	key, target := m.previewTarget(path, second)
	if _, err := os.Stat(target); err == nil {
		now := time.Now()
		_ = os.Chtimes(target, now, now)
		return target, nil
	}
	if batch := m.previewBatch(path); batch != nil {
		ticker := time.NewTicker(25 * time.Millisecond)
		defer ticker.Stop()
		for {
			if _, err := os.Stat(target); err == nil {
				return target, nil
			}
			select {
			case <-ctx.Done():
				return "", ctx.Err()
			case <-batch.done:
				if _, err := os.Stat(target); err == nil {
					return target, nil
				}
				if batch.err != nil {
					m.Log.Warn("timeline preview batch did not produce requested frame; using single-frame fallback", "operation", "preview.frame", "second", second, "error", batch.err)
				}
				goto fallback
			case <-ticker.C:
			}
		}
	}

fallback:
	err := m.single(ctx, key, func() error {
		select {
		case m.previewSlots <- struct{}{}:
			defer func() { <-m.previewSlots }()
		case <-ctx.Done():
			return ctx.Err()
		}
		release := m.Cache.Acquire(key)
		defer release()
		temporary := target + ".tmp.jpg"
		_ = os.Remove(temporary)
		cudaStrategy := videoStrategy{name: "preview-nvidia-cuda"}
		if m.enabled("nvidia") && m.filters["scale_cuda"] && !m.strategyFailed(cudaStrategy, ColorSDR) {
			cudaRunErr := m.runPreview(ctx, previewFrameCUDAArgs(path, second, temporary))
			cudaErr := cudaRunErr
			if cudaErr == nil {
				_, cudaErr = os.Stat(temporary)
			}
			if cudaErr == nil {
				if err := os.Rename(temporary, target); err != nil {
					_ = os.Remove(temporary)
					return err
				}
				if err := m.Cache.Evict(); err != nil {
					m.Log.Warn("timeline preview cache eviction deferred", "operation", "preview.cache", "error", err)
				}
				return nil
			} else if ctx.Err() != nil {
				_ = os.Remove(temporary)
				return ctx.Err()
			} else {
				// An absent frame near video EOF is a media-timeline condition,
				// not evidence that CUDA is broken for subsequent previews.
				if cudaRunErr != nil {
					m.rememberStrategyFailure(cudaStrategy, ColorSDR)
				}
				m.Log.Warn("GPU timeline preview unavailable; using CPU", "operation", "preview.frame", "backend", cudaStrategy.name, "error", cudaErr)
				_ = os.Remove(temporary)
			}
		}
		if err := m.runPreview(ctx, previewFrameArgs(path, second, temporary)); err != nil {
			_ = os.Remove(temporary)
			return err
		}
		if err := os.Rename(temporary, target); err != nil {
			_ = os.Remove(temporary)
			return err
		}
		if err := m.Cache.Evict(); err != nil {
			m.Log.Warn("timeline preview cache eviction deferred", "operation", "preview.cache", "error", err)
		}
		return nil
	})
	return target, err
}

func (m *Manager) single(ctx context.Context, key string, fn func() error) error {
	m.mu.Lock()
	if j, ok := m.running[key]; ok {
		m.mu.Unlock()
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-j.done:
			return j.err
		}
	}
	j := &job{done: make(chan struct{})}
	m.running[key] = j
	m.mu.Unlock()
	j.err = fn()
	close(j.done)
	m.mu.Lock()
	delete(m.running, key)
	m.mu.Unlock()
	return j.err
}

// stream keeps long-running HLS generation alive when a browser times out or
// switches rendition. The request returns as soon as FFmpeg has published a
// playlist containing its first segment; generation continues in the
// background so playback can start without waiting for the entire movie.
func (m *Manager) stream(ctx context.Context, key, target, segmentSuffix, session, seekToken, lane string, fn func(context.Context) error) error {
	m.TouchSession(session)
	m.mu.Lock()
	j, ok := m.running[key]
	if !ok {
		if session != "" {
			for activeKey, active := range m.running {
				if active.session == session && active.lane == lane && activeKey != key && active.cancel != nil {
					active.cancel()
				}
			}
		}
		jobCtx, cancel := context.WithCancel(context.Background())
		j = &job{done: make(chan struct{}), cancel: cancel, session: session, seekToken: seekToken, lane: lane}
		m.running[key] = j
		go func() {
			release := m.Cache.Acquire(key)
			defer release()
			defer cancel()
			j.err = fn(jobCtx)
			close(j.done)
			m.mu.Lock()
			if m.running[key] == j {
				delete(m.running, key)
			}
			m.mu.Unlock()
		}()
	}
	m.mu.Unlock()

	ticker := time.NewTicker(100 * time.Millisecond)
	defer ticker.Stop()
	for {
		if playlistReady(target, segmentSuffix) {
			if lane == "video" {
				m.markVideoStrategyActive(session, key)
			}
			return nil
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-j.done:
			if playlistReady(target, segmentSuffix) {
				if lane == "video" {
					m.markVideoStrategyActive(session, key)
				}
				return nil
			}
			if j.err != nil {
				return j.err
			}
			return errors.New("HLS generation completed without a playable segment")
		case <-ticker.C:
		}
	}
}

func playlistReady(target, segmentSuffix string) bool {
	return inspectPlaylist(target, segmentSuffix).segments > 0
}

type playlistState struct {
	segments int
	duration float64
	complete bool
}

func inspectPlaylist(target, segmentSuffix string) playlistState {
	b, err := os.ReadFile(target)
	if err != nil {
		return playlistState{}
	}
	state := playlistState{complete: strings.Contains(string(b), "#EXT-X-ENDLIST")}
	for _, line := range strings.Split(string(b), "\n") {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, "#EXTINF:") {
			value := strings.TrimSuffix(strings.TrimPrefix(line, "#EXTINF:"), ",")
			seconds, _ := strconv.ParseFloat(value, 64)
			state.duration += seconds
		}
		if strings.HasSuffix(line, segmentSuffix) && !strings.HasPrefix(line, "#") {
			state.segments++
		}
	}
	return state
}

func (m *Manager) run(ctx context.Context, args []string) error {
	cmd := exec.CommandContext(ctx, m.FFmpeg, args...)
	out, err := cmd.CombinedOutput()
	if err != nil {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		return fmt.Errorf("FFmpeg failed: %w: %s", err, strings.TrimSpace(string(out)))
	}
	return nil
}

func (m *Manager) runToWriter(ctx context.Context, args []string, dst io.Writer) error {
	cmd := exec.CommandContext(ctx, m.FFmpeg, args...)
	var stderr bytes.Buffer
	cmd.Stdout = dst
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		m.Log.Error("FFmpeg streaming operation failed", "operation", "download.stream", "error", err, "output", stderr.String())
		return fmt.Errorf("FFmpeg failed: %w", err)
	}
	return nil
}

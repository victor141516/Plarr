package probe

import (
	"context"
	"encoding/json"
	"fmt"
	"os/exec"
	"strconv"
	"strings"
	"time"
)

type Rational string

func (r Rational) Float() float64 {
	p := strings.Split(string(r), "/")
	if len(p) != 2 {
		return 0
	}
	a, _ := strconv.ParseFloat(p[0], 64)
	b, _ := strconv.ParseFloat(p[1], 64)
	if b == 0 {
		return 0
	}
	return a / b
}

type Stream struct {
	Index          int               `json:"index"`
	CodecName      string            `json:"codec_name"`
	CodecType      string            `json:"codec_type"`
	Profile        string            `json:"profile,omitempty"`
	PixFmt         string            `json:"pix_fmt,omitempty"`
	Level          int               `json:"level,omitempty"`
	Width          int               `json:"width,omitempty"`
	Height         int               `json:"height,omitempty"`
	BitRate        string            `json:"bit_rate,omitempty"`
	RFrameRate     Rational          `json:"r_frame_rate,omitempty"`
	AvgFrameRate   Rational          `json:"avg_frame_rate,omitempty"`
	ColorRange     string            `json:"color_range,omitempty"`
	ColorSpace     string            `json:"color_space,omitempty"`
	ColorTransfer  string            `json:"color_transfer,omitempty"`
	ColorPrimaries string            `json:"color_primaries,omitempty"`
	Channels       int               `json:"channels,omitempty"`
	SampleRate     string            `json:"sample_rate,omitempty"`
	Duration       string            `json:"duration,omitempty"`
	Tags           map[string]string `json:"tags,omitempty"`
	Disposition    map[string]int    `json:"disposition,omitempty"`
}
type Format struct {
	Filename       string            `json:"filename"`
	FormatName     string            `json:"format_name"`
	FormatLongName string            `json:"format_long_name"`
	Duration       string            `json:"duration"`
	Size           string            `json:"size"`
	BitRate        string            `json:"bit_rate"`
	Tags           map[string]string `json:"tags"`
}
type Result struct {
	Streams              []Stream `json:"streams"`
	Format               Format   `json:"format"`
	DurationSeconds      float64  `json:"durationSeconds"`
	VideoDurationSeconds float64  `json:"videoDurationSeconds"`
	Video                *Stream  `json:"video,omitempty"`
	Audio                []Stream `json:"audio"`
	Subtitles            []Stream `json:"subtitles"`
	DirectPlayCandidate  bool     `json:"directPlayCandidate"`
	RemuxCandidate       bool     `json:"remuxCandidate"`
}
type Client struct{ Path string }

func (c Client) Probe(ctx context.Context, path string) (Result, error) {
	ctx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, c.Path, "-v", "error", "-show_format", "-show_streams", "-of", "json", path)
	out, err := cmd.Output()
	if err != nil {
		return Result{}, fmt.Errorf("ffprobe failed: %w", err)
	}
	var r Result
	if err = json.Unmarshal(out, &r); err != nil {
		return r, err
	}
	r.DurationSeconds, _ = strconv.ParseFloat(r.Format.Duration, 64)
	for i := range r.Streams {
		s := r.Streams[i]
		switch s.CodecType {
		case "video":
			if r.Video == nil {
				r.Video = &r.Streams[i]
			}
		case "audio":
			r.Audio = append(r.Audio, s)
		case "subtitle":
			r.Subtitles = append(r.Subtitles, s)
		}
	}
	if r.Video != nil {
		r.VideoDurationSeconds = streamDurationSeconds(r.Video)
	}
	if r.VideoDurationSeconds <= 0 {
		r.VideoDurationSeconds = r.DurationSeconds
	}
	container := strings.ToLower(r.Format.FormatName)
	videoOK := r.Video != nil && (r.Video.CodecName == "h264" || r.Video.CodecName == "hevc" || r.Video.CodecName == "vp8" || r.Video.CodecName == "vp9" || r.Video.CodecName == "av1")
	audioOK := len(r.Audio) == 0 || r.Audio[0].CodecName == "aac" || r.Audio[0].CodecName == "mp3" || r.Audio[0].CodecName == "opus" || r.Audio[0].CodecName == "vorbis"
	r.DirectPlayCandidate = videoOK && audioOK && (strings.Contains(container, "mp4") || strings.Contains(container, "webm") || strings.Contains(container, "mov"))
	r.RemuxCandidate = videoOK
	return r, nil
}

func streamDurationSeconds(stream *Stream) float64 {
	if stream == nil {
		return 0
	}
	if seconds, err := strconv.ParseFloat(stream.Duration, 64); err == nil && seconds > 0 {
		return seconds
	}
	value := stream.Tags["DURATION"]
	parts := strings.Split(value, ":")
	if len(parts) != 3 {
		return 0
	}
	hours, errHours := strconv.ParseFloat(parts[0], 64)
	minutes, errMinutes := strconv.ParseFloat(parts[1], 64)
	seconds, errSeconds := strconv.ParseFloat(parts[2], 64)
	if errHours != nil || errMinutes != nil || errSeconds != nil {
		return 0
	}
	return hours*3600 + minutes*60 + seconds
}

// IsHDR reports whether the stream carries an HDR transfer function. Ten-bit
// pixel formats alone are not enough: SDR sources can also use ten bits.
func IsHDR(stream *Stream) bool {
	if stream == nil {
		return false
	}
	transfer := strings.ToLower(stream.ColorTransfer)
	return transfer == "smpte2084" || transfer == "arib-std-b67"
}

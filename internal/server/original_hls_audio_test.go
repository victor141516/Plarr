package server

import (
	"net/url"
	"strings"
	"testing"

	"github.com/victor141516/Plarr/internal/probe"
)

func TestOriginalHLSAudioCopyCompatibility(t *testing.T) {
	for _, codec := range []string{"aac", "AAC"} {
		if !originalHLSAudioCanCopy(codec) {
			t.Fatalf("expected %s to use stream copy", codec)
		}
	}
	for _, codec := range []string{"mp3", "ac3", "eac3", "dts", "truehd", "opus"} {
		if originalHLSAudioCanCopy(codec) {
			t.Fatalf("expected %s to use compatibility encoding", codec)
		}
	}
}

func TestOriginalAudioConfigTranscodesMP3ForMSE(t *testing.T) {
	p := probe.Result{Audio: []probe.Stream{{Index: 1, CodecName: "mp3"}}}
	index, codec, copyAudio := originalAudioConfig(p, "1")
	if index != 1 || codec != "mp3" || copyAudio {
		t.Fatalf("MP3 must be converted to AAC for an MSE-compatible fMP4 stream: index=%d codec=%s copy=%v", index, codec, copyAudio)
	}
	manifest := originalMasterManifest(p, index, codec, copyAudio, "?audio=1")
	if !strings.Contains(manifest, `CODECS="avc1.4d4028,mp4a.40.2"`) {
		t.Fatalf("MP3 compatibility stream does not advertise AAC: %s", manifest)
	}
}

func TestOriginalMasterUsesOneMuxedAudioVideoVariant(t *testing.T) {
	video := &probe.Stream{CodecName: "h264", Width: 1920, Height: 800}
	p := probe.Result{
		Video:  video,
		Format: probe.Format{BitRate: "4100000"},
	}
	manifest := originalMasterManifest(p, 2, "ac3", false, "?audio=2&audioMode=original&start=4604.000")
	if strings.Contains(manifest, "#EXT-X-MEDIA") || strings.Contains(manifest, "../audio/") {
		t.Fatalf("original master still exposes independently segmented audio: %s", manifest)
	}
	if !strings.Contains(manifest, `CODECS="avc1.640029,mp4a.40.2"`) {
		t.Fatalf("muxed variant does not advertise both codecs: %s", manifest)
	}
	if !strings.Contains(manifest, "video/index.m3u8?audio=2&audioMode=original&start=4604.000") {
		t.Fatalf("selected audio configuration was not propagated to the muxed variant: %s", manifest)
	}
}

func TestOriginalAudioConfigUsesSelectedCompatibilityTrack(t *testing.T) {
	p := probe.Result{Audio: []probe.Stream{
		{Index: 1, CodecName: "aac"},
		{Index: 2, CodecName: "ac3"},
	}}
	index, codec, copyAudio := originalAudioConfig(p, "2")
	if index != 2 || codec != "ac3" || copyAudio {
		t.Fatalf("unexpected selected audio config: index=%d codec=%s copy=%v", index, codec, copyAudio)
	}
}

func TestOriginalHLSAudioCopyModeSurvivesPlaylistRequests(t *testing.T) {
	raw := playbackQueryWithAudio(42.5, "session-1", "7", 3, "copy")
	values, err := url.ParseQuery(raw[1:])
	if err != nil {
		t.Fatal(err)
	}
	if values.Get("audioMode") != "copy" || values.Get("audio") != "3" || values.Get("generation") != "7" {
		t.Fatalf("audio copy mode or selected track was lost: %s", raw)
	}
}

func TestOriginalHLSCompatibilityAudioModeSurvivesPlaylistRequests(t *testing.T) {
	raw := playbackQueryWithAudio(192, "session-2", "8", 1, "original")
	values, err := url.ParseQuery(raw[1:])
	if err != nil {
		t.Fatal(err)
	}
	if values.Get("audioMode") != "original" || values.Get("start") != "192.000" {
		t.Fatalf("original audio pre-roll mode or seek point was lost: %s", raw)
	}
}

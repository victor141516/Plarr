package transcode

import "fmt"

// Keep decoding and scaling on the device when supported. The upload strategy
// still handles codecs the GPU cannot decode; runVideo remembers runtime failures
// and ultimately falls back to the software strategy supplied by videoStrategies.
func (m *Manager) vaapiStrategies(height int, color ColorMode, sourceHDR bool, softwareFilter string) []videoStrategy {
	if !m.enabled("amd") && !m.enabled("intel") {
		return nil
	}
	encoder, profile, format := "h264_vaapi", "high", "nv12"
	if color == ColorHDR {
		encoder, profile, format = "hevc_vaapi", "main10", "p010le"
	}
	if !m.encoders[encoder] {
		return nil
	}
	encode := []string{"-c:v", encoder, "-profile:v", profile}
	if color == ColorHDR {
		encode = append(encode, "-tag:v", "hvc1")
	}
	device := []string{"-vaapi_device", "/dev/dri/renderD128"}
	var strategies []videoStrategy
	if sourceHDR && color == ColorSDR && m.filters["scale_vaapi"] {
		// Keep decode, resize and encode on VAAPI, with CPU tone mapping.
		// Avoid Vulkan userptr imports: affected amdgpu kernels can panic in
		// amdgpu_hmm_invalidate_gfx during memory compaction. DMA-BUF interop
		// also produced black frames on Rembrandt, so it is not a safe fallback.
		before := append([]string{}, device...)
		before = append(before, "-hwaccel", "vaapi", "-hwaccel_output_format", "vaapi", "-threads", "1")
		filter := fmt.Sprintf("scale_vaapi=w=-2:h=%d:format=p010le,hwdownload,format=p010le,%s,format=nv12,hwupload", height, softwareFilter)
		strategies = append(strategies, videoStrategy{"vaapi-decode-tonemap", before, append([]string{"-vf", filter}, encode...)})
	}
	if m.filters["scale_vaapi"] && (color == ColorHDR || !sourceHDR) {
		decode := append([]string{}, device...)
		decode = append(decode, "-hwaccel", "vaapi", "-hwaccel_output_format", "vaapi", "-threads", "1")
		filter := fmt.Sprintf("scale_vaapi=w=-2:h=%d:format=%s", height, format)
		// Set frame metadata before the encoder; output color flags alone cause
		// FFmpeg to insert a software scale filter that cannot accept VAAPI frames.
		if color == ColorSDR {
			filter += ",setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709"
		}
		args := []string{"-vf", filter}
		strategies = append(strategies, videoStrategy{"vaapi-decode", decode, append(args, encode...)})
	}
	args := []string{"-vf", softwareFilter + ",format=" + format + ",hwupload"}
	return append(strategies, videoStrategy{"vaapi", device, append(args, encode...)})
}

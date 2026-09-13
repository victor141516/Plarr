# Plarr

Plarr is a standalone, unauthenticated browser player and versioned media API. It direct-plays compatible sources, remuxes browser-compatible streams when only the container must change, and builds an adaptive HLS ladder with FFmpeg when transcoding is required. It also exposes deterministic audio/subtitle selection, original and transcoded downloads, and versioned playback events for an optional parent application.

Google Cast uses Google's Default Media Receiver, so nothing needs to be installed on the television. The sender hands the receiver absolute Plarr HLS and subtitle URLs and keeps playback position, transport, volume, quality, audio, and subtitles under the existing player controls. The receiver must be able to reach the configured `PLARR_PUBLIC_ORIGIN`; Plarr does not add URL signing or authentication.

## Run

```bash
docker build -t plarr .
docker run --rm -p 8090:8090 -v /path/to/library:/media:ro -v plarr-cache:/cache \
  -e PLARR_MEDIA_ROOT=/media -e PLARR_PUBLIC_ORIGIN=http://localhost:8090 plarr
```

Open `http://localhost:8090/#/play/<base64url-relative-path>`. Paths are decoded and realpath-checked beneath the configured root; traversal, absolute paths, symlink escapes, and non-video files are rejected.

### NVIDIA with Nestrr Compose

On an NVIDIA host, start the stack from the Nestrr repository with both Compose files:

```powershell
docker compose -f docker-compose.yml -f docker-compose.nvidia.yml up -d --build
```

Do not recreate Plarr from the base Compose file alone on that host. The override requests the GPU and exposes the `compute`, `video`, and `utility` driver capabilities required by CUDA, OpenCL tone mapping, and NVENC.

Configuration: `PLARR_LISTEN_ADDR`, `PLARR_MEDIA_ROOT`, `PLARR_PUBLIC_ORIGIN`, `PLARR_ALLOWED_PARENT_ORIGINS`, `PLARR_CACHE_DIR`, `PLARR_CACHE_LIMIT` (10 GB), `PLARR_FFMPEG_PATH`, `PLARR_FFPROBE_PATH`, `PLARR_HARDWARE_ACCELERATION`, `PLARR_RENDITION_LADDER`, and `PLARR_LOG_LEVEL`.

Hardware order in `auto` mode is NVIDIA, Intel QSV, Intel/AMD VAAPI, then the required CPU fallback. The image uses Jellyfin FFmpeg so HDR-to-SDR playback on NVIDIA can attempt a zero-copy CUDA tone map with NVENC. It then tries OpenCL tone mapping for compatible native Linux drivers, software tone mapping with NVENC, and finally full CPU processing. A hardware strategy that fails at runtime is remembered and skipped for the rest of the process lifetime. Merely listing an FFmpeg encoder or filter is not considered proof that the runtime device is usable.

The container never requires a GPU. NVIDIA Docker/WSL deployments must request `gpus: all` and include the `compute`, `video`, and `utility` driver capabilities; Intel/AMD deployments expose `/dev/dri`.

### AMD / Intel VAAPI

Expose `/dev/dri` and add the numeric group owning `/dev/dri/renderD128` to
the container. Nestrr provides `docker-compose.vaapi.yml` for this setup.
VAAPI decoding and resizing precede H.264 encoding for SDR or ten-bit HEVC
encoding for HDR. HDR-to-SDR uses CPU tone mapping between hardware decode
and encode. Vulkan userptr and DMA-BUF tone-mapping paths are excluded after
kernel crashes and black-frame failures on AMD Rembrandt. Unsupported
decoders fall back to software decoding with hardware encoding, followed
by full CPU processing if needed.

The image pins Jellyfin FFmpeg 8.1.2-4. HLS video disables B-frame reordering
to keep independently generated video and audio segments aligned.

The segment cache is cleared at startup and evicts cold files at the configured limit. Closing playback does not delete reusable session segments. See Nestrr's `DEPLOYMENT.md` and `docs/API.md` for the full topology and public contracts.

## Verify

```bash
go test ./...
npm --prefix web test -- --run
npm --prefix web run build
```

The normal web suite includes a deterministic mock Cast receiver. To run the same receiver against a live Plarr HLS stream, provide its absolute master URL:

```bash
PLARR_CAST_TEST_URL='https://plarr.example/api/v1/media/<id>/hls/master.m3u8?session=cast-test&generation=1&start=0&quality=240p' npm --prefix web test -- --run src/castLiveReceiver.test.ts
```

Manual codec and acceleration checks must use a clip of ten seconds or less. Do not transcode a complete movie or episode for verification.

`python scripts/verify_playback.py --help` describes the hardware integration
suite. It generates eight-second flash/tone fixtures and verifies direct
play, stream copy, audio-only and audio/video transcoding, HDR conversion
and preservation, plus non-keyframe seeks. Reports include measured A/V
offsets, drift, stream metadata and runtime strategy diagnostics.

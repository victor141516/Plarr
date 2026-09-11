# Plarr development instructions

## NVIDIA deployments

- On any host with an NVIDIA GPU, always deploy Plarr with Nestrr's NVIDIA Compose override:

  ```powershell
  docker compose -f docker-compose.yml -f docker-compose.nvidia.yml up -d --build
  ```

- Run that command from the Nestrr repository. Never recreate Plarr from `docker-compose.yml` alone on an NVIDIA host; doing so removes the GPU request and the NVIDIA driver libraries from the container.
- After recreating Plarr on an NVIDIA host, verify that the container has a GPU device request and that a short FFmpeg probe can load `libcuda.so.1`.
- The base Compose file remains the supported deployment for CPU-only hosts.

## Transcoding

- Every hardware-accelerated path must have a runtime fallback. Do not treat an encoder or filter listed by FFmpeg as proof that the device can execute it.
- Remember a failed hardware strategy for the lifetime of the process so repeated requests do not retry a known-broken path.
- Use clips of no more than ten seconds for manual transcoding checks. Never transcode a full movie or episode merely to validate a codec, filter, or deployment.
- Keep playback-session cancellation working: a transcode without an active lease must stop after the configured idle grace period.

## Verification

Run the focused tests first, then the complete suites:

```powershell
go test ./...
npm --prefix web test -- --run
npm --prefix web run build
```

Plarr must remain independently usable. Do not import Nestrr code or require Nestrr authentication; integration is limited to the public URL and `postMessage` contracts.

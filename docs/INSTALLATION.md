# Install Plarr

Plarr can run by itself or alongside Nestrr. Start with the standalone setup if you just want to play files from a folder. If you already use Nestrr, use its Compose setup instead of starting a second Plarr container.

## Before you start

- Install Docker Engine or Docker Desktop and make sure `docker` runs from your terminal.
- Choose a folder containing video files. Plarr reads it without changing its contents.
- Make sure port `8090` is free, or change the host side of the port mapping below and the matching port in `PLARR_PUBLIC_ORIGIN`.
- For playback on another device, plan an address that device can reach. `localhost` works only on the computer running Docker.

## Standalone: macOS and Linux

```bash
git clone https://github.com/victor141516/Plarr.git
cd Plarr
docker build -t plarr .
docker run -d --name plarr --restart unless-stopped \
  -p 8090:8090 \
  -v "/absolute/path/to/videos:/media:ro" \
  -v plarr-cache:/cache \
  -e PLARR_MEDIA_ROOT=/media \
  -e PLARR_CACHE_DIR=/cache \
  -e PLARR_PUBLIC_ORIGIN=http://localhost:8090 \
  plarr
```

Replace `/absolute/path/to/videos` with your folder's absolute path. The `:ro` mount keeps the library read-only. The separate cache volume holds temporary playback segments and previews.

## Standalone: Windows PowerShell

```powershell
git clone https://github.com/victor141516/Plarr.git
Set-Location Plarr
docker build -t plarr .
$videoFolder = 'C:\Videos' # Change this to your library folder.
docker run -d --name plarr --restart unless-stopped `
  -p 8090:8090 `
  -v "${videoFolder}:/media:ro" `
  -v plarr-cache:/cache `
  -e PLARR_MEDIA_ROOT=/media `
  -e PLARR_CACHE_DIR=/cache `
  -e PLARR_PUBLIC_ORIGIN=http://localhost:8090 `
  plarr
```

Docker Desktop must be able to access the chosen Windows drive or WSL path. If the container cannot see a file, check its mount and Docker Desktop's file-sharing settings.

## Open a video

Visit `http://localhost:8090/healthz` first. A healthy Plarr replies with `"status":"ok"`.

Player links use a URL-safe Base64 encoding of the path **relative to your video folder**. For example, `sample.mp4` becomes `c2FtcGxlLm1wNA`, so its player URL is:

```text
http://localhost:8090/#/play/c2FtcGxlLm1wNA
```

For a different file, generate its ID locally. Use forward slashes for folders inside the library, such as `Films/My Film.mkv`.

macOS/Linux:

```bash
printf %s 'Films/My Film.mkv' | base64 | tr -d '=\n' | tr '+/' '-_'
```

Windows PowerShell:

```powershell
$relativePath = 'Films/My Film.mkv'
[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($relativePath)).TrimEnd('=').Replace('+', '-').Replace('/', '_')
```

Append the resulting ID to `http://localhost:8090/#/play/`. The media must be inside the mounted library; links cannot reach files outside it.

## Use Plarr with Nestrr

Place the Plarr and [Nestrr](https://github.com/victor141516/Nestrr) repositories side by side. Nestrr's Compose files build and connect Plarr automatically. Configure Nestrr as described in its [deployment guide](https://github.com/victor141516/Nestrr/blob/main/DEPLOYMENT.md). On a **CPU-only** host, run from the **Nestrr** directory:

```bash
docker compose up -d --build
```

Nestrr supplies the media mount, browser-facing player address, and parent-app connection. If you enable `PLARR_API_KEY`, give Nestrr the same value through its Compose environment; Nestrr obtains file-scoped playback grants when playback starts. Do not put the API key in a browser URL.

### NVIDIA GPUs

On an NVIDIA host, including Docker Desktop with WSL, use Nestrr's NVIDIA override **every time you create or recreate the Plarr container**:

```bash
docker compose -f docker-compose.yml -f docker-compose.nvidia.yml up -d --build
```

The override requests the GPU and NVIDIA's compute, video, and utility driver capabilities. Running the base Compose file alone removes that GPU setup. Plarr can still fall back when a hardware path is unavailable; a listed encoder alone does not guarantee that it works on the host.

### AMD and Intel GPUs on Linux

Expose the render device and its numeric group through Nestrr's VAAPI override:

```bash
export RENDER_GID=$(stat -c %g /dev/dri/renderD128)
docker compose -f docker-compose.yml -f docker-compose.vaapi.yml up -d --build
```

CPU-only systems can use the base Compose setup.

## Watch from another device or cast to a TV

Set `PLARR_PUBLIC_ORIGIN` to the address **the viewing device can open**, such as your LAN, Tailscale, or HTTPS address. Restart/recreate Plarr after changing it. The address must include the scheme (`http://` or `https://`) and any nondefault port, with no trailing slash. If Plarr is embedded in Nestrr, set Nestrr's public origin and `PLARR_ALLOWED_PARENT_ORIGINS` to the exact Nestrr origin as well.

Chromecast uses Google's Default Media Receiver; no TV app is required. The Chromecast must be able to reach Plarr's public origin and its media URLs. `http://localhost:8090` on your laptop is **not** an address the Chromecast can use. If you publish Plarr beyond a trusted network, enable access control and HTTPS first.

## Optional access control

Standalone Plarr is open to anyone who can reach its port when `PLARR_API_KEY` is unset. On a trusted local machine this may be fine; for a shared network or public address, set a strong `PLARR_API_KEY` and use Nestrr to request playback grants. The key is exchanged server-to-server, not shown to the browser. A grant is tied to one media file, must be used within one minute, and remains valid while requests are active plus one hour after the last request. Grants are kept in memory and are lost when Plarr restarts.

## Useful checks

```bash
docker ps --filter name=plarr
docker logs plarr --tail 100
```

- **No player page:** check that the container is running and the host port is correct.
- **Playback unavailable:** check the relative path, its encoded ID, file permissions, and the `/media` mount. If access control is on, open the Nestrr-generated player link rather than a bare file URL.
- **A device or Chromecast cannot connect:** replace `localhost` in `PLARR_PUBLIC_ORIGIN` with an address that device can reach, and check the network/proxy path to Plarr.
- **NVIDIA acceleration is missing:** recreate with both Compose files, then inspect the Plarr container's GPU request and NVIDIA driver availability.
- **Need to stop or update it:** use `docker stop plarr` / `docker start plarr` for a standalone install; rebuild the image and recreate the container to update the software.

For playback API details and tests, see the source tree. For Nestrr's full multi-service deployment, use its linked deployment guide.

FROM node:24-alpine AS web
WORKDIR /src/web
COPY web/package*.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

FROM golang:1.26-bookworm AS backend
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY cmd ./cmd
COPY internal ./internal
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/plarr ./cmd/plarr

FROM debian:bookworm-slim
ARG TARGETARCH
ARG JELLYFIN_FFMPEG_VERSION=7.1.4-3
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl ocl-icd-libopencl1 tini \
    && curl -fsSLo /tmp/jellyfin-ffmpeg.deb "https://repo.jellyfin.org/files/ffmpeg/debian/latest-7.x/${TARGETARCH}/jellyfin-ffmpeg7_${JELLYFIN_FFMPEG_VERSION}-bookworm_${TARGETARCH}.deb" \
    && apt-get install -y --no-install-recommends /tmp/jellyfin-ffmpeg.deb \
    && ln -s /usr/lib/jellyfin-ffmpeg/ffmpeg /usr/local/bin/ffmpeg \
    && ln -s /usr/lib/jellyfin-ffmpeg/ffprobe /usr/local/bin/ffprobe \
    && rm -f /tmp/jellyfin-ffmpeg.deb \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --system --uid 10001 --create-home plarr
WORKDIR /app
COPY --from=backend /out/plarr /usr/local/bin/plarr
COPY --from=web /src/web/dist /app/web/dist
RUN mkdir -p /cache /media && chown -R plarr:plarr /cache /app
USER plarr
EXPOSE 8090
ENTRYPOINT ["/usr/bin/tini","--","plarr"]

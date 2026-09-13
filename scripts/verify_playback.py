"""Exercise a running Plarr with eight-second synchronized flash/tone fixtures.

Run on the Docker host. --fixtures must be the host directory mounted in Plarr
at /media (or at /media/<prefix>). No production media is modified.
"""
import argparse
import array
import base64
import hashlib
import json
import pathlib
import subprocess
import time
import urllib.parse
import urllib.request


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--container', required=True)
    p.add_argument('--base', required=True)
    p.add_argument('--fixtures', required=True)
    p.add_argument('--prefix', default='')
    p.add_argument('--backend', choices=['amd', 'nvidia'], required=True)
    p.add_argument('--report', required=True)
    p.add_argument('--source-bframes', type=int, default=0, choices=[0, 3])
    a = p.parse_args()
    run_tag = str(time.time_ns())
    def fixture_name(filename):
        path = pathlib.Path(filename)
        return f'{path.stem}-{run_tag}{path.suffix}'
    root = pathlib.Path(a.fixtures)
    root.mkdir(parents=True, exist_ok=True)

    def cmd(*args):
        r = subprocess.run(['docker', 'exec', a.container, *args], capture_output=True)
        if r.returncode:
            raise RuntimeError(r.stderr.decode(errors='replace')[-5000:])
        return r.stdout

    def ff(*args):
        return cmd('ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', *args)

    def api(path, post=False):
        req = urllib.request.Request(a.base + path, data=b'' if post else None)
        with urllib.request.urlopen(req, timeout=120) as response:
            return response.read()

    cmd('mkdir', '-p', '/cache/verification')
    ff('-f', 'lavfi', '-i', "color=black:s=1280x720:r=24:d=8,drawbox=color=white:t=fill:enable='lt(mod(t,1),0.125)'",
       '-f', 'lavfi', '-i', r'aevalsrc=if(lt(mod(t\,1)\,0.125)\,0.5*sin(2*PI*1000*t)\,0):s=48000:d=8',
       '-t', '8', '-c:v', 'libx264', '-preset', 'ultrafast', '-bf', str(a.source_bframes), '-g', '48',
       '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709',
       '-c:a', 'aac', '/cache/verification/sync-aac.mp4')
    ff('-i', '/cache/verification/sync-aac.mp4', '-t', '8', '-c:v', 'copy', '-c:a', 'ac3', '/cache/verification/sync-ac3.mkv')
    ff('-i', '/cache/verification/sync-ac3.mkv', '-t', '8', '-vf', 'format=yuv420p10le,setparams=color_primaries=bt2020:color_trc=smpte2084:colorspace=bt2020nc',
       '-c:v', 'libx265', '-preset', 'ultrafast', '-x265-params', 'pools=2:keyint=48:min-keyint=48:scenecut=0:colorprim=bt2020:transfer=smpte2084:colormatrix=bt2020nc',
       '-color_primaries', 'bt2020', '-color_trc', 'smpte2084', '-colorspace', 'bt2020nc',
       '-c:a', 'copy', '/cache/verification/sync-hdr.mkv')
    for filename in ['sync-aac.mp4', 'sync-ac3.mkv', 'sync-hdr.mkv']:
        subprocess.run(['docker', 'cp', f'{a.container}:/cache/verification/{filename}', str(root / fixture_name(filename))], check=True, capture_output=True)
        (root / fixture_name(filename)).chmod(0o644)
    hdr = json.loads(cmd('ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=color_transfer,pix_fmt', '-of', 'json', '/cache/verification/sync-hdr.mkv'))['streams'][0]
    assert hdr.get('color_transfer') == 'smpte2084' and hdr.get('pix_fmt') == 'yuv420p10le', hdr

    def mid(filename):
        return base64.urlsafe_b64encode((a.prefix + fixture_name(filename)).encode()).decode().rstrip('=')

    raw = api(f'/api/v1/media/{mid("sync-aac.mp4")}/original')
    assert hashlib.sha256(raw).digest() == hashlib.sha256((root / fixture_name('sync-aac.mp4')).read_bytes()).digest(), 'Direct play changed source bytes'
    results = [{'mode': 'direct', 'byteIdentical': True}]
    cases = [('copy', 'sync-aac.mp4', 'sdr'), ('audio-only', 'sync-ac3.mkv', 'sdr'),
             ('audio-video', 'sync-ac3.mkv', 'sdr'), ('hdr-sdr', 'sync-hdr.mkv', 'sdr'),
             ('hdr-preserve', 'sync-hdr.mkv', 'hdr')]

    def inspect(path):
        metadata = json.loads(cmd('ffprobe', '-v', 'error', '-show_streams', '-show_frames',
                                  '-show_entries', 'stream=index,codec_type,codec_name,pix_fmt,color_transfer,color_primaries,sample_rate:frame=media_type,best_effort_timestamp_time,nb_samples', '-of', 'json', path))
        video = [f for f in metadata['frames'] if f['media_type'] == 'video']
        audio = [f for f in metadata['frames'] if f['media_type'] == 'audio']
        pixels = ff('-i', path, '-an', '-vf', 'scale=1:1,format=gray', '-fps_mode', 'passthrough', '-f', 'rawvideo', '-')
        assert len(pixels) == len(video), (len(pixels), len(video))
        peak = max(pixels)
        assert peak > 40 and max(pixels)-min(pixels) > 35, 'Video is blank or tone mapping lost the flashes'
        flashes = [float(video[i]['best_effort_timestamp_time']) for i, v in enumerate(pixels) if v > peak * .5 and (i == 0 or pixels[i-1] <= peak * .5)]
        audio_stream = next(s for s in metadata['streams'] if s['codec_type'] == 'audio')
        rate = int(audio_stream['sample_rate'])
        pcm = array.array('f', ff('-i', path, '-vn', '-ac', '1', '-c:a', 'pcm_f32le', '-f', 'f32le', '-'))
        # Detect tone energy in 5 ms windows. Ignore codec priming at the first
        # flash; all remaining flashes must align, including after non-keyframe seeks.
        window = max(1, rate // 200)
        energies = [sum(x*x for x in pcm[i:i+window])/window for i in range(0, len(pcm), window)]
        limit = max(energies)*.2
        start = float(audio[0]['best_effort_timestamp_time'])
        tones = [start+i*window/rate for i,e in enumerate(energies) if e > limit and (i == 0 or energies[i-1] <= limit)]
        offsets = [min(tones, key=lambda t: abs(t-v))-v for v in flashes[1:] if tones]
        assert len(offsets) >= 3, f'Insufficient sync markers: {flashes}, {tones}'
        assert max(abs(x) for x in offsets) < .080, f'A/V desync: {offsets}; flashes={flashes}; tones={tones}'
        assert max(offsets)-min(offsets) < .045, f'A/V drift: {offsets}'
        return {'streams': metadata['streams'], 'syncOffsetsMs': [round(x*1000,2) for x in offsets], 'flashCount':len(flashes), 'toneCount':len(tones)}

    for mode, filename, color in cases:
        for seek in [0, 2.5]:
            session = f'verify-{mode}-{str(seek).replace(".", "-")}-{time.time_ns()}'
            family = 'original/master' if mode in ['copy', 'audio-only'] else 'master'
            route = f'/api/v1/media/{mid(filename)}/hls/{family}.m3u8'
            query = urllib.parse.urlencode({'session':session, 'start':seek, 'quality':'720p', 'color':color})
            output = f'/cache/verification/{mode}-{seek}.mkv'
            try:
                # Plarr's legacy .aac routes carry timestamped MPEG-TS audio.
                # Disable FFmpeg's filename-extension heuristic, retaining demux
                # validation of the actual bytes (as browser HLS clients do).
                ff('-extension_picky', '0', '-i', f'http://127.0.0.1:8090{route}?{query}', '-t', '8', '-map', '0:v:0', '-map', '0:a:0', '-c', 'copy', output)
                info = inspect(output)
                diagnostic = json.loads(api(f'/api/v1/playback/sessions/{session}/diagnostics'))
                if mode not in ['copy', 'audio-only']:
                    expected = 'vaapi' if a.backend == 'amd' else 'nvidia'
                    assert diagnostic.get('selected','').startswith(expected) or any(
                        attempt['name'].startswith(expected) and attempt['status'] in ['active','succeeded']
                        for attempt in diagnostic.get('attempts', [])), diagnostic
                if mode == 'hdr-preserve':
                    v = next(s for s in info['streams'] if s['codec_type']=='video')
                    assert v['codec_name']=='hevc' and v['pix_fmt']=='yuv420p10le' and v['color_transfer']=='smpte2084',v
                result = {'mode':mode, 'seek':seek, **info, 'diagnostics':diagnostic}
                results.append(result)
                print(json.dumps({'mode':mode, 'seek':seek, 'syncOffsetsMs':info['syncOffsetsMs'], 'backend':diagnostic.get('selected','copy')}), flush=True)
            finally:
                api(f'/api/v1/playback/sessions/{session}/close', post=True)
                pathlib.Path(a.report).write_text(json.dumps(results,indent=2))
    print(f'PASS: direct play and {len(results)-1} HLS/seek/sync cases on {a.backend}', flush=True)


if __name__ == '__main__':
    main()

# -*- coding: utf-8 -*-
import os, sys, json
base = r"D:\жизнь\ВУЗ\экзамены"
probe = os.path.join(base, "_tts_test", "probe_dmitry.mp3")
outdir = os.path.join(base, "audio-cards", "tools", "_probe")
os.makedirs(outdir, exist_ok=True)

from mutagen.mp3 import MP3
m = MP3(probe)
print("PROBE sr=%d ch=%d br=%d len=%.2f" % (m.info.sample_rate, m.info.channels, m.info.bitrate, m.info.length))
data = open(probe, "rb").read()
print("PROBE size=%d head=%r tail=%r" % (len(data), data[:12], data[-12:]))
print("PROBE has_id3=", data[:3] == b"ID3")

try:
    import lameenc
    enc = lameenc.Encoder()
    enc.set_bit_rate(48)
    enc.set_in_sample_rate(m.info.sample_rate)
    enc.set_channels(m.info.channels)
    enc.set_quality(5)
    n = int(m.info.sample_rate * 1.0)
    raw = b"\x00\x00" * n if m.info.channels == 1 else b"\x00\x00\x00\x00" * n
    sil = enc.encode(raw) + enc.flush()
    sp = os.path.join(outdir, "silence1.mp3")
    open(sp, "wb").write(sil)
    sm = MP3(sp)
    print("SILENCE size=%d sr=%d ch=%d br=%d len=%.3f head=%r" % (len(sil), sm.info.sample_rate, sm.info.channels, sm.info.bitrate, sm.info.length, sil[:8]))
    concat = data + sil + data
    cp = os.path.join(outdir, "concat.mp3")
    open(cp, "wb").write(concat)
    cm = MP3(cp)
    print("CONCAT size=%d len=%.3f (expected ~%.2f)" % (len(concat), cm.info.length, m.info.length*2 + 1.0))
except Exception as e:
    print("LAMEENC_FAIL:", repr(e))

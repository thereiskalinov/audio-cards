# -*- coding: utf-8 -*-
"""Собирает озвучку карточек и docs/content/cards.json.

Использование:
  python build_audio.py content.src/demo.json
"""
import asyncio
import json
import os
import re
import sys
import time
from datetime import datetime, timezone

import edge_tts
from mutagen.mp3 import MP3
import lameenc

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DOCS = os.path.join(ROOT, "docs")
AUDIO_DIR = os.path.join(DOCS, "audio")
ASSETS_DIR = os.path.join(DOCS, "assets")
CONTENT_DIR = os.path.join(DOCS, "content")

MAX_CONCURRENCY = 3


def clean_text(text):
    t = (text or "").strip()
    t = re.sub(r"[*_#>]+", " ", t)
    t = t.replace("\u00a0", " ")
    t = re.sub(r"\s+", " ", t)
    return t.strip()


def make_silence(path, seconds=1.0, sample_rate=24000, channels=1):
    enc = lameenc.Encoder()
    enc.set_bit_rate(48)
    enc.set_in_sample_rate(sample_rate)
    enc.set_channels(channels)
    enc.set_quality(5)
    n = int(sample_rate * seconds)
    raw = (b"\x00\x00" if channels == 1 else b"\x00\x00\x00\x00") * n
    data = enc.encode(raw) + enc.flush()
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as f:
        f.write(data)
    return MP3(path).info.length


async def synth(text, voice, path, rate="+0%", sem=None, retries=3):
    async def _do():
        for attempt in range(retries):
            try:
                comm = edge_tts.Communicate(text, voice, rate=rate)
                await comm.save(path)
                if os.path.exists(path) and os.path.getsize(path) > 500:
                    return
            except Exception:
                if attempt == retries - 1:
                    raise
                await asyncio.sleep(1.5 * (attempt + 1))
        raise RuntimeError("empty audio: %s" % text[:40])
    if sem is None:
        await _do()
    else:
        async with sem:
            await _do()


async def main():
    src_path = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, "content.src", "demo.json")
    with open(src_path, "r", encoding="utf-8") as f:
        src = json.load(f)

    voice = src.get("voice") or "ru-RU-DmitryNeural"
    rate = src.get("rate") or "+0%"
    os.makedirs(AUDIO_DIR, exist_ok=True)
    os.makedirs(ASSETS_DIR, exist_ok=True)
    os.makedirs(CONTENT_DIR, exist_ok=True)

    silence_path = os.path.join(ASSETS_DIR, "silence1.mp3")
    silence_dur = make_silence(silence_path, 1.0)
    print("silence: %.3fs" % silence_dur)

    sem = asyncio.Semaphore(MAX_CONCURRENCY)
    jobs = []
    meta = []
    for idx, card in enumerate(src["cards"]):
        cid = card.get("id") or ("c%03d" % (idx + 1))
        q = clean_text(card.get("q"))
        a = clean_text(card.get("a"))
        rel_q = "audio/%s_q.mp3" % cid
        rel_a = "audio/%s_a.mp3" % cid if a else None
        jobs.append(synth(q, voice, os.path.join(DOCS, rel_q.replace("/", os.sep)), rate, sem))
        if a:
            jobs.append(synth(a, voice, os.path.join(DOCS, rel_a.replace("/", os.sep)), rate, sem))
        meta.append({
            "id": cid,
            "num": card.get("num"),
            "section": card.get("section"),
            "title": card.get("title") or q[:80],
            "q": q,
            "a": a or None,
            "aq": rel_q,
            "aa": rel_a,
        })

    t0 = time.time()
    await asyncio.gather(*jobs)
    print("synth done in %.1fs" % (time.time() - t0))

    cards = []
    for card in meta:
        dq = round(MP3(os.path.join(DOCS, card["aq"].replace("/", os.sep))).info.length, 3)
        da = None
        if card["aa"]:
            da = round(MP3(os.path.join(DOCS, card["aa"].replace("/", os.sep))).info.length, 3)
        card["dq"] = dq
        card["da"] = da
        cards.append(card)

    content = {
        "title": src.get("title") or "Аудиокарточки",
        "subtitle": src.get("subtitle") or "",
        "voice": voice,
        "voiceLabel": src.get("voiceLabel") or voice,
        "silenceDur": round(silence_dur, 3),
        "generatedAt": datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds"),
        "cards": cards,
    }
    out_path = os.path.join(CONTENT_DIR, "cards.json")
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(content, f, ensure_ascii=False, indent=1)

    total_q = sum(c["dq"] for c in cards)
    total_a = sum(c["da"] or 0 for c in cards)
    print("cards: %d, audio: %.1f min (q) + %.1f min (a)" % (len(cards), total_q / 60, total_a / 60))
    print("written:", out_path)


if __name__ == "__main__":
    asyncio.run(main())

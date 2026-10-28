"""Заглушка воркера Qwen3-TTS для тестов: тот же протокол, звук — синус нужной длины (3 слова в секунду)."""
import json, math, os, sys, wave

log = os.environ["FAKE_LOG"]
proto = sys.stdout; sys.stdout = sys.stderr
def L(o):
    with open(log, "a", encoding="utf-8") as f: f.write(json.dumps(o, ensure_ascii=False) + "\n")
def send(o): proto.write(json.dumps(o) + "\n"); proto.flush()
L({"spawn": True})
left = {}
for line in sys.stdin:
    r = json.loads(line)
    if r["cmd"] == "quit": L({"quit": True}); break
    if r["cmd"] == "init":
        L({"init": {k: r.get(k) for k in ("model", "device", "ref", "ref_text", "language")}})
        if os.environ.get("FAKE_INIT_FAIL"): send({"ok": False, "error": "нет весов"}); continue
        send({"ok": True, "load_s": 0.1, "device": r.get("device")})
    elif r["cmd"] == "speak":
        text = r["text"]; words = len(text.split()); sec = words / 3.0
        if "ТРУНК" in text:
            left.setdefault(text, 2)
            if left[text] > 0: left[text] -= 1; sec *= 0.5
        L({"speak": {"words": words, "max_sec": r["max_sec"]}})
        if os.environ.get("FAKE_SPEAK_FAIL"): send({"id": r["id"], "ok": False, "error": "RuntimeError: out of memory"}); continue
        sr = 24000; n = max(1, round(sec * sr))
        with wave.open(r["out"], "wb") as w:
            w.setnchannels(1); w.setsampwidth(2); w.setframerate(sr)
            w.writeframes(b"".join(int(0.3 * 32767 * math.sin(2 * math.pi * 180 * i / sr)).to_bytes(2, "little", signed=True) for i in range(n)))
        send({"id": r["id"], "ok": True, "sec": sec})

"""Заглушка ruaccent_cli.py для тестов: «+» перед первой гласной каждого слова из букв (слово «не» тоже), в журнал пишется каждый вызов."""
import json, os, re, sys
if os.environ.get("FAKE_ACCENT_LOG"):
    with open(os.environ["FAKE_ACCENT_LOG"], "a", encoding="utf-8") as f: f.write("call\n")
if os.environ.get("FAKE_ACCENT_FAIL"):
    print("RuntimeError: модель ударений не загрузилась", file=sys.stderr); sys.exit(1)
req = json.loads(sys.stdin.buffer.read().decode("utf-8"))
V = "аеёиоуыэюяАЕЁИОУЫЭЮЯ"
def mark(m):
    w = m.group(0)
    for i, ch in enumerate(w):
        if ch in V: return w[:i] + "+" + w[i:]
    return w
out = [re.sub(r"[А-Яа-яЁё]+", mark, t) for t in req["texts"]]
sys.stdout.buffer.write(json.dumps({"texts": out}, ensure_ascii=False).encode("utf-8"))

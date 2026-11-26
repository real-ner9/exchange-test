"""Сборка agent-sessions.zip: экспорты сессий Claude Code + реестр + статистика.

Запуск (из корня репозитория, после итогового коммита):
    python scripts/pack_sessions.py --repo-url <URL> [--out agent-sessions.zip]

Что делает:
  * берёт штатные экспорты сессий ~/.claude/projects/<папка проекта>/*.jsonl (и вложенные журналы субагентов);
  * очищает: e-mail, идентификаторы аккаунта/организации, имя пользователя ОС в путях, значения cookie,
    похожие на ключи строки; убирает скрытые рассуждения модели (thinking) и сырые копии API-запросов;
  * считает статистику по каждой сессии: время, сообщения, вызовы инструментов, ошибки, токены;
  * дополняет agent-sessions/registry.json статистикой и полным хешем итогового коммита;
  * пишет README архива и упаковывает всё в zip.
"""
import argparse
import collections
import datetime as dt
import json
import os
import re
import subprocess
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PROJECT_DIR = Path.home() / ".claude" / "projects" / "C--projects-exchange-test"

# Записи, которые не переносятся: дубли полного тела API-запроса (с системным промптом и личным контекстом)
DROP_TYPES = {"api-request-blob", "api-request", "api-request-shape", "data-flow-records", "session-owner"}

EMAIL = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
SECRETS = [
    (re.compile(r"(JSESSIONID[=\t ]+)[A-Za-z0-9._-]+"), r"\1<redacted>"),
    (re.compile(r"\b(sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|xox[bp]-[A-Za-z0-9-]{10,})"), "<redacted-token>"),
]
ALLOWED_EMAILS = {"noreply@anthropic.com"}


def sanitize_text(s: str, user: str, extra: set) -> str:
    s = EMAIL.sub(lambda m: m.group(0) if m.group(0) in ALLOWED_EMAILS else "<email>", s)
    s = re.sub(re.escape(user), "<user>", s, flags=re.IGNORECASE)
    for word in extra:
        s = re.sub(re.escape(word), "<redacted>", s, flags=re.IGNORECASE)
    for rx, rep in SECRETS:
        s = rx.sub(rep, s)
    return s


def strip(obj):
    """Убирает скрытые рассуждения и идентификаторы аккаунта из записи."""
    if isinstance(obj, dict):
        if obj.get("type") in ("thinking", "redacted_thinking"):
            return {"type": obj["type"], "thinking": "<omitted: hidden reasoning not included>"}
        out = {}
        for k, v in obj.items():
            if k in ("accountUuid", "organizationUuid", "signature", "userEmail"):
                continue
            out[k] = strip(v)
        return out
    if isinstance(obj, list):
        return [strip(v) for v in obj]
    return obj


def parse_ts(s):
    return dt.datetime.fromisoformat(s.replace("Z", "+00:00")) if s else None


def session_stats(path: Path):
    st = {
        "messages_user": 0, "messages_assistant": 0, "tool_calls": collections.Counter(), "tool_errors": 0,
        "tokens": collections.Counter(), "models": set(), "versions": set(), "first": None, "last": None,
        "requests": 0, "human_prompts": 0,
    }
    for line in path.open(encoding="utf-8"):
        try:
            d = json.loads(line)
        except json.JSONDecodeError:
            continue
        ts = parse_ts(d.get("timestamp"))
        if ts:
            st["first"] = min(st["first"], ts) if st["first"] else ts
            st["last"] = max(st["last"], ts) if st["last"] else ts
        if d.get("version"):
            st["versions"].add(d["version"])
        t = d.get("type")
        msg = d.get("message") or {}
        if t == "assistant":
            st["messages_assistant"] += 1
            st["requests"] += 1
            if msg.get("model"):
                st["models"].add(msg["model"])
            u = msg.get("usage") or {}
            for k in ("input_tokens", "output_tokens", "cache_creation_input_tokens", "cache_read_input_tokens"):
                st["tokens"][k] += u.get(k) or 0
            for c in msg.get("content") or []:
                if isinstance(c, dict) and c.get("type") == "tool_use":
                    st["tool_calls"][c.get("name")] += 1
        elif t == "user":
            st["messages_user"] += 1
            content = msg.get("content")
            if isinstance(content, str):
                st["human_prompts"] += 1
            elif isinstance(content, list):
                if any(isinstance(c, dict) and c.get("type") == "text" for c in content):
                    st["human_prompts"] += 1
                for c in content:
                    if isinstance(c, dict) and c.get("type") == "tool_result" and c.get("is_error"):
                        st["tool_errors"] += 1
    return st


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--repo-url", default="<не указан>")
    ap.add_argument("--out", default=str(ROOT / "agent-sessions.zip"))
    ap.add_argument("--project-dir", default=str(PROJECT_DIR))
    args = ap.parse_args()

    user = os.environ.get("USERNAME") or os.environ.get("USER") or "user"
    commit = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip()
    registry = json.loads((ROOT / "agent-sessions" / "registry.json").read_text(encoding="utf-8"))
    project_dir = Path(args.project_dir)

    files = sorted(project_dir.glob("*.jsonl")) + sorted(project_dir.glob("*/subagents/*.jsonl"))
    # Локальные части найденных e-mail тоже вычищаем (могли встречаться отдельно, например в командах поиска).
    extra = set()
    for f in files:
        for m in EMAIL.finditer(f.read_text(encoding="utf-8")):
            local = m.group(0).split("@")[0]
            if m.group(0) not in ALLOWED_EMAILS and len(local) >= 5:
                extra.add(local)
    # Идентификаторы аккаунта и организации вычищаем и как значения внутри текста:
    # они попадают в вывод команд и в пути к локальным файлам, а не только в одноимённые поля.
    ids = re.compile(r'(?:accountUuid|organizationUuid|userID|orgId)\\*"\s*:\s*\\*"([0-9a-f-]{16,})')
    for f in files:
        for found in ids.findall(f.read_text(encoding="utf-8")):
            extra.update({found, found[:8]})  # и короткая форма: первые 8 символов тоже узнаваемы
    stats_out = {}
    totals = collections.Counter()
    with zipfile.ZipFile(args.out, "w", zipfile.ZIP_DEFLATED) as z:
        for f in files:
            st = session_stats(f)
            sid = f.stem
            dur = (st["last"] - st["first"]).total_seconds() if st["first"] and st["last"] else None
            stats_out[sid] = {
                "file": f"sessions/{f.relative_to(project_dir).as_posix()}",
                "start": st["first"].isoformat() if st["first"] else None,
                "end": st["last"].isoformat() if st["last"] else None,
                "wallClockSeconds": dur,
                "toolVersions": sorted(st["versions"]),
                "models": sorted(st["models"]),
                "humanPrompts": st["human_prompts"],
                "assistantMessages": st["messages_assistant"],
                "apiRequests": st["requests"],
                "toolCalls": dict(st["tool_calls"].most_common()),
                "toolCallsTotal": sum(st["tool_calls"].values()),
                "toolErrors": st["tool_errors"],
                "tokens": dict(st["tokens"]),
                "cost": "недоступно: Claude Code по подписке не сообщает стоимость в экспорте; не оцениваем, чтобы не выдумывать",
            }
            totals.update(st["tokens"])
            totals["toolCalls"] += sum(st["tool_calls"].values())
            totals["wallClockSeconds"] += dur or 0

            cleaned = []
            for line in f.open(encoding="utf-8"):
                try:
                    d = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if d.get("type") in DROP_TYPES:
                    continue
                cleaned.append(sanitize_text(json.dumps(strip(d), ensure_ascii=False), user, extra))
            z.writestr(stats_out[sid]["file"], "\n".join(cleaned) + "\n")

        for s in registry["sessions"]:
            if s["id"] in stats_out:
                s["stats"] = stats_out[s["id"]]
        registry["finalCommit"] = commit
        registry["repositoryUrl"] = args.repo_url
        registry["totals"] = {
            "tokens": {k: totals[k] for k in ("input_tokens", "output_tokens", "cache_creation_input_tokens", "cache_read_input_tokens")},
            "toolCalls": totals["toolCalls"],
            "sumOfSessionWallClockSeconds": totals["wallClockSeconds"],
            "cost": "недоступно",
        }
        registry["packedAt"] = dt.datetime.now().astimezone().isoformat(timespec="seconds")
        registry["sanitization"] = (
            "Удалены: e-mail (заменены на <email>), идентификаторы аккаунта и организации, имя пользователя ОС в путях "
            "(<user>), значения cookie сессии, строки вида ключей API; скрытые рассуждения модели (thinking) заменены "
            "заглушкой; не перенесены записи api-request*/data-flow-records/session-owner — это дубли тел запросов к API "
            "с системным контекстом. Связи parentUuid/uuid/sessionId между событиями сохранены."
        )
        z.writestr("registry.json", json.dumps(registry, ensure_ascii=False, indent=2))
        z.writestr("README.md", archive_readme(registry, commit, args.repo_url))
    print(f"packed {len(files)} session file(s) into {args.out}; final commit {commit}")


def archive_readme(registry, commit, repo):
    clock = registry.get("deadlineClock", {})
    return f"""# Архив агентских сессий

Репозиторий: {repo}
Итоговый коммит: {commit}

## Состав
- `registry.json` — реестр всех сессий: id, родитель, инструмент и версия, модель, начало и конец (с часовым поясом),
  задача, исход, коммиты, существенные вмешательства человека, статистика (токены, вызовы инструментов, ошибки).
- `sessions/<id>.jsonl` — штатные экспорты Claude Code (JSON Lines), очищенные (см. `registry.json` → `sanitization`).
  Типы записей: `user` (задания человека и результаты инструментов), `assistant` (ответы модели и вызовы инструментов,
  поле `message.usage` — токены), `system`, `attachment`, `file-history-*`. Связь событий — `uuid` / `parentUuid`.

## Как читать
- Задания человека: записи `type=user`, где `message.content` — текст (а не `tool_result`).
- Вызовы инструментов: `type=assistant`, элементы `message.content[]` с `type=tool_use`; результат — в следующей записи
  `type=user` с `tool_result` и тем же `tool_use_id`; ошибки помечены `is_error: true`.
- Время: поле `timestamp` (UTC). Часовой пояс разработчика — +07:00.

## Метрики
- Токены и число вызовов инструментов посчитаны из экспорта (`registry.json` → `stats`, `totals`).
- Стоимость в валюте — **недоступна**: работа шла по подписке, экспорт её не содержит.
- Календарная длительность задания: с {clock.get('start')} до момента сдачи; сумма длительностей сессий — `totals.sumOfSessionWallClockSeconds`.
  Параллельных сессий не было, поэтому сумма времени сессий совпадает с их календарной длительностью.
"""


if __name__ == "__main__":
    main()

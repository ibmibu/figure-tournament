#!/usr/bin/env python3
"""Synchronize public completed tournament results into Git-tracked JSON.

Runs only on GitHub Actions. No Supabase or GitHub API secret is placed in the
website, and the Next.js exporter returns allowlisted public fields only.
"""
import json
import os
import pathlib
import urllib.parse
import urllib.request

API = os.environ.get(
    "ARCHIVE_EXPORT_URL",
    "https://figure-tournament.vercel.app/api/archive/export",
)
ROOT = pathlib.Path(__file__).resolve().parents[1] / "public/data/tournament-archive"
INDEX = ROOT / "index.json"


def request(params):
    url = API + "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={"Accept": "application/json", "User-Agent": "AmiconneArchiveBot/1"})
    with urllib.request.urlopen(req, timeout=90) as response:
        payload = json.load(response)
    if payload.get("version") != 1 or not isinstance(payload.get("records"), list):
        raise ValueError("Unexpected archive export response")
    return payload["records"]


def save(path, obj):
    body = json.dumps(obj, ensure_ascii=False, separators=(",", ":"), sort_keys=True) + "\n"
    path.parent.mkdir(parents=True, exist_ok=True)
    if not path.exists() or path.read_text(encoding="utf-8") != body:
        path.write_text(body, encoding="utf-8")


def main():
    remote = request({"mode": "index"})
    expected = {}
    for row in remote:
        id_ = row.get("id", "")
        digest = row.get("fingerprint", "")
        if not isinstance(id_, str) or not id_.replace("_", "").replace("-", "").isalnum():
            raise ValueError("Invalid archived tournament ID")
        if not isinstance(digest, str) or len(digest) != 24:
            raise ValueError("Invalid archive fingerprint")
        expected[id_] = digest
    local = json.loads(INDEX.read_text(encoding="utf-8")) if INDEX.exists() else {"version": 1, "records": []}
    existing = {row["tournament"]["id"]: row for row in local.get("records", [])}
    if not expected and existing:
        raise ValueError("Refusing to erase archive because API returned no completed tournaments")
    changed = [id_ for id_, digest in expected.items()
               if id_ not in existing or existing[id_].get("fingerprint") != digest
               or not (ROOT / "tournaments" / (id_ + ".json")).exists()]
    for i in range(0, len(changed), 20):
        batch = changed[i:i + 20]
        fetched = request({"ids": ",".join(batch)})
        got = set()
        for row in fetched:
            id_ = row.get("id", "")
            if id_ not in batch or row.get("fingerprint") != expected[id_]:
                raise ValueError("Archive export changed during synchronization; retry on next run")
            if row.get("tournament", {}).get("id") != id_ or row.get("detail", {}).get("id") != id_:
                raise ValueError("Incomplete archive payload")
            got.add(id_)
            existing[id_] = {"fingerprint": expected[id_], "tournament": row["tournament"]}
            save(ROOT / "tournaments" / (id_ + ".json"), row["detail"])
        if got != set(batch):
            raise ValueError("Some finished tournaments disappeared during archive export")
    # A deleted or reopened event must not remain in the public archive index.
    removed = set(existing) - set(expected)
    for id_ in removed:
        path = ROOT / "tournaments" / (id_ + ".json")
        if path.exists():
            path.unlink()
        existing.pop(id_)
    records = sorted(existing.values(), key=lambda r: (
        r["tournament"].get("date") or r["tournament"].get("createdAt") or "", r["tournament"]["id"]),
        reverse=True)
    save(INDEX, {"version": 1, "records": records})
    print(f"Archive: {len(records)} finished events, {len(changed)} updated, {len(removed)} removed.")


if __name__ == "__main__":
    main()

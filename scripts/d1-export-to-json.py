#!/usr/bin/env python3
"""Convert a Wrangler D1 SQL export into a private, deterministic JSON snapshot."""
import hashlib, json, sqlite3, sys

TABLES = ("shows", "episodes", "followed_shows", "movies", "sync_state")
if len(sys.argv) != 3:
    raise SystemExit("usage: d1-export-to-json.py EXPORT.sql SNAPSHOT.json")
conn = sqlite3.connect(":memory:")
conn.executescript(open(sys.argv[1], encoding="utf-8").read())
conn.row_factory = sqlite3.Row
tables = {}
checksums = {}
for table in TABLES:
    rows = [dict(row) for row in conn.execute(f"SELECT * FROM {table}")]
    rows.sort(key=lambda row: json.dumps(row, sort_keys=True, separators=(",", ":")))
    tables[table] = rows
    payload = json.dumps(rows, sort_keys=True, separators=(",", ":")).encode()
    checksums[table] = hashlib.sha256(payload).hexdigest()
snapshot = {"tables": tables, "counts": {k: len(v) for k, v in tables.items()}, "checksums": checksums}
with open(sys.argv[2], "w", encoding="utf-8") as out:
    json.dump(snapshot, out, sort_keys=True, separators=(",", ":"))

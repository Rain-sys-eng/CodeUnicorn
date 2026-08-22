#!/usr/bin/env python3
"""Probe 11: session/list as existence probe + --config-dir profile isolation.

1. session/list (default config) must contain the session created by probe10
   -> viable pendingProbe / existence check for Shared recovery.
2. Repeat create->kill->resume under a custom --config-dir (mossx provider
   profile isolation) to prove profiles do not break resume/list scoping."""
import json
import os
import tempfile

from acp_client import AcpClient, initialize, CWD

TARGET_SESSION = os.environ.get("QODER_PROBE_SESSION", "")

# --- 1. default config-dir: session/list contains known session ---
c = AcpClient(transcript_name="probe11-list-configdir.transcript.ndjson")
try:
    initialize(c)
    lst = c.request("session/list", {"cwd": CWD}, timeout=30)
    sessions = ((lst.get("result") or {}).get("sessions")) or []
    ids = [s.get("sessionId") for s in sessions]
    print("LIST count", len(ids))
    print("LIST sample", json.dumps(sessions[0])[:300] if sessions else "-")
    if TARGET_SESSION:
        print("CONTAINS probe10 session", TARGET_SESSION in ids)
finally:
    c.close()

# --- 2. custom --config-dir isolation: create, kill, resume, list ---
cfg = tempfile.mkdtemp(prefix="qoder-cfgdir-")
d = AcpClient(extra_args=["--config-dir", cfg], transcript_name="probe11-list-configdir-b.ndjson")
sid = None
try:
    initialize(d)
    sess = d.request("session/new", {"cwd": CWD, "mcpServers": []}, timeout=20)
    sid = sess["result"]["sessionId"]
    p = d.request(
        "session/prompt",
        {"sessionId": sid, "prompt": [{"type": "text", "text": "Reply with exactly one word: PONG"}]},
        timeout=150,
    )
    print("CFGDIR prompt err", p.get("error"), "stop", ((p.get("result") or {}).get("stopReason")))
finally:
    d.close()

e = AcpClient(extra_args=["--config-dir", cfg], transcript_name="probe11-list-configdir-c.ndjson")
try:
    initialize(e)
    r = e.request("session/resume", {"sessionId": sid, "cwd": CWD, "mcpServers": []}, timeout=30)
    print("CFGDIR resume err", r.get("error"))
    lst2 = e.request("session/list", {"cwd": CWD}, timeout=30)
    ids2 = [s.get("sessionId") for s in ((lst2.get("result") or {}).get("sessions") or [])]
    print("CFGDIR list contains own session", sid in ids2, "count", len(ids2))
finally:
    e.close()
print("CFGDIR path", cfg)

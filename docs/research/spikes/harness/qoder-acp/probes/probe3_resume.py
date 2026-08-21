#!/usr/bin/env python3
"""Probe 3: session/load replay + session/resume attach (0 model calls).

Reads the session id written by probe2 (or QODER_SPIKE_SESSION_ID)."""
import json
import os

from acp_client import AcpClient, initialize, update_kinds, CWD, EVID

session_id = os.environ.get("QODER_SPIKE_SESSION_ID")
if not session_id:
    with open(os.path.join(EVID, "probe2-session-id.txt")) as fh:
        session_id = fh.read().strip()
print("OLD_SESSION", session_id)

client = AcpClient(transcript_name="probe3-resume.transcript.ndjson")
try:
    initialize(client)
    before = len(client.notifications)
    load = client.request("session/load", {"sessionId": session_id, "cwd": CWD, "mcpServers": []}, timeout=20)
    print("=== session/load ===")
    print(json.dumps(load, indent=2)[:2000])
    replay = client.notifications[before:]
    print("REPLAY_KINDS", update_kinds(replay))
    for note in replay:
        update = (note.get("params") or {}).get("update") or {}
        if update.get("sessionUpdate") in ("user_message_chunk", "agent_message_chunk"):
            print("REPLAY", update.get("sessionUpdate"), json.dumps(update)[:300])
    before = len(client.notifications)
    resume = client.request("session/resume", {"sessionId": session_id, "cwd": CWD, "mcpServers": []}, timeout=20)
    print("=== session/resume ===")
    print(json.dumps(resume, indent=2)[:1200])
    print("RESUME_REPLAY_KINDS", update_kinds(client.notifications[before:]))
finally:
    client.close()

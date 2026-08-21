#!/usr/bin/env python3
"""Probe 2: trivial prompt lifecycle + session/list + set_model (1 model call)."""
import json
import time

from acp_client import AcpClient, initialize, update_kinds, CWD

client = AcpClient(transcript_name="probe2-prompt.transcript.ndjson", auto_allow=True)
try:
    initialize(client)
    sess = client.request("session/new", {"cwd": CWD, "mcpServers": []}, timeout=20)
    session_id = sess["result"]["sessionId"]
    print("SESSION", session_id)
    before = len(client.notifications)
    started = time.time()
    prompt = client.request(
        "session/prompt",
        {"sessionId": session_id, "prompt": [{"type": "text", "text": "Reply with exactly one word: PONG"}]},
        timeout=90,
    )
    print("PROMPT_ELAPSED_MS", int((time.time() - started) * 1000))
    print("=== session/prompt response ===")
    print(json.dumps(prompt, indent=2)[:4000])
    updates = client.notifications[before:]
    print("UPDATE_KINDS", update_kinds(updates))
    print("=== session/list ===")
    print(json.dumps(client.request("session/list", {}, timeout=15), indent=2)[:3000])
    print("=== session/set_model qmodel_38max ===")
    print(json.dumps(client.request(
        "session/set_model", {"sessionId": session_id, "modelId": "qmodel_38max"}, timeout=15,
    ), indent=2)[:1500])
    with open("/tmp/mossx-qoder-spike-evidence/probe2-session-id.txt", "w") as fh:
        fh.write(session_id)
finally:
    client.close()

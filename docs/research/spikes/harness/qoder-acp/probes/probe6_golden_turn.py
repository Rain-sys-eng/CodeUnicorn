#!/usr/bin/env python3
"""Probe 6: golden turn capture with the account default model (2 model calls).

Upgrades spike 'unknown' capabilities (reasoning / tool streaming / usage /
cancel / fork) to measured values once a working account is available."""
import json

from acp_client import AcpClient, initialize, update_kinds, CWD

WATCHED = ("agent_message_chunk", "agent_thought_chunk", "tool_call", "tool_call_update", "plan", "usage_update")

client = AcpClient(transcript_name="probe6-golden-turn.transcript.ndjson")
try:
    initialize(client)
    sess = client.request("session/new", {"cwd": CWD, "mcpServers": []}, timeout=20)
    session_id = sess["result"]["sessionId"]
    print("SESSION", session_id)
    print("set_model err", client.request(
        "session/set_model", {"sessionId": session_id, "modelId": "qmodel_38max"}, timeout=15,
    ).get("error"))
    before = len(client.notifications)
    prompt = client.request(
        "session/prompt",
        {"sessionId": session_id, "prompt": [{"type": "text", "text": "Reply with exactly one word: PONG"}]},
        timeout=150,
    )
    print("PROMPT result", json.dumps(prompt.get("result")), "err", prompt.get("error"))
    for note in client.notifications[before:]:
        update = (note.get("params") or {}).get("update") or {}
        if update.get("sessionUpdate") in WATCHED:
            print("EV", update.get("sessionUpdate"), json.dumps(update)[:500])
    print("KINDS", update_kinds(client.notifications[before:]))
    before = len(client.notifications)
    prompt2 = client.request(
        "session/prompt",
        {"sessionId": session_id, "prompt": [{"type": "text", "text": "Use a tool to list files in the current directory, then say DONE."}]},
        timeout=180,
    )
    print("PROMPT2 result", json.dumps(prompt2.get("result")), "err", prompt2.get("error"))
    for note in client.notifications[before:]:
        update = (note.get("params") or {}).get("update") or {}
        if update.get("sessionUpdate") in WATCHED:
            print("EV2", update.get("sessionUpdate"), json.dumps(update)[:500])
    print("KINDS2", update_kinds(client.notifications[before:]))
    print("AGENT_REQS", [r.get("method") for r in client.agent_requests])
finally:
    client.close()

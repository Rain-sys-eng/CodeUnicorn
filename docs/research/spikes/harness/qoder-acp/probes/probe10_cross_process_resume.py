#!/usr/bin/env python3
"""Probe 10: cross-process multi-turn continuation (Shared/native runtime pattern).

Spawn A: session/new + prompt (plant a fact) -> kill.
Spawn B: initialize + session/resume + prompt (recall the fact).
This is exactly the mossx spawn-per-turn runtime pattern and the Shared
binding re-attach path; proves native identity survives process respawn."""
import json

from acp_client import AcpClient, initialize, CWD

CODEWORD_FACT = "My project's mascot is a purple elephant named Dumbo-42. Remember it."

def spawn():
    return AcpClient(transcript_name="probe10-cross-process.transcript.ndjson")

# --- process A: create session, plant fact, kill ---
a = spawn()
session_id = None
try:
    initialize(a)
    sess = a.request("session/new", {"cwd": CWD, "mcpServers": []}, timeout=20)
    session_id = sess["result"]["sessionId"]
    p = a.request(
        "session/prompt",
        {"sessionId": session_id, "prompt": [{"type": "text", "text": CODEWORD_FACT + " Reply with one word: OK"}]},
        timeout=150,
    )
    print("A prompt err", p.get("error"), "stop", ((p.get("result") or {}).get("stopReason")))
finally:
    a.close()
print("A killed. SESSION", session_id)

# --- process B: resume in a fresh process, ask for the fact ---
b = AcpClient(transcript_name="probe10-cross-process.transcript.ndjson".replace(".ndjson", "-b.ndjson"))
try:
    initialize(b)
    r = b.request("session/resume", {"sessionId": session_id, "cwd": CWD, "mcpServers": []}, timeout=30)
    print("B resume err", r.get("error"))
    before = len(b.notifications)
    p2 = b.request(
        "session/prompt",
        {"sessionId": session_id, "prompt": [{"type": "text", "text": "What is my project's mascot? Answer in one short phrase."}]},
        timeout=150,
    )
    print("B prompt err", p2.get("error"), "stop", ((p2.get("result") or {}).get("stopReason")))
    texts = []
    for n in b.notifications[before:]:
        upd = (n.get("params") or {}).get("update") or {}
        if upd.get("sessionUpdate") == "agent_message_chunk":
            texts.append((upd.get("content") or {}).get("text") or "")
    answer = "".join(texts)
    print("B ANSWER", answer[:200])
    print("RECALL_OK", "Dumbo-42" in answer)
finally:
    b.close()

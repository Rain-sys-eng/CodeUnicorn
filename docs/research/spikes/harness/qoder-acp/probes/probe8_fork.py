#!/usr/bin/env python3
"""Probe 8: live session/fork.

Runs one turn to give the session history, then calls `session/fork` and
verifies the forked session id + that the fork can continue the conversation."""
import json

from acp_client import AcpClient, initialize, update_kinds, CWD

client = AcpClient(transcript_name="probe8-fork.transcript.ndjson")
try:
    initialize(client)
    sess = client.request("session/new", {"cwd": CWD, "mcpServers": []}, timeout=20)
    session_id = sess["result"]["sessionId"]
    print("SESSION", session_id)
    p = client.request(
        "session/prompt",
        {"sessionId": session_id, "prompt": [{"type": "text", "text": "Remember the codeword BANANA. Reply with one word: OK"}]},
        timeout=120,
    )
    print("SEED err", p.get("error"))
    try:
        fork = client.request("session/fork", {"sessionId": session_id, "cwd": CWD, "mcpServers": []}, timeout=30)
        print("FORK result", json.dumps(fork.get("result"))[:600], "err", fork.get("error"))
        forked = (fork.get("result") or {}).get("sessionId")
        if forked:
            p2 = client.request(
                "session/prompt",
                {"sessionId": forked, "prompt": [{"type": "text", "text": "What is the codeword? One word."}]},
                timeout=120,
            )
            print("FORKED PROMPT err", p2.get("error"), "stop", ((p2.get("result") or {}).get("stopReason")))
            texts = [
                ((n.get("params") or {}).get("update") or {}).get("content", {}).get("text")
                for n in client.notifications
                if ((n.get("params") or {}).get("update") or {}).get("sessionUpdate") == "agent_message_chunk"
            ]
            print("FORKED ANSWER", "".join(t for t in texts[-20:] if t))
    except Exception as exc:  # noqa: BLE001
        print("FORK raised", type(exc).__name__, exc)
finally:
    client.close()

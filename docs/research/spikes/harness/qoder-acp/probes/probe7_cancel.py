#!/usr/bin/env python3
"""Probe 7: live cancel semantics.

Starts a long turn, sends `session/cancel` mid-stream, then verifies the
prompt response carries `stopReason: "cancelled"` (ACP standard)."""
import json
import threading
import time

from acp_client import AcpClient, initialize, update_kinds, CWD

client = AcpClient(transcript_name="probe7-cancel.transcript.ndjson")
try:
    initialize(client)
    sess = client.request("session/new", {"cwd": CWD, "mcpServers": []}, timeout=20)
    session_id = sess["result"]["sessionId"]
    print("SESSION", session_id)

    result_box = {}

    def do_prompt():
        result_box["msg"] = client.request(
            "session/prompt",
            {"sessionId": session_id, "prompt": [{"type": "text", "text": "Count from 1 to 100, one number per line, with a short comment on each."}]},
            timeout=120,
        )

    t = threading.Thread(target=do_prompt)
    t.start()
    time.sleep(3)  # let streaming start
    before = len(client.notifications)
    client.notify("session/cancel", {"sessionId": session_id})
    t.join(timeout=130)
    msg = result_box.get("msg")
    print("PROMPT result", json.dumps((msg or {}).get("result")), "err", (msg or {}).get("error"))
    print("STOP_REASON", ((msg or {}).get("result") or {}).get("stopReason"))
    print("KINDS_AFTER_CANCEL", update_kinds(client.notifications[before:]))
finally:
    client.close()

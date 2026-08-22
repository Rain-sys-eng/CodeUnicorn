#!/usr/bin/env python3
"""Probe 9: live mid-turn input (`_meta.qoder.promptQueueing`).

Sends a slow prompt, then issues a second `session/prompt` while the first is
still streaming, and records whether the second is queued (responds after the
first) or rejected."""
import json
import threading
import time

from acp_client import AcpClient, initialize, CWD

client = AcpClient(transcript_name="probe9-midturn.transcript.ndjson")
try:
    initialize(client)
    sess = client.request("session/new", {"cwd": CWD, "mcpServers": []}, timeout=20)
    session_id = sess["result"]["sessionId"]
    print("SESSION", session_id)

    box = {}

    def prompt(tag, text):
        box[tag] = client.request(
            "session/prompt",
            {"sessionId": session_id, "prompt": [{"type": "text", "text": text}]},
            timeout=150,
        )
        box[tag + "_done_at"] = time.time()

    start = time.time()
    t1 = threading.Thread(target=prompt, args=("p1", "Slowly count from 1 to 30, one number per line."))
    t1.start()
    time.sleep(3)  # first turn still streaming
    t2 = threading.Thread(target=prompt, args=("p2", "Now reply with exactly one word: QUEUED_OK"))
    t2.start()
    t1.join(timeout=160)
    t2.join(timeout=160)
    for tag in ("p1", "p2"):
        msg = box.get(tag) or {}
        done = box.get(tag + "_done_at")
        print(tag.upper(),
              "err", msg.get("error"),
              "stop", ((msg.get("result") or {}).get("stopReason")),
              "done_at", round(done - start, 1) if done else "TIMEOUT")
finally:
    client.close()

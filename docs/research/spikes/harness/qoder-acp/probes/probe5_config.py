#!/usr/bin/env python3
"""Probe 5: set_config_option(reasoning_effort) + set_mode (0 model calls)."""
import json

from acp_client import AcpClient, initialize, CWD

client = AcpClient(transcript_name="probe5-config.transcript.ndjson")
try:
    initialize(client)
    sess = client.request("session/new", {"cwd": CWD, "mcpServers": []}, timeout=20)
    session_id = sess["result"]["sessionId"]
    cfg = client.request(
        "session/set_config_option",
        {"sessionId": session_id, "configId": "reasoning_effort", "value": "none"},
        timeout=15,
    )
    print("=== set_config_option ===")
    print(json.dumps(cfg, indent=2)[:2000])
    mode = client.request("session/set_mode", {"sessionId": session_id, "modeId": "bypassPermissions"}, timeout=15)
    print("=== set_mode ===")
    print(json.dumps(mode, indent=2)[:1200])
finally:
    client.close()

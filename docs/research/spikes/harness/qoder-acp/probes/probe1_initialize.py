#!/usr/bin/env python3
"""Probe 1: initialize handshake + session/new (0 model calls)."""
import hashlib
import json
import os
import pathlib
import subprocess
import shutil

from acp_client import AcpClient, initialize, BIN, CWD

real = os.path.realpath(shutil.which(BIN) or BIN)
print("VERSION", subprocess.check_output([BIN, "--version"], text=True).strip())
print("REAL", real)
print("SHA256", hashlib.sha256(pathlib.Path(real).read_bytes()).hexdigest())

client = AcpClient(transcript_name="probe1-initialize.transcript.ndjson")
try:
    init = initialize(client)
    print("=== initialize ===")
    print(json.dumps(init, indent=2)[:8000])
    sess = client.request("session/new", {"cwd": CWD, "mcpServers": []}, timeout=20)
    print("=== session/new ===")
    print(json.dumps(sess, indent=2)[:8000])
finally:
    client.close()

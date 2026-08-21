#!/usr/bin/env python3
"""Minimal ACP stdio JSON-RPC client for the Qoder spike harness.

Spawns `qodercli --acp`, speaks newline-delimited JSON-RPC 2.0, auto-answers
agent->client requests (permission: first allow* option; fs/* confined to the
spike cwd), and writes every raw line to a transcript (`>>` sent / `<<`
received / `!!` stderr).
"""
from __future__ import annotations

import json
import os
import subprocess
import threading
import time

BIN = os.environ.get("QODER_CLI_BIN", "qodercli")
CWD = os.environ.get("QODER_SPIKE_CWD", "/tmp/mossx-qoder-spike")
EVID = os.environ.get("QODER_SPIKE_EVIDENCE", "/tmp/mossx-qoder-spike-evidence")


class AcpClient:
    def __init__(self, extra_args=None, transcript_name="probe.ndjson", auto_allow=True):
        self.auto_allow = auto_allow
        os.makedirs(CWD, exist_ok=True)
        os.makedirs(EVID, exist_ok=True)
        self.transcript_path = os.path.join(EVID, transcript_name)
        self.tf = open(self.transcript_path, "w", encoding="utf-8")
        args = [BIN, "--acp"] + list(extra_args or [])
        self.proc = subprocess.Popen(
            args, cwd=CWD,
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            text=True, bufsize=1,
        )
        self.pending = {}
        self.notifications = []
        self.agent_requests = []
        self.lock = threading.Lock()
        self.next_id = 1
        self.stderr_buf = []
        threading.Thread(target=self._stdout, daemon=True).start()
        threading.Thread(target=self._stderr, daemon=True).start()
        time.sleep(0.3)

    def log(self, direction, line):
        self.tf.write(direction + " " + line + "\n")
        self.tf.flush()

    def _stderr(self):
        for line in self.proc.stderr:
            line = line.rstrip("\n")
            self.stderr_buf.append(line)
            self.log("!!", line)

    def _stdout(self):
        for line in self.proc.stdout:
            raw = line.rstrip("\n")
            if not raw.strip():
                continue
            self.log("<<", raw)
            try:
                msg = json.loads(raw)
            except Exception:
                continue
            with self.lock:
                if "id" in msg and ("result" in msg or "error" in msg):
                    fut = self.pending.get(msg["id"])
                    if fut is not None:
                        fut["msg"] = msg
                        fut["event"].set()
                elif "id" in msg and "method" in msg:
                    self.agent_requests.append(msg)
                    self._handle_agent_request(msg)
                else:
                    self.notifications.append(msg)

    def _handle_agent_request(self, msg):
        method = msg.get("method")
        result = None
        error = None
        try:
            if method == "session/request_permission":
                options = ((msg.get("params") or {}).get("options")) or []
                selected = None
                if self.auto_allow:
                    for opt in options:
                        if str(opt.get("kind") or "").startswith("allow"):
                            selected = opt
                            break
                    if selected is None and options:
                        selected = options[0]
                else:
                    for opt in options:
                        if not str(opt.get("kind") or "").startswith("allow"):
                            selected = opt
                            break
                if selected is None:
                    raise RuntimeError("no permission option matches spike policy")
                result = {"outcome": {"outcome": "selected", "optionId": selected.get("optionId")}}
            elif method == "fs/read_text_file":
                path = (msg.get("params") or {}).get("path")
                if path and os.path.abspath(path).startswith(os.path.abspath(CWD)):
                    with open(path, encoding="utf-8") as fh:
                        result = {"content": fh.read()}
                else:
                    error = {"code": -32603, "message": "path outside spike sandbox"}
            elif method == "fs/write_text_file":
                path = (msg.get("params") or {}).get("path")
                if path and os.path.abspath(path).startswith(os.path.abspath(CWD)):
                    with open(path, "w", encoding="utf-8") as fh:
                        fh.write((msg.get("params") or {}).get("content") or "")
                    result = {}
                else:
                    error = {"code": -32603, "message": "path outside spike sandbox"}
            else:
                error = {"code": -32601, "message": "spike client does not implement " + str(method)}
        except Exception as exc:  # noqa: BLE001
            error = {"code": -32603, "message": str(exc)}
        resp = {"jsonrpc": "2.0", "id": msg["id"]}
        if error is not None:
            resp["error"] = error
        else:
            resp["result"] = result
        payload = json.dumps(resp, separators=(",", ":"))
        self.log(">>", payload)
        self.proc.stdin.write(payload + "\n")
        self.proc.stdin.flush()

    def request(self, method, params, timeout=60.0):
        with self.lock:
            rid = self.next_id
            self.next_id += 1
            event = threading.Event()
            self.pending[rid] = {"event": event, "msg": None}
        payload = {"jsonrpc": "2.0", "id": rid, "method": method, "params": params}
        raw = json.dumps(payload, separators=(",", ":"))
        self.log(">>", raw)
        started = time.time()
        self.proc.stdin.write(raw + "\n")
        self.proc.stdin.flush()
        ok = event.wait(timeout)
        with self.lock:
            msg = self.pending.get(rid, {}).get("msg")
            self.pending.pop(rid, None)
        if not ok or msg is None:
            raise TimeoutError(method + " timed out after " + str(timeout) + "s")
        msg["_elapsed_ms"] = int((time.time() - started) * 1000)
        return msg

    def notify(self, method, params):
        payload = {"jsonrpc": "2.0", "method": method, "params": params}
        raw = json.dumps(payload, separators=(",", ":"))
        self.log(">>", raw)
        self.proc.stdin.write(raw + "\n")
        self.proc.stdin.flush()

    def close(self):
        try:
            if self.proc.stdin:
                self.proc.stdin.close()
        except Exception:
            pass
        self.proc.terminate()
        try:
            self.proc.wait(timeout=3)
        except Exception:
            self.proc.kill()
        self.tf.close()


def initialize(client):
    return client.request("initialize", {
        "protocolVersion": 1,
        "clientInfo": {"name": "mossx-qoder-spike", "version": "0.1.0"},
        "clientCapabilities": {"fs": {"readTextFile": True, "writeTextFile": True}},
    }, timeout=20)


def update_kinds(notifications):
    kinds = []
    for note in notifications:
        update = (note.get("params") or {}).get("update") or {}
        kinds.append(update.get("sessionUpdate") or note.get("method"))
    return kinds

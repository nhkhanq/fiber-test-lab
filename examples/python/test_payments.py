"""Test Fiber payments from Python with the standard library and the fiber-lab CLI.

Run from a project that has fiber-test-lab installed:

    python -m unittest discover -s examples/python

FIBER_LAB_CLI overrides how the CLI is started, e.g. "npm run -s lab --" inside this repository.
"""

import json
import os
import subprocess
import time
import unittest
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
CLI = os.environ.get("FIBER_LAB_CLI", "npx fiber-lab")


def lab(*args):
    command = " ".join([CLI, *[f'"{a}"' for a in args]])
    done = subprocess.run(command, shell=True, capture_output=True, text=True, check=False)
    if done.returncode != 0:
        raise RuntimeError(f"{command} exited {done.returncode}: {done.stderr}")
    return done.stdout


def rpc(url, method, *params):
    body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": list(params)}).encode()
    request = urllib.request.Request(url, data=body, headers={"content-type": "application/json"})
    with urllib.request.urlopen(request, timeout=30) as response:
        answer = json.load(response)
    if "error" in answer:
        raise RuntimeError(answer["error"])
    return answer["result"]


class Payments(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.env = json.loads(lab("up", os.path.join(HERE, "two-nodes.yaml"), "--json"))["environment"]
        cls.run_id = cls.env["runId"]
        cls.alice = cls.env["nodes"]["alice"]
        cls.bob = cls.env["nodes"]["bob"]

    @classmethod
    def tearDownClass(cls):
        lab("reset", cls.run_id)

    def send(self, ckb):
        return rpc(
            self.alice["rpc"],
            "send_payment",
            {"target_pubkey": self.bob["pubkey"], "amount": hex(ckb * 100_000_000), "keysend": True},
        )["payment_hash"]

    def status(self, payment_hash):
        return rpc(self.alice["rpc"], "get_payment", {"payment_hash": payment_hash})["status"]

    def wait_for(self, payment_hash, want, seconds=30):
        deadline = time.time() + seconds
        while time.time() < deadline:
            if self.status(payment_hash) == want:
                return True
            time.sleep(0.5)
        return False

    def test_keysend_settles(self):
        self.assertTrue(self.wait_for(self.send(10), "Success"))

    def test_frozen_peer_leaves_a_payment_undecided(self):
        lab("node", "pause", "bob", "--run", self.run_id)
        try:
            payment = self.send(1)
            time.sleep(3)
            self.assertEqual(self.status(payment), "Inflight")
        finally:
            lab("node", "resume", "bob", "--run", self.run_id)
        self.assertTrue(self.wait_for(payment, "Success"))

    def test_chain_moves_only_when_mined(self):
        tip = int(json.loads(lab("chain", "tip", "--run", self.run_id, "--json"))["tip"])
        time.sleep(2)
        self.assertEqual(int(json.loads(lab("chain", "tip", "--run", self.run_id, "--json"))["tip"]), tip)
        mined = json.loads(lab("chain", "mine", "3", "--run", self.run_id, "--json"))
        self.assertEqual(int(mined["tip"]), tip + 3)


if __name__ == "__main__":
    unittest.main()

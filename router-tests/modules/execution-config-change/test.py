import hashlib
import json
import os
from pathlib import Path
import time
import unittest
import urllib.request

DATA = Path("/data")


def query(operation="{ hello }"):
    request = urllib.request.Request(
        "http://router:3002/graphql",
        json.dumps({"query": operation}).encode(),
        {"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(request, timeout=5) as response:
        return dict(response.headers), json.load(response)


def wait_for(check, description):
    deadline = time.monotonic() + 30
    while time.monotonic() < deadline:
        if check():
            return
        time.sleep(0.1)
    raise AssertionError(f"Timed out: {description}")


def activate(name):
    temporary = DATA / "active.json.next"
    temporary.write_bytes((DATA / f"{name}.json").read_bytes())
    os.replace(temporary, DATA / "active.json")


class ExecutionConfigHookTest(unittest.TestCase):
    def assert_snapshot(self, name, role, routing_url=None):
        config = json.loads((DATA / f"{name}.json").read_text())
        headers, body = query()
        self.assertEqual(body, {"data": {"hello": "world"}})
        self.assertEqual(headers.get("X-Schema-Role"), role, "module did not receive the directive-bearing SDL")
        self.assertEqual(headers.get("X-Schema-Version"), config["version"])
        expected_hash = hashlib.sha256(config["engineConfig"]["graphqlSchema"].encode()).hexdigest()
        self.assertEqual(headers.get("X-Schema-Hash"), expected_hash, "module must receive the exact router SDL text")
        client_schema = config["engineConfig"].get("graphqlClientSchema") or config["engineConfig"]["graphqlSchema"]
        expected_client_hash = hashlib.sha256(client_schema.encode()).hexdigest()
        self.assertEqual(headers.get("X-Client-Schema-Hash"), expected_client_hash, "module must receive the effective client SDL")
        subgraph, = config["subgraphs"]
        self.assertEqual(headers.get("X-Subgraph-Id"), subgraph["id"])
        self.assertEqual(headers.get("X-Subgraph-Name"), subgraph["name"])
        self.assertEqual(headers.get("X-Subgraph-Url"), routing_url or subgraph["routingUrl"])
        return int(headers["X-Schema-Updates"])

    def test_startup_reload_rejection_and_recovery(self):
        updates = self.assert_snapshot("initial", "reader")
        self.assertEqual(updates, 1)
        print("PASS: initial hook receives composed directive and exact SDL", flush=True)

        _, introspection = query("{ __schema { directives { name } } }")
        self.assertNotIn("modulePolicy", [item["name"] for item in introspection["data"]["__schema"]["directives"]])
        print("PASS: filtered client schema is separate from module SDL", flush=True)

        activate("changed")
        wait_for(lambda: query()[0].get("X-Schema-Role") == "writer", "directive update with unchanged version")
        changed_updates = self.assert_snapshot("changed", "writer")
        self.assertGreater(changed_updates, updates)
        print("PASS: changed SDL reloads even with the same version", flush=True)

        activate("routing")
        wait_for(lambda: int(query()[0].get("X-Schema-Updates", "0")) > changed_updates, "routing-only update")
        routing_updates = self.assert_snapshot("routing", "writer")
        print("PASS: routing-only reload delivers the new subgraph URL with identical SDL", flush=True)

        log_offset = (DATA / "router.log").stat().st_size
        activate("invalid")
        wait_for(
            lambda: b"Failed to update server with new config" in (DATA / "router.log").read_bytes()[log_offset:],
            "router explicitly rejects invalid schema",
        )
        self.assertEqual(self.assert_snapshot("routing", "writer"), routing_updates)
        print("PASS: rejected config preserves serving graph and module state", flush=True)

        activate("initial")
        wait_for(lambda: query()[0].get("X-Schema-Role") == "reader", "recovery after rejected config")
        self.assertGreater(self.assert_snapshot("initial", "reader"), routing_updates)
        print("PASS: valid config recovers after rejection", flush=True)

        activate("fallback")
        fallback_config = json.loads((DATA / "fallback.json").read_text())
        fallback_hash = hashlib.sha256(fallback_config["engineConfig"]["graphqlSchema"].encode()).hexdigest()
        wait_for(lambda: query()[0].get("X-Schema-Hash") == fallback_hash, "client-schema fallback")
        self.assert_snapshot("fallback", "reader")
        _, introspection = query("{ __schema { directives { name } } }")
        self.assertIn("modulePolicy", [item["name"] for item in introspection["data"]["__schema"]["directives"]])
        print("PASS: absent client schema falls back to router SDL, matching introspection", flush=True)

        activate("overridden")
        wait_for(lambda: query()[0].get("X-Subgraph-Name") == "local-policy", "local routing override")
        self.assert_snapshot("overridden", "reader", routing_url="http://subgraph:4001/local")
        print("PASS: module receives the local override used to serve the query", flush=True)


if __name__ == "__main__":
    unittest.main(verbosity=2)

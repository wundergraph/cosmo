import hashlib
import json
import os
from pathlib import Path
import time
import unittest
import urllib.error
import urllib.request

DATA = Path("/data")
HELLO = "hello world"
QUERY = "{ greeting card { greeting caption } }"


def query(operation=QUERY, flag="", url="http://router:3002/graphql"):
    headers = {"Content-Type": "application/json"}
    if flag:
        headers["X-Feature-Flag"] = flag
    request = urllib.request.Request(url, json.dumps({"query": operation}).encode(), headers)
    with urllib.request.urlopen(request, timeout=5) as response:
        return response.headers, json.load(response)


def wait_for(check):
    deadline = time.monotonic() + 30
    while True:
        try:
            return check()
        except AssertionError:
            if time.monotonic() >= deadline:
                raise
            time.sleep(0.1)


def activate(name):
    temporary = DATA / "active.json.next"
    temporary.write_bytes((DATA / f"{name}.json").read_bytes())
    os.replace(temporary, DATA / "active.json")


def digest(text):
    return hashlib.sha256(text.encode()).hexdigest()


class ExecutionConfigTest(unittest.TestCase):
    def assert_graph(self, name, translated, flag="", selected="", renamed=False, override=None):
        config = json.loads((DATA / f"{name}.json").read_text())
        if selected:
            config = config["featureFlagConfigs"]["configByFeatureFlagName"][selected]
        nested = "welcome" if renamed else "caption"
        headers, body = query("{ greeting card { greeting " + nested + " } }", flag)
        self.assertEqual(body, {"data": {
            "greeting": HELLO if renamed else translated,
            "card": {"greeting": HELLO, nested: translated},
        }})
        self.assertEqual(headers.get("X-Feature-Flag", ""), selected)
        schema = config["engineConfig"]["graphqlSchema"]
        client = config["engineConfig"].get("graphqlClientSchema") or schema
        sg, = config["subgraphs"]
        self.assertEqual(json.loads(headers["X-Execution-Config"] or "null"), {
            "version": config["version"],
            "schema": digest(schema), "clientSchema": digest(client),
            "subgraphs": [{"ID": sg["id"], "Name": sg["name"], "RoutingURL": override or sg["routingUrl"]}],
        })

    def test_translation_across_reloads(self):
        _, raw = query(url="http://subgraph:4001/graphql")
        self.assertEqual(raw["data"]["greeting"], HELLO)
        self.assertEqual(raw["data"]["card"]["caption"], HELLO)
        self.assert_graph("initial", "Hola mundo")
        introspection = "{ __schema { directives { name } } }"
        _, schema = query(introspection)
        self.assertNotIn("translate", [d["name"] for d in schema["data"]["__schema"]["directives"]])

        activate("changed")
        wait_for(lambda: self.assert_graph("changed", "Ciao mondo"))
        activate("routing")
        wait_for(lambda: self.assert_graph("routing", "Ciao mondo"))

        offset = (DATA / "router.log").stat().st_size
        activate("invalid")
        wait_for(lambda: self.assertIn(b"Failed to update server with new config", (DATA / "router.log").read_bytes()[offset:]))
        self.assert_graph("routing", "Ciao mondo")

        activate("languages")
        wait_for(lambda: self.assert_graph("languages", "Hallo Welt", flag="german", selected="german"))
        self.assert_graph("languages", "Bonjour le monde", flag="french", selected="french")
        self.assert_graph("languages", "Hola mundo")
        self.assert_graph("languages", "Hola mundo", flag="unknown")

        for field, source in [("farewell", "goodbye"), ("unsupportedLanguage", HELLO)]:
            with self.subTest(field=field):
                operation = "{ " + field + " }"
                _, origin = query(operation, url="http://subgraph:4001/graphql")
                self.assertEqual(origin["data"][field], source)
                with self.assertRaises(urllib.error.HTTPError) as failed:
                    query(operation, flag="german")
                with failed.exception as response:
                    self.assertEqual(response.code, 500)
                    self.assertEqual(json.load(response)["errors"], [{"message": "Internal server error"}])

        activate("renamed")
        wait_for(lambda: self.assert_graph("renamed", "Hola mundo", flag="german", renamed=True))
        activate("fallback")
        wait_for(lambda: self.assert_graph("fallback", "Hola mundo"))
        _, schema = query(introspection)
        self.assertIn("translate", [d["name"] for d in schema["data"]["__schema"]["directives"]])

        activate("overridden")
        wait_for(lambda: self.assert_graph("overridden", "Hola mundo", override="http://subgraph:4001/local"))
        activate("uncomposed")
        wait_for(lambda: self.assert_graph("uncomposed", HELLO))


if __name__ == "__main__":
    unittest.main(verbosity=2)

"""Render regressions; set HELM_TEST_KUBECONFIG for Kubernetes server validation."""

import os
from pathlib import Path
import subprocess
import unittest

import yaml


CHART = Path(__file__).resolve().parents[1] / "cosmo"
COMPONENTS = {
    "controlplane": 3001,
    "keycloak": 8080,
    "otelcollector": 4318,
    "graphqlmetrics": 4005,
    "studio": 3000,
    "router": 3002,
    "cdn": 8787,
}
ALL_ROUTES_OFF = {
    f"global.{component}.ingress.enabled": False for component in COMPONENTS
}


def render(overrides=None):
    command = ["helm", "template", "cosmo", str(CHART), "--namespace", "default"]
    kubeconfig = os.environ.get("HELM_TEST_KUBECONFIG")
    if kubeconfig:
        command.extend(["--values", str(Path(__file__).with_name("kind-values.yaml"))])
    for key, value in (overrides or {}).items():
        command.extend(["--set", f"{key}={str(value).lower() if isinstance(value, bool) else value}"])
    result = subprocess.run(command, capture_output=True, text=True)
    if result.returncode:
        raise AssertionError(result.stderr)
    if kubeconfig:
        validation = subprocess.run(
            ["kubectl", "--kubeconfig", kubeconfig, "apply", "--dry-run=server", "-f", "-"],
            input=result.stdout, capture_output=True, text=True,
        )
        if validation.returncode:
            raise AssertionError(validation.stderr)
    return [doc for doc in yaml.safe_load_all(result.stdout) if doc]


def shared_ingress(documents):
    return next(
        (doc for doc in documents
         if doc["kind"] == "Ingress" and doc["metadata"]["name"] == "cosmo-cosmo"),
        None,
    )


def hosts(ingress):
    return {rule["host"] for rule in ingress["spec"]["rules"]}


class IngressTests(unittest.TestCase):
    def test_defaults_preserve_routes_and_backends(self):
        ingress = shared_ingress(render())
        self.assertEqual(hosts(ingress), {
            f"{component}.wundergraph.local" for component in COMPONENTS if component != "router"
        })
        for rule in ingress["spec"]["rules"]:
            component = rule["host"].split(".")[0]
            suffix = "-http" if component == "keycloak" else ""
            self.assertEqual(rule["http"]["paths"], [{
                "path": "/", "pathType": "Prefix",
                "backend": {"service": {
                    "name": f"cosmo-{component}{suffix}",
                    "port": {"number": COMPONENTS[component]},
                }},
            }])

    def test_disabling_each_route_preserves_its_component(self):
        for component in COMPONENTS:
            with self.subTest(component=component):
                documents = render({
                    "global.router.enabled": True,
                    f"global.{component}.ingress.enabled": False,
                })
                self.assertEqual(hosts(shared_ingress(documents)), {
                    f"{other}.wundergraph.local" for other in COMPONENTS if other != component
                })
                resources = {(doc["kind"], doc["metadata"]["name"]) for doc in documents}
                kind = "StatefulSet" if component == "keycloak" else "Deployment"
                self.assertIn((kind, f"cosmo-{component}"), resources)
                suffix = "-http" if component == "keycloak" else ""
                self.assertIn(("Service", f"cosmo-{component}{suffix}"), resources)
                if component == "otelcollector":
                    self.assertTrue(any(
                        doc["kind"] == "Job"
                        and doc["metadata"]["name"].startswith("cosmo-controlplane-clickhouse-migration-")
                        for doc in documents
                    ))

    def test_missing_ingress_settings_preserve_routes_for_existing_releases(self):
        # Helm --reuse-values can retain old values without the new defaults.
        for setting in ("ingress", "ingress.enabled"):
            with self.subTest(setting=setting):
                documents = render({
                    "global.router.enabled": True,
                    **{f"global.{component}.{setting}": "null" for component in COMPONENTS},
                })
                self.assertEqual(hosts(shared_ingress(documents)), {
                    f"{component}.wundergraph.local" for component in COMPONENTS
                })

    def test_disabled_components_have_no_route(self):
        for component in COMPONENTS:
            with self.subTest(component=component):
                documents = render({
                    "global.router.enabled": True,
                    f"global.{component}.enabled": False,
                    f"global.{component}.ingress.enabled": True,
                })
                self.assertEqual(hosts(shared_ingress(documents)), {
                    f"{other}.wundergraph.local" for other in COMPONENTS if other != component
                })

    def test_all_routes_disabled_omits_shared_ingress(self):
        self.assertIsNone(shared_ingress(render(ALL_ROUTES_OFF)))

    def test_all_components_disabled_omits_shared_ingress(self):
        self.assertIsNone(shared_ingress(render({
            f"global.{component}.enabled": False for component in COMPONENTS
        })))

    def test_default_backend_without_routes(self):
        ingress = shared_ingress(render({
            **ALL_ROUTES_OFF,
            "ingress.defaultBackend.name": "fallback",
            "ingress.defaultBackend.port": 8080,
        }))
        self.assertNotIn("rules", ingress["spec"])
        self.assertEqual(ingress["spec"]["defaultBackend"], {
            "service": {"name": "fallback", "port": {"number": 8080}},
        })

    def test_global_ingress_disable_overrides_routes_and_default_backend(self):
        self.assertIsNone(shared_ingress(render({
            "ingress.enabled": False,
            "ingress.defaultBackend.name": "fallback",
            "ingress.defaultBackend.port": 8080,
        })))

    def test_subchart_ingress_remains_independent(self):
        documents = render({
            "global.otelcollector.ingress.enabled": False,
            "otelcollector.ingress.enabled": True,
            "otelcollector.ingress.hosts[0].host": "private-otel.example.com",
            "otelcollector.ingress.hosts[0].paths[0].path": "/",
            "otelcollector.ingress.hosts[0].paths[0].pathType": "Prefix",
        })
        self.assertNotIn("otelcollector.wundergraph.local", hosts(shared_ingress(documents)))
        collector_ingress = next(
            doc for doc in documents
            if doc["kind"] == "Ingress" and doc["metadata"]["name"] == "cosmo-otelcollector"
        )
        self.assertEqual(hosts(collector_ingress), {"private-otel.example.com"})


if __name__ == "__main__":
    unittest.main()

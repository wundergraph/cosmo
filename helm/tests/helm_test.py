"""Shared chart rendering and optional Kubernetes server validation."""

import os
from pathlib import Path
import subprocess
import unittest

import yaml


HELM_DIR = Path(__file__).resolve().parents[1]


class HelmTestCase(unittest.TestCase):
    """Set chart and, optionally, cluster_values in each chart's test class."""

    chart: Path
    release = "cosmo"
    namespace = "default"
    cluster_values: tuple[Path, ...] = ()

    def render(self, overrides=None, *, values_files=()):
        """Render YAML documents; overrides use Helm's dotted --set keys."""
        command = [
            "helm", "template", self.release, str(self.chart),
            "--namespace", self.namespace,
        ]
        kubeconfig = os.environ.get("HELM_TEST_KUBECONFIG")
        if kubeconfig:
            for path in self.cluster_values:
                command.extend(["--values", str(path)])
        for path in values_files:
            command.extend(["--values", str(path)])
        for key, value in (overrides or {}).items():
            if isinstance(value, bool):
                value = str(value).lower()
            elif value is None:
                value = "null"
            command.extend(["--set", f"{key}={value}"])

        manifest = self._run(command)
        if kubeconfig:
            self._run(
                [
                    "kubectl", "--kubeconfig", kubeconfig, "--namespace", self.namespace,
                    "apply", "--dry-run=server", "-f", "-",
                ],
                input=manifest,
            )
        return [document for document in yaml.safe_load_all(manifest) if document]

    def _run(self, command, *, input=None):
        result = subprocess.run(command, input=input, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        return result.stdout

# TEMPORARY: This script is a stopgap for generating split manifest directories
# (mapper.json + latest.json + feature-flags/*.json) from a single router
# execution config. The same capability is being added to the `wgc` CLI; once
# `wgc` can produce local manifests this file should be deleted and any callers
# (Makefile targets, integration test setup) should be migrated to `wgc`.
import argparse
import json
import os.path

from pathlib import Path
import shutil
from typing import Any


class ManifestBuilder:
    """Splits a single router execution config into the manifest layout the
    router expects when `WithManifestConfig` is used:

        <output_dir>/
            mapper.json                       # { "": <base version>, "<ff name>": <ff version>, ... }
            latest.json                       # base graph execution config
            feature-flags/<ff name>.json      # one execution config per feature flag

    The router watches mapper.json and re-reads latest.json / feature-flags/*
    whenever the mapper's mtime changes.
    """

    def __init__(self, router_config: str, output_dir: str, cleanup: bool):
        # Resolve to absolute paths so error messages and downstream os.path
        # operations don't depend on the caller's cwd.
        self.router_config = os.path.abspath(router_config)
        self.output_dir = os.path.abspath(output_dir)
        self.cleanup = cleanup

        # State populated by `destructure_router_config` and consumed by
        # `build_manifest`. Pre-initialised so attribute access is safe even
        # if destructuring fails partway through.
        self.mapper: dict[str, str] = {}             # feature-flag name -> version hash ("" is the base graph)
        self.full_config: dict[str, Any] = {}        # the original combined router config as loaded from disk
        self.latest_config: dict[str, Any] = {}      # the subset of full_config that becomes latest.json
        self.feature_flags: dict[str, Any] = {}      # per-feature-flag execution configs, keyed by flag name

        # Validation may exit the process — do it before we try to read the
        # router config so we fail fast with a clear message.
        try:
            self.validate()
        except Exception as e:
            print(f"Error: {e}")
            exit(1)

        self.destructure_router_config()

    def validate(self):
        """Ensure the input file exists and the output directory is usable.

        With `cleanup=True` the output directory is wiped first so stale
        feature-flag files from a previous run don't linger.
        """
        if not os.path.exists(self.router_config):
            raise FileNotFoundError(
                f"Router config file not found: {self.router_config}"
            )

        # When cleanup is requested, remove the directory wholesale so we
        # don't have to enumerate and delete individual stale files (e.g.
        # feature-flags that no longer exist in the new config).
        if self.cleanup:
            if os.path.exists(self.output_dir):
                shutil.rmtree(self.output_dir)
        if not os.path.exists(self.output_dir):
            os.makedirs(self.output_dir)
        if not os.path.isdir(self.output_dir):
            raise NotADirectoryError(
                f"Output directory is not a directory: {self.output_dir}"
            )

    def destructure_router_config(self):
        """Load the combined router config and split it into the in-memory
        pieces that `build_manifest` will later write out.

        The combined config carries the base graph alongside every feature
        flag in a single `featureFlagConfigs.configByFeatureFlagName` map.
        We pull each feature flag into its own dict and record its version
        under its name in the mapper. The base graph is recorded under the
        empty-string key — that's the convention the router expects.
        """
        with open(self.router_config, "r") as f:
            self.full_config = json.load(f)

            # latest.json is the base graph only — strip the feature flag
            # bundle out so it's not duplicated on disk.
            self.latest_config = {
                "version": self.full_config["version"],
                "engineConfig": self.full_config["engineConfig"],
                "subgraphs": self.full_config["subgraphs"],
                "compatibilityVersion": self.full_config["compatibilityVersion"],
            }

            # Base graph entry in the mapper uses the empty-string key.
            self.mapper[""] = self.latest_config["version"]

            # Each feature flag becomes its own entry in the mapper and its
            # own file under feature-flags/. The mapper value is the flag's
            # version hash, which is also what the router reports back via
            # the X-Router-Config-Version header when that flag is active.
            for feature_flag_name, feature_flag_config in self.full_config[
                "featureFlagConfigs"
            ]["configByFeatureFlagName"].items():
                self.mapper[feature_flag_name] = feature_flag_config["version"]
                self.feature_flags[feature_flag_name] = {
                    "version": feature_flag_config["version"],
                    "engineConfig": feature_flag_config["engineConfig"],
                    "subgraphs": feature_flag_config["subgraphs"],
                }

    def build_manifest(self):
        """Write the in-memory pieces produced by `destructure_router_config`
        to disk in the layout the router watches.

        Order is intentional: mapper.json is written last because it is the
        file the router stats for mtime changes. Writing it after latest.json
        and the feature-flag configs ensures the watcher never observes a
        mapper that references files which are not yet on disk (or are stale).
        Callers that want fully atomic swaps should write to a sibling
        directory and rename — this script is for one-shot local generation
        only.
        """
        # latest.json — the base graph's execution config.
        latest_path = os.path.join(self.output_dir, "latest.json")
        self.write_content_to_file(self.latest_config, Path(latest_path))

        # feature-flags/ must exist even when there are no feature flags;
        # the router stats this directory during config assembly.
        feature_flag_path = os.path.join(self.output_dir, "feature-flags")
        if not os.path.exists(feature_flag_path):
            os.makedirs(feature_flag_path)

        # One file per feature flag, named after the flag itself so the
        # router can resolve `<name>.json` directly from the mapper key.
        for feature_flag_name, feature_flag_config in self.feature_flags.items():
            feature_flag_config_path = os.path.join(feature_flag_path, f"{feature_flag_name}.json")
            self.write_content_to_file(feature_flag_config, Path(feature_flag_config_path))

        # mapper.json — the file the manifest watcher stats for mtime
        # changes. Written last so its mtime bump only occurs after the
        # configs it references are already on disk.
        mapper_path = os.path.join(self.output_dir, "mapper.json")
        self.write_content_to_file(self.mapper, Path(mapper_path))

    def write_content_to_file(self, content: dict[str, Any], path: Path):
        # Pretty-printed JSON so the generated files are diff-friendly in
        # source control / when checked into testdata.
        path.write_text(json.dumps(content, indent=2), encoding="utf-8")


def main():
    """CLI entry point. Parses arguments, builds the manifest, and exits
    non-zero on any failure so callers (Makefile targets, CI) can detect it.
    """
    parser = argparse.ArgumentParser(description="Build the manifest for the demo")
    parser.add_argument(
        "--router-config", type=str, required=True, help="The path to the router config"
    )
    parser.add_argument(
        "--out", type=str, required=True, help="The path to the output directory"
    )
    parser.add_argument(
        "--cleanup", action="store_true", help="Cleanup the output directory before building the manifest"
    )

    args = parser.parse_args()
    builder = ManifestBuilder(args.router_config, args.out, args.cleanup)

    try:
        builder.build_manifest()
    except Exception as e:
        print(f"Error: {e}")
        exit(1)


if __name__ == "__main__":
    main()

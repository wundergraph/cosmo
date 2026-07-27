# Entity Intelligence demo bootstrap: incident notes

Background on workarounds in `scripts/ei-demo/*.sh` that are too long for an
inline comment. Referenced from the scripts as "see RUNBOOK.md".

## Codegen skipped in bootstrap

`bootstrap-entity-intelligence-demo.sh` mirrors cosmo's `dev-setup` target
minus `pnpm generate` / `make generate-go`. Those regenerate protobuf/connect
code from `.proto` files, needed only when a `.proto` file actually changed,
and the generated output (`connect/src/**/*_pb.ts`, `.pb.go` files) is already
committed. Running codegen anyway crashed on a genuinely clean machine: Node
25's experimental global `localStorage` breaks `@typescript/vfs`, a
transitive codegen dependency. Confirmed via an actual fresh-clone run, not a
guess.

## node-path.sh: why Node 25 is rejected for the control plane

Node 25's experimental global `localStorage` and a missing native prebuild
(`@sentry-internal/node-native-stacktrace`) break `pnpm dev` in `controlplane`
directly, a separate failure from the codegen one above. `node_bin_ok` only
accepts LTS majors 20, 22, 24, falling back to the newest nvm-installed
v22/v24 if the system `node` is unsuitable, and fails loudly with install
instructions if neither exists.

## Plugin build: flaky and can hang silently

The `projects`/`courses` plugin subgraphs aren't part of the EI demo (the
demo graph only federates the plain HTTP subgraphs), but their build is the
most environment-sensitive step: the CLI downloads its own Go toolchain into
`~/Library/Application Support/cosmo/proto-tools`, which goes stale on
long-lived dev machines. That can surface as a fast failure, or as a silent
hang with no output and almost no CPU use, observed directly: a stuck
"router plugin build" process sitting for 15+ minutes. A plain `|| continue`
only catches the fast-failure case, hence the hard `timeout` wrapper too.

## Hub bring-up

Hub brokers every user login through its own keycloak (port 8090), whose
`cosmo` realm holds the identities hub links users to (see hub's
`link-cosmo-idp`). The control plane must validate tokens against that
keycloak, and the seed step must register the demo user with the same
identity, or hub's "import from Cosmo" can't list the wundergraph
organization for selection. Seeding directly against 8090 isn't an option:
the seed's group-creation calls fail against hub's keycloak version, so
`align-hub-identity.sh` reconciles the resulting id mismatch afterward.

## cosmo's keycloak: eventual-consistency races

A TCP-open port isn't enough for keycloak readiness: it accepts connections
while still importing realms on a fresh volume, and admin calls 500 during
that window. An HTTP realm-endpoint check isn't enough either, it answers
while keycloak is still migrating its own database, and can even crash
mid-migration and restart. A single successful admin login isn't reliable
either: this Keycloak build can intermittently answer `user_not_found` on an
individual request while still stabilizing, even after an earlier login
already succeeded, confirmed directly, migrate/seed later in the same run
hit that exact error mid-flow despite the readiness probe having reported
ready. Hence `wait_for_cosmo_keycloak` requiring several consecutive
successful admin logins before trusting readiness.

The instability isn't confined to the readiness probe, it resurfaces at
unpredictable points further into the flow too (group creation, role
creation, admin login), each a symptom of the same underlying "keycloak
hasn't actually finished stabilizing" problem. Treating each symptom as its
own bug was the wrong shape of fix. Migrate and seed are one unit: if either
fails, for any reason, the pair retries from scratch after the same
known-good recovery (drop and recreate cosmo's keycloak database, restart,
wait for it to be stable again).

Identity alignment (`align-hub-identity.sh`) is retried separately, without
that recovery: it only ever talks to hub's own keycloak and cosmo's Postgres
directly, never cosmo's keycloak, so a failure there was never actually a
symptom of the instability above. Bundling it into the same retry-with-wipe
unit used to mean a transient hub-side hiccup got misdiagnosed as cosmo's
keycloak being unstable and triggered an unnecessary database wipe.

`seed.ts`'s own group+role creation (`Keycloak.ts`'s `seedGroup`) is not
reliably atomic against a fresh Keycloak: creating the top-level group and
immediately creating its child groups can 404 ("Could not find group by id")
even though the group really was just created, confirmed by re-querying the
group right after the failure and finding it present. A failed attempt also
leaves orphaned `wundergraph:*` roles behind, which make the next plain retry
fail differently (409 "role already exists"). So a bare retry isn't safe; the
group and every `wundergraph:*` role must be swept before each attempt.

A prior seed attempt's `Promise.all` of concurrent role-creation requests can
still be in flight server-side even after that attempt's own process has
exited, deleting during cleanup can race one of those still-landing
creates and leave it behind a moment later. Observed directly: a different
single `wundergraph:<role>` 409 on every retry, never the same one twice, on
an otherwise verified-empty Keycloak and Postgres. `cleanup_stray_wundergraph_kc_state`
polls until a fresh read genuinely shows zero, instead of trusting one
snapshot.

## Shared cosmo dev state: recovery and cleanup must not destroy it

`cosmo-dev-keycloak-1`, `cosmo-dev-postgres-1`, and the `foo@wundergraph.com`
identity are general-purpose cosmo dev resources this demo happens to reuse,
not created fresh for it, a developer doing ordinary `pnpm seed` local dev
work already has all three. Recovery and cleanup logic that assumes "this
demo owns everything it finds here" can destroy that unrelated work.

`recover_cosmo_keycloak` drops and recreates keycloak's whole database, every
realm, to resolve the instability above, checked directly against the
running instance: creating a realm named `master`/`cosmo` are the only two
present on a stock cosmo dev setup. Before dropping, it now looks for a realm
besides those two and refuses if one exists, since a wipe would take it out
too. If the check itself can't get an answer (the same instability being
recovered from), it proceeds anyway, there's no way to confirm safety in
that case, and refusing forever would defeat the recovery. Verified directly:
created a real foreign realm, confirmed the function refuses and leaves both
keycloak and the realm untouched, then confirmed a clean instance still
recovers normally.

`cleanup_stray_wundergraph_kc_state` sweeps a `wundergraph` Keycloak group
and its `wundergraph:*` roles before every seed retry (only runs when
`USER_COUNT` is 0, so Postgres itself can't be used to tell "this run's own
leftover" apart from "a real org whose Postgres row was lost to an unrelated
reset"). `snapshot_wundergraph_kc_group_baseline`, called once when Keycloak
is first confirmed healthy (and again after any `recover_cosmo_keycloak`,
since that wipes the group along with everything else), records whether a
group already existed at that point. Cleanup now only removes a group (and
its roles) that appeared after the baseline was taken, anything that
predates this run is left alone. Verified directly: a group created before
the baseline snapshot survives a cleanup call; a group created after it is
still swept, matching the original behavior for genuinely orphaned state.

Both this and `recover_cosmo_keycloak`'s realm check need a Keycloak admin
token, and a single fetch attempt can transiently fail even right after
`wait_for_cosmo_keycloak` reports ready (the same eventual-consistency lag
documented above), a failed fetch right at the baseline snapshot would read
as "no group existed" even when one did. `kc_admin_token` (shared by every
caller that needs a token, including the group lookup itself via
`find_wundergraph_kc_group_id`) retries 3 times before giving up, narrowing
that window without closing it entirely, it's still a single point-in-time
snapshot, so a group created or recreated on this shared instance between
the snapshot and a later cleanup call is indistinguishable from this run's
own debris. Checked whether Keycloak's group object exposes a creation
timestamp that would let this be verified instead of assumed (it does for
users, via `createdTimestamp`), it doesn't; a live `GET` on a real group
was read in full and has no such field. Accepted as a residual,
low-probability gap: closing it without a server-side timestamp to compare
against would mean tracking every id a group has ever had, not just the
current one, for a race that needs two independent processes to touch the
same shared instance within the same few-second window.

A related, more consequential case is closed, not just accepted: a group
that genuinely predates this run blocks `seed.ts` forever (it silently
no-ops whenever the group already exists, confirmed by reading
`controlplane/src/bin/seed.ts` directly), cleanup correctly refuses to
delete it, but retrying 5 times can't fix a deterministic block, and the
5th failure used to fall through to `recover_cosmo_keycloak`, which would
still destroy that same "protected" group (its own check only looked at
realms, not groups within the cosmo realm). Two changes close this
end-to-end: `cleanup_stray_wundergraph_kc_state` returns 2 (distinct from
0) specifically for this case, and `run_migrate_and_seed` checks for that
return and exits immediately with a direct explanation instead of burning
the remaining attempts. `recover_cosmo_keycloak` also independently refuses
whenever `WUNDERGRAPH_KC_GROUP_BASELINE_ID` is set, as defense in depth, so
the destructive path can't be reached even from a future, different caller.
Verified directly: a real pre-existing group makes `cleanup_stray_
wundergraph_kc_state` return 2 and `recover_cosmo_keycloak` refuse without
touching keycloak, in both cases confirmed by the container never
restarting and the group still present afterward. When that refusal is a
false positive (the group is just stale debris from an earlier failed run,
the common case on a personal machine), re-running with
`EI_DEMO_FORCE_KC_CLEANUP=1` authorizes the override:
`force_delete_baseline_wundergraph_kc_group` deletes the baseline group
through the admin API and clears `WUNDERGRAPH_KC_GROUP_BASELINE_ID`, so both
guards then see a clean slate. Deliberately opt-in, not the default, for the
same reason the guards exist: on a shared cosmo keycloak that group can be
real state. A raw SQL delete is not an equivalent manual workaround here,
this keycloak build can bind to a different postgres than
`cosmo-dev-postgres-1` when another stack (e.g. hub) shares the docker
network and both expose a `postgres` service, so a delete against the
obvious container can silently hit an empty database while the real row
lives elsewhere, verified directly. The admin API always targets whatever
database keycloak actually bound to.

`align-hub-identity.sh` remaps the control plane's primary key for
`foo@wundergraph.com` from cosmo-keycloak's id to hub-keycloak's id (see
below) by deleting the old row and repointing every FK, if that email
already had a real, established identity from unrelated cosmo dev work, this
would delete it and break that developer's normal cosmo login (its keycloak
id would no longer match any row). The remap now refuses unless a marker
file (`/tmp/ei-demo-fresh-identity-<user id>`) exists for that exact id, or
`EI_DEMO_ALLOW_IDENTITY_REMAP=1` is set. `bootstrap-entity-intelligence-
demo.sh` creates that marker only once it has directly confirmed (not
`USER_COUNT`'s own `0`-on-query-failure fallback, which would have falsely
looked like "fresh" on a transient docker/postgres hiccup) that this run's
own seed step created the row. A file, not an env var: this script is
documented to run standalone later, in a fresh shell, once hub is up, an
exported var from the bootstrap's own process would never reach it, which
is exactly the regression an earlier, env-var-only version of this guard
had (confirmed directly: a marker written in one process is visible to a
plain `bash -c` subprocess; an exported var is not). Both scripts remove
the marker once alignment succeeds, so it doesn't linger for a future,
unrelated mismatch on the same id. The already-aligned no-op path (ids
already match) is unaffected either way.

`router/.env`'s `GRAPH_API_TOKEN` replacement (see the router token section
below) now backs up the file to a fixed path before overwriting an existing
token, since that file isn't exclusive to this demo either, a developer
could have their own token there for other local router work. Fixed, not
timestamped: a timestamp collision (or any other transient copy failure)
used to fail silently; now a failed backup prints a warning instead of
silently proceeding, and there's nothing to accumulate across runs.

`run_with_timeout`'s fallback path (no `timeout`/`gtimeout` on stock macOS)
now kills the whole process group it backgrounded, not just the top pid,
since the earlier single-pid kill left grandchildren behind exactly like the
"router plugin build" hang it exists to catch (see above), which is why a
broader `pkill -f "router plugin build"` was also needed as a backstop.
Group-kill only applies under job control (`set -m`, true for this
function's only caller); without it, this falls back to the original
single-pid kill to avoid signalling the calling script's own process group.
Verified directly: a backgrounded process that itself spawns a child no
longer survives the timeout.

## Proposals: gated behind billing plan and namespace flag, not set by seed

Hub's branch -> proposal -> registry -> feature-flag-rollout workflow needs
two things `make seed` does not set: an `organization_billing.plan` for
`wundergraph` whose entitlements include the `proposals` feature
(`controlplane/src/bin/billing.json` confirms `enterprise` and `scale@1`
both include it), and `namespace_config.enable_proposals` true for its
`default` namespace. Without both, hub's "Create on registry" call reaches
the control plane but fails; the real cause never reaches hub, since
`catchRest` in hub's own RPC layer logs it and returns a bare
`InternalServerError` to the client. Confirmed directly: before the fix,
`organization_billing.plan` was empty and `namespace_config.enable_proposals`
was false for `wundergraph`/`default`; after setting both, the same click
through hub succeeded end to end (checks ran, the proposal was approved, and
the feature-flag rollout became available), verified live in the browser
with real traffic afterward showing a populated cache hit rate.

Both rows are written directly via `docker exec ... psql`, not through
`wgc`/the platform API, for two different reasons. `organization_billing`
has no API or CLI surface at all, it is billing state, normally driven by a
real billing provider in production, not something a graph admin sets
through tooling. `namespace_config.enable_proposals` does have a real RPC,
`enableProposalsForNamespace` (`controlplane/src/core/bufservices/proposal/
enableProposalsForNamespace.ts`), but it is not wired into the `wgc` CLI
(confirmed by grepping `cli/src` for it, no matches) and it still requires
the org's `proposals` feature to already be entitled, i.e. the billing row
above, before it will do anything. Since one of the two writes has no API
path either way, both are done together with plain SQL, matching the
equivalent step already present in hub's own `bootstrap-stack.sh`.

## Hub's LIVEBLOCKS_SECRET_KEY: required, not something this script can set for you

`apps/backend/src/config.ts` declares `LIVEBLOCKS_SECRET_KEY` via
`Config.redacted(...)` with no `.pipe(Config.withDefault(...))` or
`.pipe(Config.option)`, Effect-TS's way of marking a config value mandatory.
`apps/backend/.env.example` ships it blank, so a hub checkout freshly set up
by `make all` fails to boot at all until a real key is set (confirmed by
reading `apps/backend/src/liveblocks.ts:22-23`, which passes it straight
into the Liveblocks Node client constructor, and hub's own README, which
documents creating a liveblocks.io account as a manual setup step).

This can't be auto-generated the way the EI feature flag or the proposals
DB rows are, it is a real third-party account secret. The bootstrap accepts
it as `HUB_LIVEBLOCKS_SECRET_KEY` (env var, wired through `make ei-demo`
the same way as `HUB_DIR`) and writes it into `$HUB_DIR/apps/backend/.env`
right after `make all` creates that file, before hub's dev server starts.
If it's not provided and the file doesn't already have a real value, the
bootstrap prints a warning with the liveblocks.io signup link instead of
failing silently at hub's own boot with a much less obvious error.

## Seed step: KC_API_URL and the "already exists" trap

`KC_API_URL`/`KC_FRONTEND_URL` used to be written into `controlplane/.env`
directly (`sed`, flipped between cosmo's keycloak for seed and hub's for
token validation). A run killed mid-flip left the file in that flipped
state, and a naive retry then ran seed against hub's keycloak instead of
cosmo's own, silently "finding" hub's fixture user there (a fixed,
well-known id) and skipping the real seed every time, since neither the
user nor group check would see anything to clean up on cosmo's own
keycloak. Confirmed by hitting this exact failure live: seed kept
reporting hub's fixture user as "already existing", five retries straight,
on an otherwise-empty cosmo database and keycloak.

Now passed as env vars to the specific commands that need them (`make
seed`, and wherever the control plane's own server gets started) instead
of written to the file at all: dotenv never overrides an already-set
process env var, so this reaches the right process without ever touching
`controlplane/.env`, and the "killed mid-flip" failure mode above can no
longer happen, since nothing is ever left half-written.

Cosmo's own keycloak realm import ships no groups at all (verified: its
`realm.json` has no `"groups"` key), a `wundergraph` group found there is
leftover state from a prior run of this same seed step, and `seed.ts` exits
early without writing any database rows when it sees a group with that name
already exists.

A `make seed` exit of 0 is not proof anything was actually seeded, `seed.ts`
also exits 0 on that no-op skip. A genuinely fresh Keycloak has its own
eventual-consistency race too: a realm-import-then-immediately-query can
briefly report a user existing that isn't really there. Observed directly:
seed printed "User already exists" with the demo user's usual id, immediately
followed by both Keycloak's user list and the DB being genuinely empty.

## Router token: reused only when still valid for the current graph

A token from a run that got killed partway through (written to
`router/.env` but before the router ever successfully started with it) can
be stale. Observed directly: the router failed with "failed to get initial
execution config: config not found" using a token from an earlier
interrupted run, and a freshly minted token against the exact same graph
started it immediately with no other change.

`wgc router token list` only returns metadata (name, creation date), never
the token itself, so there's no server-side way to ask "is this specific
token still good." Instead, the existing token's own JWT payload is decoded
(unsigned, just base64, no server round trip needed) and its
`federated_graph_id` claim is compared against the graph's actual current
id. A match means the token still points at a live graph and is reused; a
mismatch (typically a stale token surviving a DB reset) or a missing/
placeholder token falls back to minting a fresh one. A fixed token name
would collide with a prior dead run's orphaned token (tokens are shown once
and can't be re-fetched), hence a unique name per mint.

The current graph id itself comes from a fresh `wgc federated-graph list
--json` call, not the `EXISTING_GRAPHS` fetched earlier in the same script:
that one runs before graph creation and is empty on the fresh-clone path.
A raw SQL query against the control plane's own `federated_graphs`/
`targets` tables was considered and rejected: those are internal,
unversioned implementation details, not a supported interface, and a
future schema migration would break the check silently.

## Hub schema import: playwright via npx

Hub has no password-login API, so importing the demo schema needs a real,
if headless, browser session. Playwright isn't a committed dependency of hub
(kept out of its `package.json`/lockfile on purpose), so it's fetched on
demand via `npx` into npm's own npx cache. `tsx` needs `NODE_PATH` pointing
at that cache to resolve `import { chromium } from 'playwright'` from a real
file on disk, npx's `-p` flag only puts a package's own binaries on `PATH`,
it does not wire up module resolution for a script that isn't itself the
invoked package (confirmed empirically: a plain `npx -p playwright node
script.ts` call fails to resolve playwright at all). Hence the two-step
dance: first ensure the packages are npx-cached, then discover exactly where
npx put them and export that as `NODE_PATH` for the real run.

## router/demo.config.yaml: why EI config is layered in, not appended

An EI-specific `entity_caching` block was committed directly into the
tracked `router/demo.config.yaml` once (`4305a87ea`) and reverted 15 minutes
later with no recorded reason (`c3f267d52`). An early version of this
bootstrap re-added the same block locally by appending to that same tracked
file on every run, which meant `router/demo.config.yaml` and `router/go.mod`
were permanently dirty in `git status` for anyone who ran it, one accidental
`git add -A` away from silently redoing the reverted decision in shared
history. `setup-router-config.sh` now writes EI-only config into a separate,
gitignored `router/demo.ei-demo.config.yaml`, merged in via the router's own
multi-file `CONFIG_PATH` support (`router/cmd/main.go`), and wires the
graphql-go-tools sibling checkout in via a gitignored `go.work` instead of
editing `router/go.mod`'s `replace` directive. Both tracked files stay
clean.

## go.work must live inside router/, not the repo root

First attempt put `go.work` at the repo root with `use (./router
../graphql-go-tools/v2)`. That broke `demo` and `graphqlmetrics`, separate
Go modules elsewhere in this monorepo, with "no required module provides
package X" errors on their own `go run`/`go build` (confirmed directly:
`make ei-demo` failed inside `cmd/all/main.go` and `graphqlmetrics`'s `make
dev`). Cause: Go auto-discovers `go.work` by walking up from the working
directory through every parent directory, with no opt-out short of setting
`GOWORK=off`. A root-level `go.work` is a parent of every module in the
repo, so it activates workspace mode for `demo/`, `graphqlmetrics/`,
`router-tests/`, and anything else too, and workspace mode only resolves
modules listed in `use`, so anything not listed breaks. Moving `go.work`
into `router/` scopes its effect to builds run from inside `router/`
(sibling directories like `demo/` never walk through `router/` on their way
up), which is exactly what this needs.

## start.sh's write_pidfile silently aborted every non-final call

`write_pidfile` originally built the pidfile with a `[ -n "$var" ] && echo
"$var"` chain, one per pid, inside a `{ ... } > "$PID_FILE"` group. Whichever
pid variable is still unset when the chain reaches it makes that one check
false, harmless on its own, except when it's the LAST statement in the
group: the group's (and therefore the function's) overall exit status
becomes that last check's status, and a bare `write_pidfile` call under
`set -e` aborts the whole script on a non-zero return. Since `router_pid` is
always the last variable and stays empty until the very final call, every
call except the last one silently killed `start.sh`, reproduced directly in
isolation, outside the real script, to confirm before fixing. Rewritten as
an unconditional `printf` piped through `grep -v '^$'` to drop empty lines,
which can't produce this failure mode.

Later rewritten again to re-read and prune `PID_FILE` live on every call
instead of from a snapshot taken once, so a concurrent second invocation's
pids don't get silently dropped. That rewrite reintroduced the same class
of bug in a new spot: the live re-read is itself a bare command-substitution
assignment, and if the file's last line happens to be a dead pid, the
`while` loop's exit status propagates through and aborts under `set -e`
again, exactly like the original bug, just one level deeper. Fixed the same
way, with `|| true` on that assignment, and reproduced both the break and
the fix directly before shipping.

Removing the file's original wipe-on-start also opened a separate gap: if
`start.sh` runs for minutes (a full bootstrap on a first-time machine)
before `write_pidfile` gets called even once, a dead pid sitting in the
file that whole time is a live target for the OS to recycle onto an
unrelated process, which the alive-pid check can't distinguish from a
pid this script actually owns. `start.sh` now prunes once, up front,
before bootstrap runs, closing that window; `write_pidfile`'s own live
re-read still handles anything a concurrent invocation appends later.

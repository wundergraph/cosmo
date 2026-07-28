# Testing `make ei-demo` on a machine you already develop on

The demo writes to your local cosmo and hub databases, switches branches in the
sibling checkouts, and edits a few `.env` files. None of it touches anything
remote, but back up first so you can get back to where you were.

For what the demo actually does, see [README.md](README.md). For why a
particular guard exists, see [RUNBOOK.md](RUNBOOK.md).

## 1. Back up

Both dumps include that stack's Keycloak database, which is the part that is
annoying to rebuild by hand.

```bash
docker exec cosmo-dev-postgres-1 pg_dumpall -U postgres > ~/cosmo-pg-backup.sql
docker exec hub-dev-postgres-1 pg_dumpall -U postgres > ~/hub-pg-backup.sql
```

From your cosmo checkout, the `.env` files the demo rewrites:

```bash
cp router/.env router/.env.bak
cp ../hub/apps/backend/.env ../hub/apps/backend/.env.bak
cp ../hub/apps/frontend/.env ../hub/apps/frontend/.env.bak
```

Note your current branches so you can return to them, and commit or stash any
work in all three repos. The demo refuses to switch a checkout with uncommitted
changes, so dirty work is never lost, but the run stops until you deal with it.

```bash
git -C . branch --show-current
git -C ../hub branch --show-current
git -C ../graphql-go-tools branch --show-current
```

## 2. Layout

The three repos are expected to be siblings:

```
<parent>/cosmo
<parent>/hub                  # override with HUB_DIR=
<parent>/graphql-go-tools     # override with GGT_DIR=
```

Anything missing is cloned for you (hub over SSH, so you need a GitHub SSH key).
The demo checks out its own branches: cosmo
`milinda/entity-caching-3-feature-flag-rollout-router`, hub
`milinda/entity-intelligence-1`, graphql-go-tools `milinda/entity-intelligence`.
Put cosmo on its branch and pull before starting, the other two are handled.

## 3. Free the ports

A control plane still running from ordinary cosmo work is the single most
common cause of a failed demo: it validates tokens against the wrong Keycloak,
so hub ends up with an empty organization list. Stop anything here that is not
part of this demo.

```bash
lsof -nP -iTCP:3001 -sTCP:LISTEN   # control plane
lsof -nP -iTCP:3301 -sTCP:LISTEN   # hub frontend
lsof -nP -iTCP:3305 -sTCP:LISTEN   # hub backend
```

## 4. Run

`LIVEBLOCKS_SECRET_KEY` is a real liveblocks.io account secret that hub's
backend will not boot without, ask Iliya or create a free account. Installing
k6 first (`brew install k6`) is optional and lets the demo generate the traffic
that fills the Entity Intelligence heatmap.

```bash
make ei-demo HUB_LIVEBLOCKS_SECRET_KEY=sk_...
```

Add `HUB_DIR=` / `GGT_DIR=` if your checkouts are not siblings of cosmo.

Expect 30 to 45 minutes. Around the middle you should see:

```
==> Verifying the demo identity resolves to the 'wundergraph' org
```

That step is the one most worth testing. It walks the whole login chain and, if
any link is broken, stops there naming the cause and the command that fixes it,
rather than failing much later in the browser step with a bare timeout.

When it finishes, log in to <http://localhost:3301> as `foo@wundergraph.com`
with the password `wunder@123`, open the `cosmo-demo` graph and click the
sparkles icon in the canvas control panel. Entity Intelligence is a route, so
<http://localhost:3301/wundergraph/graph/cosmo-demo/intelligence> works too.
An empty heatmap there means the traffic step did not run, check for `k6`.

## 5. If it fails

Send the error message, it should say what broke on its own. If it died at the
schema import, also send `/tmp/import-cosmo-schema-failure.png`.

To check the login chain on its own at any time, without a full run:

```bash
bash -c 'source scripts/ei-demo/keycloak.sh && source scripts/ei-demo/lib.sh && verify_demo_identity_chain'
```

One error deserves a pause rather than the obvious workaround. If it says
`foo@wundergraph.com` already existed in the control plane database and suggests
`EI_DEMO_ALLOW_IDENTITY_REMAP=1`, ask first. That guard is there because the
demo would otherwise rewrite an identity you may use for normal cosmo work.

## 6. Getting back afterwards

Through the containers, the same way the backup was taken, so this needs no
local `psql` install and no password:

```bash
docker exec -i cosmo-dev-postgres-1 psql -U postgres < ~/cosmo-pg-backup.sql
docker exec -i hub-dev-postgres-1 psql -U postgres < ~/hub-pg-backup.sql
```

Then restore the `.env.bak` files and check the three repos back out onto the
branches you noted in step 1.

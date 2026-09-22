# Complete, incremental RC releases

The historical workflow path `.github/workflows/release-control-plane.yml` now
publishes a **complete Relay RC**, not a Control-only patch. Its display name is
`Release incremental RC`. Stable releases still use `release.yml`, which excludes
RC tags.

```sh
git tag v0.2.8-rc.1
git push origin v0.2.8-rc.1
# After fixes:
git tag v0.2.8-rc.2
git push origin v0.2.8-rc.2
```

## No stable-release dependency

RC1 builds all eight first-party images for amd64 and arm64:

- tali-control (Control, Worker, runtime bridge)
- tali-openshell-runner
- tali-expert-agent-runtime
- tali-litellm
- demo-test
- tali-nemoclaw-sandbox
- tali-nemoclaw-hermes-sandbox
- tali-nemoclaw-deepagents-sandbox

Every image and the Relay Chart uses the current RC version, for example
`0.2.8-rc.1`. Neither `0.2.7` nor a not-yet-published stable `0.2.8` is required.
Third-party dependencies retain the upstream versions declared in the source.
Control embeds the freshly packaged Relay and patched OpenShell Worker charts.

## Subsequent RCs

The planner queries all published GitHub prereleases and selects the highest
lower RC number in the same series. A failed workflow without a completed GitHub
Release is not a predecessor. The previous `release-manifest.json` records source
commit, all eight image digests, and build/reuse provenance. Its source SHA must
match its tag and be an ancestor of the new commit.

If no predecessor, no compatible manifest, or divergent history exists, perform
a full build. A malformed manifest/tag mismatch fails closed. Missing per-image
metadata causes that image to be rebuilt. An unavailable reuse digest stops the
release rather than silently using a different image.

The planner compares Git paths (including deletions and both sides of renames):

| Changed source | Rebuilt images |
|---|---|
| Control, charts, docs or skill artifacts | Control |
| Runner | Control + Runner |
| Expert Runtime | Control + Expert Runtime + demo-test |
| Example MCP/A2A | Control + demo-test |
| Contracts, lockfiles, Dockerfiles, workflows, scripts, unknown paths | All eight |

Control is always rebuilt because its embedded Chart has the new RC version.
The rules intentionally prefer extra rebuilds over missing a shared dependency.
First-party library dependencies may still be compiled inside an image build;
this does not imply building/publishing another image.

Unchanged images are copied by **manifest digest**, not by a mutable prior tag,
and get the new RC tag. Their content digests must remain identical. Both CPU
architectures and attached attestations remain in the copied multiarch manifest.
BuildKit cache can accelerate rebuilt core images; correctness does not depend on
cache hits. Sandbox builds use the existing full-release builder scripts.

The Actions summary shows the plan. The downloadable `release-manifest.json`
records what was built versus reused, source RC/digest, new reference and digest.
The GitHub prerelease is created only after all images and the Chart are published.
Control's two architecture jobs consume exactly the same prepared Chart files.
Validation runs the full workspace tests/typechecks and Helm/OCP checks even when
only a subset of images needs rebuilding.

## Upgrade

```sh
helm upgrade --install tali-relay \
  oci://ghcr.io/tasklattice/charts/tali-relay \
  --version 0.2.8-rc.2 -n tali --create-namespace -f your-values.yaml
```

Remove stale `images.*.tag` overrides to use the new Chart's version policy. Avoid
blindly using `--reuse-values`, which can preserve old tags. Preserve environment
settings such as `openshift.enabled`; externally managed Worker Secrets still need
updating for configuration changes. Select prereleases explicitly with `--version`.

No stable or `latest` tag is changed by this workflow. The existing stable release
workflow still performs full builds; automatically promoting a validated RC's
same digests to a stable release is not implemented by this RC workflow change.

## Permissions and retries

GitHub Actions needs GHCR package access. Build/publish jobs have package write
permission; only publication has GitHub Release write permission. Actions are
pinned to commit SHAs. RC parsing and Chart packaging remain tag-workflow guarded.

Already published final image/chart versions or GitHub Releases are rejected.
Publishing across GHCR and GitHub is not transactional: a failure may leave some
images or the Chart published. Use a new RC tag after partial publication instead
of silently replacing released content. Failed architecture tags alone can be
rebuilt. This code change does not create, move or push any release tags.

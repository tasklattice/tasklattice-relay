# Control Plane-only RC releases

Push a new immutable tag on the commit to release:

```sh
git tag v0.2.5-rc.1
git push origin v0.2.5-rc.1
# Next fix: v0.2.5-rc.2 (do not move an existing tag).
```

`.github/workflows/release-control-plane.yml` parses the tag into release version
`0.2.5-rc.1`, base image version `0.2.5`, and RC sequence `1`. The existing full
release workflow excludes `v*.*.*-rc.*`. Other prerelease names keep their existing
full-release behavior. RC tags must have canonical numeric versions and a positive
RC sequence (no leading zeros). There is no manual version input or branch build.

## What is built

- Multi-architecture `ghcr.io/<owner>/tali-control:0.2.5-rc.1` (amd64, arm64).
  Control API, UI, Worker and runtime bridge share this image.
- `oci://ghcr.io/<owner>/charts/tali-relay`, version/appVersion `0.2.5-rc.1`.
- The patched OpenShell Worker chart embedded in the Control image.
- A GitHub **pre-release**, titled `Control Plane 0.2.5 RC1`, with the Relay Chart,
  image reference/digest inventory, and upgrade notes.

Runner, Expert Runtime, LiteLLM, demo and all three Sandbox images are reused from
`0.2.5`; no container builds are run for them. The packaged Chart explicitly pins
those image tags rather than inheriting the RC appVersion. Third-party image
versions remain as declared by the chart. No stable image tags or `latest` move.
Base images must already be accessible in the repository owner's GHCR namespace.
Their manifest digests are checked before building and again before publication.

The Docker Control stage compiles contracts and the expert-runtime package as
required dependencies of Control, but no longer runs Runner/demo application
builds. npm workspace installation is still shared. BuildKit caches are best-effort
(tag workflows may not see caches from unrelated refs); cache misses never cause
other product images to be built.

Both architecture jobs consume the **same prepared Chart artifacts**. Validation
includes Control typechecking, targeted provisioning/timeout tests, tag/version
policy tests, Chart linting and OpenShift Helm validation. This is not the full
release test matrix and does not run a live OpenShift deployment.

## Upgrading

```sh
helm upgrade --install tali-relay \
  oci://ghcr.io/tasklattice/charts/tali-relay \
  --version 0.2.5-rc.1 -n tali --create-namespace -f your-values.yaml
```

Remove stale `images.*.tag` overrides from your values if you want the RC Chart's
Control/reused-image version policy. Avoid blindly using `--reuse-values`, which
can retain old image tags. Preserve your environment-specific settings such as
`openshift.enabled` and credentials. Externally managed Worker config Secrets
still need updating when configuration changes.

SemVer sorts `0.2.5-rc.1` **below** stable `0.2.5`. Select the RC explicitly; do not
expect automatic latest-version resolution to upgrade stable 0.2.5 to this RC.
Every RC in this series reuses base `0.2.5` images. If a fix changes shared runtime
contracts incompatibly or needs Runner/Sandbox changes, use a full release instead.

## Permissions and failures

The repository's Actions token needs GHCR package access. Only build/publish jobs
have package write permission, and only the publication job can create a GitHub
Release. Actions are pinned to commit SHAs. The Chart packager only accepts tagged
runs from the approved full-release or Control RC workflow paths.

Already published final image/chart versions or GitHub Releases are rejected at
preflight. Publication across GHCR and GitHub is not transactional: a failure can
leave architecture tags or a final image/chart behind. Prefer a new RC tag after
partial publication; do not delete/repoint a released tag to silently replace it.
No release workflow has been executed by local validation.

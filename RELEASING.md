# Releasing & minting a DOI

This repo publishes a code dashboard (MIT) and a set of open datasets (CC BY 4.0).
The **flagship dataset** is the named project + power-deal ledger
([`data/projects.json`](data/projects.json)). To make a release **citeable**, we cut a
versioned GitHub Release and let Zenodo mint a DOI from it.

This document describes the process. **It does not mint anything by itself** — the DOI is
minted by Zenodo when a GitHub Release is published, and that only works once the maintainer
has done the one-time Zenodo–GitHub connection below.

## Version source of truth

- The **dataset version** is the `version` field in [`data/projects.json`](data/projects.json)
  (currently `0.1.0`).
- [`CHANGELOG.md`](CHANGELOG.md), [`CITATION.cff`](CITATION.cff) (`version:`), and
  [`.zenodo.json`](.zenodo.json) (`version`) must all agree with it.
- The **git tag** for a release is `vX.Y.Z`, matching that version exactly
  (e.g. `v0.1.0`).

## One-time setup (maintainer only)

Do this once; after that every published GitHub Release auto-mints a DOI.

1. Sign in at <https://zenodo.org> with the GitHub account that owns
   `vijay-sachdeva/us-ai-infra`.
2. Go to **Account → GitHub** (<https://zenodo.org/account/settings/github/>) and
   click **Sync** so Zenodo can see the repositories.
3. Toggle the **`vijay-sachdeva/us-ai-infra`** switch **On**. This installs the
   Zenodo webhook on the repo.
   - The webhook fires on the **next** release published *after* the toggle is on.
     Toggling on does **not** retroactively archive past releases.
4. (Optional) Zenodo reads [`.zenodo.json`](.zenodo.json) at release time for the
   deposition metadata (title, description, creators, license, keywords).

## Cutting a release

1. **Pick the version.** Decide the new `X.Y.Z` (semver). Data-only changes that add or
   correct records are typically a minor/patch bump.
2. **Bump the version in lockstep** across:
   - [`data/projects.json`](data/projects.json) — `version`
   - [`CITATION.cff`](CITATION.cff) — `version:` and `date-released:`
   - [`.zenodo.json`](.zenodo.json) — `version`
3. **Update [`CHANGELOG.md`](CHANGELOG.md)**: move the `[Unreleased]` items under a new
   `## [X.Y.Z] - YYYY-MM-DD` heading.
4. **Regenerate derived exports** so CSV/GeoJSON match the JSON:
   ```sh
   python scripts/build_projects_exports.py
   ```
5. **Commit** the version bumps + changelog + regenerated exports, open a PR, and merge
   to `main`.
6. **Tag and push** the release tag on the merged commit:
   ```sh
   git tag -a vX.Y.Z -m "vX.Y.Z"
   git push origin vX.Y.Z
   ```
7. **Publish the GitHub Release**: <https://github.com/vijay-sachdeva/us-ai-infra/releases/new>
   - Choose the `vX.Y.Z` tag.
   - Title: `vX.Y.Z`.
   - Paste the matching `CHANGELOG.md` section as the release notes.
   - Click **Publish release**.
   ```sh
   # ...or, with the GitHub CLI:
   gh release create vX.Y.Z --title "vX.Y.Z" --notes-file - <<'NOTES'
   (paste the CHANGELOG section here)
   NOTES
   ```

## What happens on publish

- If the Zenodo–GitHub webhook is connected (one-time setup above), publishing the
  GitHub Release triggers Zenodo to archive the tagged source snapshot and **mint a DOI**.
- Zenodo issues two DOIs:
  - a **version DOI** unique to `vX.Y.Z`, and
  - a **concept DOI** that always resolves to the latest version (use this one for a
    "cite the dataset" link that should never go stale).
- The DOIs appear on the Zenodo deposition page within a few minutes, and a DOI badge
  becomes available there.

## After the DOI is minted

1. **Add the concept DOI to [`CITATION.cff`](CITATION.cff)** as a top-level `doi:` field
   (see the exact line in the delivery note / below).
2. **Add the DOI badge + link to [`README.md`](README.md)** near the top, e.g.:
   ```md
   [![DOI](https://zenodo.org/badge/DOI/10.5281/zenodo.XXXXXXX.svg)](https://doi.org/10.5281/zenodo.XXXXXXX)
   ```
   (Use the **concept** DOI so the badge always points at the latest release.)
3. Commit those two edits (`docs: add Zenodo DOI`) and push to `main`.

For subsequent releases, repeat **Cutting a release** — the version DOI changes each time,
the concept DOI in `CITATION.cff` / the README badge stays the same.

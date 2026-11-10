# Running and releasing the Factory

What proves the build path works end to end, how to recover a build that stopped
part way, and what to check before releasing the Factory itself
([#52](https://github.com/puddle-works/puddleworks-factory/issues/52)).

## What proves the path

- `extensions/models/end_to_end_test.ts` runs the whole path on one model
  instance against a disposable app checkout, with swamp faked: an approved spec
  is rendered, implemented, checked, reviewed and recorded as published, and
  each record is read back by a later run. It also covers a change after the
  review, a missing or failed quality factor, an acceptance criterion with no
  test or a failing one, a missing review, the Factory's own checkout, another
  repo, a changed spec and a render interrupted before its record.
- `docs/stagecraft/factory-build.yaml` holds the saved scenarios for stage
  order, skipped stages, loop limits and approvals given, declined, missing and
  voided.
- `.github/scripts/sandbox-dry-run.sh` runs the real swamp CLI in a temporary
  directory: `render` into a throwaway app checkout, a changed spec refused with
  no file changed, the draft's own tests and Stagecraft's `validate`. CI runs it
  on every PR. Run it yourself from the Factory checkout:

```bash
.github/scripts/sandbox-dry-run.sh
```

It ends with `sandbox dry run: ok`, and leaves the Factory checkout as it was.

## Recovering a build

Every refusal below writes no file and records nothing, so the fix is to correct
the input and run the same step again.

- **render was interrupted after writing its files.** No draft is recorded, so
  later steps refuse. Run `render` again with `--input overwrite=true`.
- **render says the spec has changed since it was approved.** The spec file is
  not the one the person approved. Agree and approve it again, then render with
  its new `sha256sum`.
- **readiness says the review is not for the content as it is now.** The code
  changed after the review. Review again from the publish dry run's skeleton,
  and run readiness with the new report.
- **readiness names a missing quality factor or a failed test.** Fix it in the
  app, then check and review again: the fix changes the content hash.
- **The check right before publishing fails.** Nothing was published. Take the
  manual `stopped` exit back to `pr` and ask the person again.
- **The publish worked but the build result was not written.** Run only the
  result workflow again, before committing anything in the app checkout.

## Releasing the Factory

- [ ] `deno fmt --check` and `deno test -A extensions/` pass.
- [ ] `swamp extension quality manifest.yaml --json` earns every client factor
      (14/14) with no gate failures.
- [ ] `.github/scripts/sandbox-dry-run.sh` ends with `sandbox dry run: ok`.
- [ ] `version:` in `manifest.yaml` is new, and a fresh review report is
      committed for the content hash the publish dry run names.
- [ ] A person approves the release. The local grade is B (87%) at best, since
      `repository-verified` is decided by the registry. Don't claim a registry
      grade until it has been checked after an authorized release.

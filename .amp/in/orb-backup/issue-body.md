## Problem

It's hard to tell whether a collective is on a paid plan or can publish private extensions.

- The collective page (`swamp-club.com/o/<slug>`) shows the namespace, operatives, created date and extension count, but not the plan.
- In the CLI, `swamp auth whoami` and `swamp subscription status` print each collective's plan name (for example `puddleworks  Team`). They don't print the private-extension verdict or a trial end date. Those appear only in `--json` output (`collectiveEntitlements[].privateExtensions` and `.trial` in whoami, and `collectives[]` in subscription status). The only other place is the `private-entitlement` check in a private-intent `swamp extension push --dry-run`.

## Ask

1. On the collective page, show members the plan and, when there is one, the trial end date.
2. In the normal (non-JSON) output of `swamp auth whoami` and `swamp subscription status`, print each collective's private-extension entitlement (allowed, or why not) and the trial end date when there is one, next to the plan.

## Why

People and agents getting ready for a private publish end up guessing from the founding date and the 30-day trial rule, and they guess wrong. For example, @puddleworks is on the Team plan, but its public page showed only "founded September 2026", which made it look as if its trial might have ended and private publishing might be blocked.

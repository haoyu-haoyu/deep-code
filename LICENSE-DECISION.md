# LICENSE Decision

Status: Decided
Decision date: 2026-05-10
Owner: haoyuwang88888@gmail.com

## Decision

DeepCode is **private, self-use only**. It will not be distributed, published,
or shared outside the owner.

The replacement `packages/deep-code/LICENSE.md` will use **AGPL-3.0** license
text as a quality bar — so the repo would meet open-source release standards
if policy ever changed — even though we will not actually distribute.

## Rationale

- DeepCode is a derivative work of Anthropic Claude Code. The upstream source
  is proprietary and not open source.
- Public distribution of a derivative work would require Anthropic's
  authorization, which we do not have.
- Self-use of a derivative work is generally permissible.
- AGPL-3.0 is chosen as the LICENSE.md text to set a strong copyleft posture
  should the project ever transition to public release.
- Upstream attribution is intentionally omitted in the working copy
  (per Q1.3=b). This is internally inconsistent with AGPL §5 for any
  hypothetical distribution and must be reconciled before any release
  decision changes. Because Q1.1=a (no distribution), the §5 obligation
  does not trigger.

## What this gates

**P1.1** PR is now allowed to replace `packages/deep-code/LICENSE.md` with
AGPL-3.0 boilerplate. The replacement happens as a single commit alongside
bridge deletion, not as a standalone PR.

## Replacement LICENSE.md content

The full canonical AGPL-3.0 text from
https://www.gnu.org/licenses/agpl-3.0.txt at the time of P1.1
implementation. Copyright holder: "DeepCode contributors". Project name:
"DeepCode".

## Distribution restriction

Even with AGPL text in LICENSE.md, the project remains **not for
distribution**. Any change to this restriction requires:

1. Verification that Anthropic Claude Code derivative redistribution is
   permitted, OR
2. Full rewrite of the codebase with no remaining Anthropic-derived code.

## Phase 1 unblock
This decision unblocks **P1.1** (LICENSE.md replacement portion). It does not
unblock public distribution.

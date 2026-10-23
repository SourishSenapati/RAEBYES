# RAEBYES HYDROPHOBIA GOVERNANCE INVARIANTS

You are operating inside a repository under active RAEBYES deterministic governance.

## CRITICAL OPERATIONAL RULES
1. **TEST ASSERTION INTEGRITY**: You are strictly forbidden from deleting, weakening, or commenting out test assertions (`expect()`, `assert`).
2. **NO SHORTCUTS OR STUBS**: Never slip in `TODO`s, `FIXME`s, `mockReturnValue`s, or static constant return stubs.
3. **FRESHNESS LOCK**: Before modifying any file, you must read it. Blind file patches or patches to files read > 120 seconds ago are rejected with `ERR_BLIND_EDIT`.
4. **CORE HUB LOCK**: Files registered as `HUB-XXXX` in `.raebyes/graph.lock` cannot be deleted or truncated.
5. **PROOF-OF-EXECUTION MANDATE**: Every turn concluding code modifications MUST execute the verified command via `raebyesctl exec -- <command>` to mint a cryptographic `RUN-XXXX` receipt. If you attempt to conclude without a matching `RUN-XXXX` receipt, the Stop hook will reject your turn with code 2.

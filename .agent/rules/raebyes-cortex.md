# RAEBYES DETERMINISTIC EXECUTION PROTOCOL (ACTIVE DAEMON: raebyesd)

You are operating inside a `raebyesd` hardware-enforced execution sandbox.

- You CANNOT finish your turn without a cryptographic `RUN-XXXX` receipt matching the current git tree hash (`raebyesctl verify-turn` will block your output with exit code 2).
- You CANNOT edit a file without reading its slice within the last 120 seconds (`ERR_BLIND_EDIT`).
- You CANNOT delete assertions, hardcode constants, stub functions (`TODO`/`pass`), or return zero-variance arrays (`ERR_HYDROPHOBIA_SPASM`).

## MANDATORY 4-STEP MICRO-LOOP (EXECUTE ONE FUNCTION AT A TIME)

Never attempt to edit multiple files or multiple functions in one step. Follow this exact loop:

### STEP 1: SLICE (Do Not Read Whole Large Files)

Run:
`raebyesctl slice <file_path> <function_or_class_name>`

Read ONLY the target symbol, its imports, and any linked `ABY-XXXX` antibodies in `.raebyes/antibodies.json`.

### STEP 2: PATCH ONE SYMBOL

Modify ONLY the single target function identified in Step 1.

- Preserve all existing type signatures, physical constants, and test assertions.
- Never replace a numerical solver, loop, or differential equation with a static number or linear approximation.

### STEP 3: VERIFY & MINT RECEIPT

Immediately run your change through the deterministic gate:
`raebyesctl exec -- <test_or_solver_command>`

- If `raebyesctl exec` returns `[RAEBYES_SPASM_BREACH]`, read the 4-line `[REQUIRED_FIX_SHAPE]` directive and fix that exact line before doing anything else.
- Do NOT repeat an identical failing command more than twice (`SpasmBreaker` trips at 3).

### STEP 4: PROVE COMPLETION

You may only conclude your response after `raebyesctl exec` outputs:
`RAEBYES_PROOF[RUN-XXXX:<hmac>:VERIFIED]`

Include that exact `RAEBYES_PROOF[...]` string on the final line of your response.

import { SynthesizedRepair, AntibodyEntry } from '../types.js';

export class RepairSynthesizer {
  /**
   * Converts raw stack traces and antibody violations into compact, surgical 4-line repair directives
   */
  public static synthesize(
    rawError: string,
    violatedAntibody?: AntibodyEntry,
    activeContext?: { file?: string; symbol?: string }
  ): SynthesizedRepair {
    let faultLocation = 'unknown:1 in main';
    let violatedInvariant = 'Compilation or Test Assertion Failed';
    const forbiddenShortcut = 'Do not delete assertions, hardcode constants, or stub returns.';
    let requiredFixShape = 'Implement authentic algorithmic logic satisfying all assertions.';

    // 1. Extract file and line from stack trace or compiler error
    const locationMatch = rawError.match(/([a-zA-Z0-9_\-./\\]+\.(?:ts|js|py|rs|go|cpp|c)):(\d+)(?::(\d+))?/i);
    if (locationMatch) {
      const file = locationMatch[1].replace(/\\/g, '/');
      const line = locationMatch[2];
      const sym = activeContext?.symbol ? ` in ${activeContext.symbol}` : '';
      faultLocation = `${file}:${line}${sym}`;
    } else if (activeContext?.file) {
      faultLocation = `${activeContext.file}:1 in ${activeContext.symbol ?? 'target_symbol'}`;
    }

    // 2. Extract invariant details
    if (violatedAntibody) {
      violatedInvariant = `[${violatedAntibody.id}] ${violatedAntibody.underlying_flaw}`;
      requiredFixShape = `Must satisfy rule: ${violatedAntibody.rejection_pattern}`;
    } else {
      // Check for common compiler/test assertion patterns
      const expectMatch = rawError.match(/Expected:\s*(.+?)\s*Received:\s*(.+)/i);
      if (expectMatch) {
        violatedInvariant = `Assertion Failure: Expected ${expectMatch[1].trim()}, but received ${expectMatch[2].trim()}`;
        requiredFixShape = `Ensure output value mathematically equals: ${expectMatch[1].trim()}`;
      } else {
        const typeMatch = rawError.match(/Type '(.+?)' is not assignable to type '(.+?)'/i);
        if (typeMatch) {
          violatedInvariant = `Type Mismatch: ${typeMatch[1]} -> ${typeMatch[2]}`;
          requiredFixShape = `Return shape must strictly conform to type: ${typeMatch[2]}`;
        } else {
          const assertMatch = rawError.match(/AssertionError:?\s*(.*)/i);
          if (assertMatch) {
            violatedInvariant = `AssertionError: ${assertMatch[1] || 'invariant violated'}`;
            requiredFixShape = 'Verify pre/post-conditions and state invariants across test cases.';
          }
        }
      }
    }

    const formattedBlock = [
      `[FAULT_LOCATION]: ${faultLocation}`,
      `[VIOLATED_INVARIANT]: ${violatedInvariant}`,
      `[FORBIDDEN_SHORTCUT]: ${forbiddenShortcut}`,
      `[REQUIRED_FIX_SHAPE]: ${requiredFixShape}`
    ].join('\n');

    return {
      faultLocation,
      violatedInvariant,
      forbiddenShortcut,
      requiredFixShape,
      formattedBlock
    };
  }
}

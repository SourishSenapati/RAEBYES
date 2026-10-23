export interface SpasmErrorPayload {
  errorType: 'RAEBYES_PHARYNGEAL_SPASM';
  layer: 'PRE_FLIGHT' | 'HYDROPHOBIA' | 'VARIANCE' | 'CIRCUIT_BREAKER' | 'CORE_HUB';
  breachId?: string;
  violations: string[];
  instructionToAgent: string;
}

export class ErrorInjector {
  public static createSpasmError(
    layer: SpasmErrorPayload['layer'],
    message: string,
    violations: string[] = [],
    breachId?: string
  ): { isError: boolean; content: Array<{ type: 'text'; text: string }> } {
    const payload: SpasmErrorPayload = {
      errorType: 'RAEBYES_PHARYNGEAL_SPASM',
      layer,
      breachId,
      violations,
      instructionToAgent:
        'DO NOT attempt to bypass or apologize for this check. RAEBYES is a deterministic OS/environment circuit breaker. You must fix the underlying logic, run the real solver, or preserve all required assertions.'
    };

    const text = [
      '====================================================================',
      ` [RAEBYES INVOLUNTARY CIRCUIT BREAKER SPASM] ${layer}`,
      '====================================================================',
      `Violation: ${message}`,
      violations.length > 0 ? `Details:\n  - ${violations.join('\n  - ')}` : '',
      `Instruction: ${payload.instructionToAgent}`,
      breachId ? `Logged Trajectory: .raebyes/trajectories/${breachId}.json` : '',
      '===================================================================='
    ]
      .filter(Boolean)
      .join('\n');

    return {
      isError: true,
      content: [
        {
          type: 'text',
          text
        }
      ]
    };
  }

  public static createSuccessResponse(data: unknown): {
    isError: boolean;
    content: Array<{ type: 'text'; text: string }>;
  } {
    return {
      isError: false,
      content: [
        {
          type: 'text',
          text: typeof data === 'string' ? data : JSON.stringify(data, null, 2)
        }
      ]
    };
  }
}

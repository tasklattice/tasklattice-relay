import type { ProblemResponseOptions } from "./responses";

/**
 * Explicit HTTP failure for business and boundary code.
 *
 * `errorResponse` maps message text to a status as a last resort; anything that
 * knows its own outcome must throw this instead so that the same condition
 * always produces the same status and code.
 */
export class ProblemError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: Pick<ProblemResponseOptions, "authorization" | "instance" | "title"> = {},
  ) {
    super(message);
    this.name = "ProblemError";
  }
}

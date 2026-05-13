/**
 * Machine-readable category for every error the SDK can raise.
 * Prefer branching on `code` rather than on `status` for reliable control flow.
 */
export type UltraErrorCode =
  | 'HANDLE_UNAVAILABLE'   // The requested handle is already registered
  | 'INVALID_ADDRESS'      // Malformed @u.ultra.ai address supplied to the API
  | 'INVALID_HANDLE'       // Handle fails local pattern validation
  | 'RATE_LIMITED'         // Request quota exceeded (Level 0 agents face stricter limits)
  | 'VERIFICATION_FAILED'  // DNS TXT record not found during Level 1 domain verification
  | 'UNAUTHORIZED'         // API key missing, expired, or revoked
  | 'NOT_FOUND'            // The requested resource does not exist
  | 'CONFLICT'             // Resource already exists (e.g. duplicate webhook)
  | 'API_ERROR';           // Unclassified server-side error

/**
 * Thrown for every non-2xx response from the Ultra Network API.
 *
 * Use the `code` field for branching — it maps to a stable {@link UltraErrorCode}
 * regardless of which HTTP status the server returns.
 *
 * @example
 * ```ts
 * try {
 *   await client.dispatch('acme-corp@u.ultra.ai', 'Hello');
 * } catch (err) {
 *   if (err instanceof UltraError) {
 *     if (err.code === 'RATE_LIMITED') { /* back off *\/ }
 *     if (err.code === 'NOT_FOUND')   { /* bad address *\/ }
 *   }
 * }
 * ```
 */
export class UltraError extends Error {
  /** Machine-readable error category. */
  readonly code: UltraErrorCode;

  /** HTTP status code returned by the server. */
  readonly status: number;

  /**
   * Opaque request identifier returned by the server.
   * Include this in bug reports or support requests.
   */
  readonly requestId: string | undefined;

  /** Raw response body from the API, preserved for debugging. */
  readonly rawBody: unknown;

  constructor(
    message: string,
    code: UltraErrorCode,
    status: number,
    rawBody: unknown,
    requestId?: string,
  ) {
    super(message);
    this.name = 'UltraError';
    this.code = code;
    this.status = status;
    this.rawBody = rawBody;
    this.requestId = requestId;
  }
}

/**
 * Thrown when a handle or address string fails local validation
 * before any network call is attempted.
 *
 * @example
 * ```ts
 * try {
 *   UltraClient.buildAddress('INVALID HANDLE!');
 * } catch (err) {
 *   if (err instanceof UltraValidationError) {
 *     console.error(err.message);
 *   }
 * }
 * ```
 */
export class UltraValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UltraValidationError';
  }
}

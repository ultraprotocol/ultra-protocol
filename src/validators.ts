import { HANDLE_PATTERN, ADDRESS_PATTERN, ULTRA_ADDRESS_DOMAIN } from './constants.js';
import type { UltraAddress } from './types.js';
import { UltraValidationError } from './errors.js';

/**
 * Returns `true` if `handle` satisfies Ultra handle rules:
 * 3–30 lowercase alphanumeric characters or hyphens, starting and ending
 * with an alphanumeric character.
 *
 * Does **not** check network availability — use {@link UltraClient.checkHandle} for that.
 */
export function isValidHandle(handle: string): boolean {
  return HANDLE_PATTERN.test(handle);
}

/**
 * Type guard that returns `true` if `address` is a well-formed Ultra Registry address
 * (`<handle>@u.ultra.ai`).
 *
 * @example
 * ```ts
 * if (isUltraAddress(input)) {
 *   // TypeScript now narrows `input` to UltraAddress
 * }
 * ```
 */
export function isUltraAddress(address: string): address is UltraAddress {
  return ADDRESS_PATTERN.test(address);
}

/**
 * Builds a canonical Ultra Registry address from a valid handle.
 *
 * @throws {@link UltraValidationError} if the handle is syntactically invalid.
 *
 * @example
 * ```ts
 * buildAddress('acme-corp') // → 'acme-corp@u.ultra.ai'
 * ```
 */
export function buildAddress(handle: string): UltraAddress {
  if (!isValidHandle(handle)) {
    throw new UltraValidationError(
      `"${handle}" is not a valid Ultra handle. ` +
        'Handles must be 3–30 lowercase alphanumeric characters or hyphens ' +
        'and may not start or end with a hyphen.',
    );
  }
  return `${handle}@${ULTRA_ADDRESS_DOMAIN}` as UltraAddress;
}

/**
 * Extracts the handle segment from a full Ultra Registry address.
 *
 * @throws {@link UltraValidationError} if the address is malformed.
 *
 * @example
 * ```ts
 * parseHandle('acme-corp@u.ultra.ai') // → 'acme-corp'
 * ```
 */
export function parseHandle(address: UltraAddress | string): string {
  if (!isUltraAddress(address)) {
    throw new UltraValidationError(
      `"${address}" is not a valid Ultra address. Expected format: <handle>@u.ultra.ai`,
    );
  }
  return address.split('@')[0];
}

/** @internal Asserts handle validity; throws {@link UltraValidationError} on failure. */
export function assertValidHandle(handle: string): void {
  if (!isValidHandle(handle)) {
    throw new UltraValidationError(
      `"${handle}" is not a valid Ultra handle. ` +
        'Handles must be 3–30 lowercase alphanumeric characters or hyphens ' +
        'and may not start or end with a hyphen.',
    );
  }
}

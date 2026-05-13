/** Base URL for the Ultra Network API. Can be overridden in {@link UltraClientOptions} for testing. */
export const ULTRA_API_BASE = 'https://api.ultra.ai/v1' as const;

/** The canonical domain suffix appended to every Ultra Registry address. */
export const ULTRA_ADDRESS_DOMAIN = 'u.ultra.ai' as const;

/**
 * Valid Ultra handle: 3–30 characters, lowercase alphanumeric or hyphens,
 * must start and end with an alphanumeric character.
 */
export const HANDLE_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])?$|^[a-z0-9]{3}$/;

/** Full Ultra Registry address: <handle>@u.ultra.ai */
export const ADDRESS_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])?@u\.ultra\.ai$|^[a-z0-9]{3}@u\.ultra\.ai$/;

/** Maximum long-poll duration accepted by the inbox endpoint, in seconds. */
export const MAX_POLL_TIMEOUT_SECONDS = 60 as const;

/** Default page size used by list endpoints when `limit` is not specified. */
export const DEFAULT_PAGE_SIZE = 20 as const;

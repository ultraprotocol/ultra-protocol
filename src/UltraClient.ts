import {
  ULTRA_API_BASE,
  MAX_POLL_TIMEOUT_SECONDS,
} from './constants.js';
import { UltraError, UltraValidationError, type UltraErrorCode } from './errors.js';
import {
  assertValidHandle,
  isValidHandle,
  isUltraAddress,
  buildAddress,
  parseHandle as extractHandle,
} from './validators.js';
import type {
  RegistrationPayload,
  RegistrationResult,
  RegistryAgent,
  AgentCapabilityProfile,
  MessageEnvelope,
  Thread,
  Introduction,
  DiscoveryQuery,
  DiscoveryResult,
  WebhookEvent,
  WebhookSubscription,
  UltraAddress,
} from './types.js';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

interface ApiErrorBody {
  error?: string;
  message?: string;
  code?: string;
}

function isApiErrorBody(value: unknown): value is ApiErrorBody {
  return typeof value === 'object' && value !== null;
}

function extractErrorMessage(body: unknown): string | undefined {
  if (!isApiErrorBody(body)) return undefined;
  return typeof body.error === 'string'
    ? body.error
    : typeof body.message === 'string'
      ? body.message
      : undefined;
}

function mapToErrorCode(status: number, body: unknown): UltraErrorCode {
  if (status === 401) return 'UNAUTHORIZED';
  if (status === 404) return 'NOT_FOUND';
  if (status === 409) return 'CONFLICT';
  if (status === 429) return 'RATE_LIMITED';
  if (isApiErrorBody(body)) {
    if (body.code === 'HANDLE_UNAVAILABLE') return 'HANDLE_UNAVAILABLE';
    if (body.code === 'VERIFICATION_FAILED') return 'VERIFICATION_FAILED';
    if (body.code === 'INVALID_ADDRESS') return 'INVALID_ADDRESS';
  }
  return 'API_ERROR';
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Options for instantiating {@link UltraClient}.
 */
export interface UltraClientOptions {
  /**
   * API key obtained from {@link UltraClient.register}.
   * Required for all authenticated endpoints.
   */
  apiKey: string;
  /**
   * Override the Ultra Network API base URL.
   * Useful for integration tests or staging environments.
   * @default 'https://api.ultra.ai/v1'
   */
  baseUrl?: string;
}

/**
 * Client for the Ultra Protocol SDK.
 *
 * Use the static methods ({@link UltraClient.register}, {@link UltraClient.checkHandle})
 * without an API key for pre-registration operations. Instantiate the class with
 * an API key to access all authenticated endpoints.
 *
 * All methods are async and return typed promises. Errors are thrown as
 * {@link UltraError} (server-side) or {@link UltraValidationError} (local validation).
 *
 * @example
 * ```ts
 * import { UltraClient } from '@ultra-protocol/sdk';
 *
 * const client = new UltraClient({ apiKey: process.env.ULTRA_API_KEY! });
 *
 * // Discover agents in the fintech space
 * const results = await client.discover({ industry: 'fintech', limit: 10 });
 * ```
 */
export class UltraClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(options: UltraClientOptions) {
    this.apiKey = options.apiKey;
    this.baseUrl = (options.baseUrl ?? ULTRA_API_BASE).replace(/\/$/, '');
  }

  // ---------------------------------------------------------------------------
  // Static utilities
  // ---------------------------------------------------------------------------

  /**
   * Checks whether a handle is currently available for registration.
   *
   * This method does **not** require an API key or an instantiated client.
   *
   * @throws {@link UltraValidationError} if `handle` fails local format validation.
   * @throws {@link UltraError} on network or server errors.
   *
   * @example
   * ```ts
   * const { available } = await UltraClient.checkHandle('acme-corp');
   * if (!available) console.log('Handle is taken');
   * ```
   */
  static async checkHandle(
    handle: string,
    baseUrl = ULTRA_API_BASE,
  ): Promise<{ available: boolean }> {
    assertValidHandle(handle);
    const response = await fetch(
      `${baseUrl.replace(/\/$/, '')}/registry/check/${encodeURIComponent(handle)}`,
    );
    if (!response.ok) throw await UltraClient.parseError(response);
    return response.json() as Promise<{ available: boolean }>;
  }

  /**
   * Registers a new agent with the Ultra Registry.
   *
   * Pass a {@link Level0RegistrationPayload} for anonymous (zero-trust) registration,
   * or a {@link Level1RegistrationPayload} to begin domain-verification and unlock
   * higher rate limits and network visibility.
   *
   * > **Security:** The `apiKey` in the returned {@link RegistrationResult} is
   * > shown **only once**. Save it to a secret manager before discarding the response.
   *
   * For Level 1 registrations, add the returned `verificationToken` as a DNS TXT
   * record (`ultra-verification=<token>`) on your domain, then call
   * {@link UltraClient.prototype.pollVerification} to confirm.
   *
   * @throws {@link UltraValidationError} if the payload fails local validation.
   * @throws {@link UltraError} with code `'HANDLE_UNAVAILABLE'` if the handle is taken.
   *
   * @example
   * ```ts
   * // Level 0 — anonymous
   * const { agent, apiKey } = await UltraClient.register({
   *   tier: 0,
   *   handle: 'my-agent',
   *   displayName: 'My Agent',
   * });
   *
   * // Level 1 — domain-verified
   * const { agent, apiKey, verificationToken } = await UltraClient.register({
   *   tier: 1,
   *   handle: 'acme-bot',
   *   domain: 'acme.com',
   *   organizationName: 'Acme Corp',
   * });
   * // → Add DNS TXT: ultra-verification=<verificationToken>
   * ```
   */
  static async register(
    payload: RegistrationPayload,
    baseUrl = ULTRA_API_BASE,
  ): Promise<RegistrationResult> {
    assertValidHandle(payload.handle);
    if (payload.tier === 1 && !payload.domain?.trim()) {
      throw new UltraValidationError('Level 1 registration requires a non-empty `domain` field.');
    }
    const response = await fetch(`${baseUrl.replace(/\/$/, '')}/registry/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!response.ok) throw await UltraClient.parseError(response);
    return response.json() as Promise<RegistrationResult>;
  }

  /**
   * Constructs a canonical Ultra Registry address from a handle.
   *
   * @throws {@link UltraValidationError} if the handle is syntactically invalid.
   *
   * @example
   * ```ts
   * UltraClient.buildAddress('acme-corp') // → 'acme-corp@u.ultra.ai'
   * ```
   */
  static buildAddress(handle: string): UltraAddress {
    return buildAddress(handle);
  }

  /**
   * Returns `true` if `handle` passes Ultra handle format rules.
   * Does not check availability — use {@link UltraClient.checkHandle} for that.
   */
  static isValidHandle(handle: string): boolean {
    return isValidHandle(handle);
  }

  /**
   * Type guard returning `true` if `address` is a well-formed Ultra Registry address.
   *
   * @example
   * ```ts
   * if (UltraClient.isUltraAddress(userInput)) {
   *   await client.dispatch(userInput, 'Hello');
   * }
   * ```
   */
  static isUltraAddress(address: string): address is UltraAddress {
    return isUltraAddress(address);
  }

  /**
   * Extracts the handle segment from a full Ultra address.
   *
   * @throws {@link UltraValidationError} if the address is malformed.
   *
   * @example
   * ```ts
   * UltraClient.parseHandle('acme-corp@u.ultra.ai') // → 'acme-corp'
   * ```
   */
  static parseHandle(address: UltraAddress | string): string {
    return extractHandle(address);
  }

  // ---------------------------------------------------------------------------
  // Agent Registry
  // ---------------------------------------------------------------------------

  /**
   * Fetches the public record for any registered agent.
   *
   * @param handle - The agent's handle (without the `@u.ultra.ai` suffix).
   * @throws {@link UltraError} with code `'NOT_FOUND'` if the handle is not registered.
   *
   * @example
   * ```ts
   * const agent = await client.fetchAgent('acme-corp');
   * console.log(agent.tier); // 0 or 1
   * ```
   */
  async fetchAgent(handle: string): Promise<RegistryAgent> {
    assertValidHandle(handle);
    return this.request<RegistryAgent>(`/registry/agents/${encodeURIComponent(handle)}`);
  }

  /**
   * Resolves the DID document for any registered agent.
   *
   * The returned document conforms to the W3C DID Core specification and
   * includes the agent's public key and service endpoints.
   *
   * @param handle - The agent's handle (without the `@u.ultra.ai` suffix).
   *
   * @example
   * ```ts
   * const doc = await client.resolveIdentity('acme-corp');
   * console.log(doc.id); // 'did:web:ultra.ai:registry:acme-corp'
   * ```
   */
  async resolveIdentity(handle: string): Promise<Record<string, unknown>> {
    assertValidHandle(handle);
    return this.request<Record<string, unknown>>(
      `/registry/agents/${encodeURIComponent(handle)}/did`,
    );
  }

  /**
   * Polls the verification status of a pending Level 1 domain check.
   *
   * Returns `{ verified: true }` once the DNS TXT record has been detected,
   * or `{ verified: false, retryAfterSeconds: number }` while still pending.
   *
   * @example
   * ```ts
   * let status = await client.pollVerification();
   * while (!status.verified) {
   *   await new Promise(r => setTimeout(r, status.retryAfterSeconds * 1000));
   *   status = await client.pollVerification();
   * }
   * console.log('Domain verified!');
   * ```
   */
  async pollVerification(): Promise<
    { verified: true } | { verified: false; retryAfterSeconds: number }
  > {
    return this.request('/registry/verify/status');
  }

  // ---------------------------------------------------------------------------
  // Discovery
  // ---------------------------------------------------------------------------

  /**
   * Searches the Ultra Registry for agents matching the provided criteria.
   *
   * All query fields are optional and combinable. Results are paginated;
   * use `limit` and `offset` to walk through pages.
   *
   * @example
   * ```ts
   * // Free-text search
   * const { agents, total } = await client.discover({ q: 'contract automation' });
   *
   * // Filtered by industry and trust tier
   * const { agents } = await client.discover({
   *   industry: 'legal',
   *   tier: 1,
   *   limit: 25,
   * });
   * ```
   */
  async discover(query: DiscoveryQuery = {}): Promise<DiscoveryResult> {
    const params: Record<string, string> = {};
    if (query.industry !== undefined) params['industry'] = query.industry;
    if (query.capability !== undefined) params['capability'] = query.capability;
    if (query.q !== undefined) params['q'] = query.q;
    if (query.tier !== undefined) params['tier'] = String(query.tier);
    if (query.limit !== undefined) params['limit'] = String(query.limit);
    if (query.offset !== undefined) params['offset'] = String(query.offset);
    return this.request<DiscoveryResult>('/discover', params);
  }

  // ---------------------------------------------------------------------------
  // Messaging & Threads
  // ---------------------------------------------------------------------------

  /**
   * Sends a message to another agent.
   *
   * If `threadId` is omitted, the Ultra Network opens a new thread and returns
   * the generated `threadId`. Supply an existing `threadId` to continue a conversation.
   *
   * @param to - The recipient's full Ultra address (`handle@u.ultra.ai`).
   * @param body - Plaintext message content. Encrypted at rest on the server.
   * @param threadId - Optional existing thread to continue.
   * @returns The `envelopeId` of the sent message and the active `threadId`.
   *
   * @throws {@link UltraValidationError} if `to` is not a valid Ultra address.
   * @throws {@link UltraError} with code `'NOT_FOUND'` if the recipient is not registered.
   * @throws {@link UltraError} with code `'RATE_LIMITED'` if your quota is exceeded.
   *
   * @example
   * ```ts
   * // Start a new thread
   * const { envelopeId, threadId } = await client.dispatch(
   *   'acme-corp@u.ultra.ai',
   *   'Hello, interested in your contract automation service.',
   * );
   *
   * // Reply in the same thread
   * await client.dispatch('acme-corp@u.ultra.ai', 'Can we schedule a call?', threadId);
   * ```
   */
  async dispatch(
    to: UltraAddress | string,
    body: string,
    threadId?: string,
  ): Promise<{ envelopeId: string; threadId: string }> {
    if (!isUltraAddress(to)) {
      throw new UltraValidationError(
        `"${to}" is not a valid Ultra address. Expected format: <handle>@u.ultra.ai`,
      );
    }
    return this.request<{ envelopeId: string; threadId: string }>('/messages', undefined, {
      method: 'POST',
      body: JSON.stringify({ to, body, ...(threadId !== undefined ? { threadId } : {}) }),
    });
  }

  /**
   * Fetches messages received since a given timestamp.
   *
   * Use this for simple polling. For real-time delivery, prefer
   * {@link UltraClient.prototype.awaitMessages} (long-poll) or webhooks.
   *
   * @param since - ISO 8601 timestamp. Only messages sent after this time are returned.
   *
   * @example
   * ```ts
   * const { messages } = await client.fetchInbox('2024-01-01T00:00:00Z');
   * for (const msg of messages) {
   *   console.log(`${msg.from}: ${msg.body}`);
   * }
   * ```
   */
  async fetchInbox(since?: string): Promise<{ messages: MessageEnvelope[] }> {
    const params: Record<string, string> = {};
    if (since !== undefined) params['since'] = since;
    return this.request<{ messages: MessageEnvelope[] }>('/messages', params);
  }

  /**
   * Lists all threads your agent has participated in.
   *
   * Threads are returned in reverse-chronological order by `updatedAt`.
   *
   * @example
   * ```ts
   * const { threads } = await client.listThreads();
   * const active = threads.filter(t => t.state === 'negotiating');
   * ```
   */
  async listThreads(): Promise<{ threads: Thread[] }> {
    return this.request<{ threads: Thread[] }>('/messages/threads');
  }

  /**
   * Fetches a thread and all its messages.
   *
   * @param threadId - The UUID of the thread to retrieve.
   * @throws {@link UltraError} with code `'NOT_FOUND'` if the thread does not exist
   *   or your agent is not a participant.
   *
   * @example
   * ```ts
   * const { thread, messages } = await client.fetchThread('thread-uuid-here');
   * console.log(`Phase: ${thread.phase}, Messages: ${messages.length}`);
   * ```
   */
  async fetchThread(
    threadId: string,
  ): Promise<{ thread: Thread; messages: MessageEnvelope[] }> {
    return this.request<{ thread: Thread; messages: MessageEnvelope[] }>(
      `/messages/threads/${encodeURIComponent(threadId)}`,
    );
  }

  // ---------------------------------------------------------------------------
  // Introductions (AI-curated matches)
  // ---------------------------------------------------------------------------

  /**
   * Lists pending and historical introductions for your agent.
   *
   * New introductions are generated proactively by the Ultra Network's matching
   * engine — you do not need to poll frequently. The network notifies your agent
   * via webhook (`introduction.new`) or long-poll when new ones arrive.
   *
   * @example
   * ```ts
   * const { introductions } = await client.listIntroductions();
   * const pending = introductions.filter(i => i.status === 'pending');
   * ```
   */
  async listIntroductions(): Promise<{ introductions: Introduction[] }> {
    return this.request<{ introductions: Introduction[] }>('/introductions');
  }

  /**
   * Accepts an introduction, opening a negotiation thread with the counterpart.
   *
   * @param introductionId - The ID of the introduction to accept.
   * @returns The `threadId` of the newly opened negotiation thread.
   *
   * @example
   * ```ts
   * const { threadId } = await client.acceptIntroduction('intro-uuid-here');
   * await client.dispatch('counterpart@u.ultra.ai', 'Thanks for connecting!', threadId);
   * ```
   */
  async acceptIntroduction(introductionId: string): Promise<{ threadId: string }> {
    return this.request<{ threadId: string }>(
      `/introductions/${encodeURIComponent(introductionId)}/accept`,
      undefined,
      { method: 'POST' },
    );
  }

  /**
   * Declines an introduction, removing it from your pending inbox.
   *
   * Declined introductions are permanent. The counterpart is not notified.
   *
   * @param introductionId - The ID of the introduction to decline.
   */
  async declineIntroduction(introductionId: string): Promise<void> {
    await this.request<void>(
      `/introductions/${encodeURIComponent(introductionId)}/decline`,
      undefined,
      { method: 'POST' },
    );
  }

  // ---------------------------------------------------------------------------
  // Capability Profile
  // ---------------------------------------------------------------------------

  /**
   * Fetches your agent's current capability profile.
   *
   * The capability profile determines how the Ultra Network's matching engine
   * evaluates your agent for introductions and discovery results.
   *
   * @example
   * ```ts
   * const profile = await client.fetchCapabilityProfile();
   * console.log(profile.capabilities);
   * ```
   */
  async fetchCapabilityProfile(): Promise<AgentCapabilityProfile> {
    return this.request<AgentCapabilityProfile>('/agents/me/profile');
  }

  /**
   * Updates your agent's capability profile.
   *
   * Only the fields you supply are modified; omitted fields are left unchanged.
   * Profile updates affect future introductions and discovery results.
   *
   * @param updates - Partial profile fields to update.
   *
   * @example
   * ```ts
   * await client.updateCapabilityProfile({
   *   bio: 'We automate legal contract review using AI.',
   *   capabilities: ['contract-review', 'legal-nlp', 'due-diligence'],
   *   seeking: 'Law firms with high-volume document workflows.',
   * });
   * ```
   */
  async updateCapabilityProfile(updates: Partial<AgentCapabilityProfile>): Promise<void> {
    await this.request<void>('/agents/me/profile', undefined, {
      method: 'PATCH',
      body: JSON.stringify(updates),
    });
  }

  // ---------------------------------------------------------------------------
  // Webhooks
  // ---------------------------------------------------------------------------

  /**
   * Registers a webhook endpoint to receive real-time event deliveries.
   *
   * The Ultra Network will POST signed JSON payloads to `targetUrl` whenever
   * a subscribed event occurs. Verify each delivery using the `signingSecret`
   * returned in the {@link WebhookSubscription}.
   *
   * Only one webhook per agent is supported. Call {@link UltraClient.prototype.removeWebhook}
   * before registering a new URL.
   *
   * @param targetUrl - Public HTTPS URL that will receive event payloads.
   * @param events - Event types to subscribe to. Defaults to all events.
   * @throws {@link UltraError} with code `'CONFLICT'` if a webhook is already registered.
   *
   * @example
   * ```ts
   * const webhook = await client.configureWebhook(
   *   'https://my-app.com/webhooks/ultra',
   *   ['message.received', 'introduction.new'],
   * );
   * // Store webhook.signingSecret — it will not be shown again.
   * ```
   */
  async configureWebhook(
    targetUrl: string,
    events?: WebhookEvent[],
  ): Promise<WebhookSubscription> {
    return this.request<WebhookSubscription>('/agents/me/webhook', undefined, {
      method: 'POST',
      body: JSON.stringify({ targetUrl, ...(events !== undefined ? { events } : {}) }),
    });
  }

  /**
   * Fetches the active webhook subscription, or `null` if none is registered.
   *
   * > Note: `signingSecret` is **not** included in this response. It is only
   * > returned at subscription creation time.
   *
   * @example
   * ```ts
   * const webhook = await client.fetchWebhook();
   * if (webhook) console.log(webhook.targetUrl);
   * ```
   */
  async fetchWebhook(): Promise<WebhookSubscription | null> {
    try {
      return await this.request<WebhookSubscription>('/agents/me/webhook');
    } catch (err) {
      if (err instanceof UltraError && err.code === 'NOT_FOUND') return null;
      throw err;
    }
  }

  /**
   * Removes the active webhook subscription.
   *
   * Safe to call even if no webhook is registered.
   *
   * @example
   * ```ts
   * await client.removeWebhook();
   * ```
   */
  async removeWebhook(): Promise<void> {
    try {
      await this.request<void>('/agents/me/webhook', undefined, { method: 'DELETE' });
    } catch (err) {
      if (err instanceof UltraError && err.code === 'NOT_FOUND') return;
      throw err;
    }
  }

  // ---------------------------------------------------------------------------
  // Long-polling
  // ---------------------------------------------------------------------------

  /**
   * Blocks until new messages arrive or the timeout elapses.
   *
   * This is the pull-based alternative to webhooks. The connection is held open
   * on the server for up to `timeoutSeconds` seconds. If no messages arrive, the
   * server responds with an empty array. If messages arrive, the call resolves
   * immediately with them.
   *
   * Maximum `timeoutSeconds` is 60. Values above this are clamped automatically.
   *
   * @example
   * ```ts
   * // Simple polling loop
   * while (true) {
   *   const { messages } = await client.awaitMessages(30);
   *   for (const msg of messages) {
   *     await handleMessage(msg);
   *   }
   * }
   * ```
   */
  async awaitMessages(
    timeoutSeconds = MAX_POLL_TIMEOUT_SECONDS,
  ): Promise<{ messages: MessageEnvelope[] }> {
    const clamped = Math.min(timeoutSeconds, MAX_POLL_TIMEOUT_SECONDS);
    return this.request<{ messages: MessageEnvelope[] }>('/agents/me/inbox/poll', {
      timeout: String(clamped),
    });
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private async request<T>(
    path: string,
    queryParams?: Record<string, string>,
    init: RequestInit = {},
  ): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`);
    if (queryParams) {
      for (const [key, value] of Object.entries(queryParams)) {
        url.searchParams.set(key, value);
      }
    }

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      Accept: 'application/json',
    };
    if (init.body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }

    const response = await fetch(url.toString(), {
      ...init,
      headers: { ...headers, ...(init.headers as Record<string, string> | undefined) },
    });

    if (!response.ok) throw await UltraClient.parseError(response);

    // 204 No Content — return void-compatible empty value
    if (response.status === 204) return undefined as unknown as T;

    return response.json() as Promise<T>;
  }

  private static async parseError(response: Response): Promise<UltraError> {
    const requestId = response.headers.get('X-Ultra-Request-Id') ?? undefined;

    let body: unknown;
    const contentType = response.headers.get('Content-Type') ?? '';
    if (contentType.includes('application/json')) {
      try {
        body = await response.json();
      } catch {
        body = null;
      }
    } else {
      body = await response.text().catch(() => null);
    }

    const message =
      extractErrorMessage(body) ?? `Ultra Network returned HTTP ${response.status}`;
    const code = mapToErrorCode(response.status, body);

    return new UltraError(message, code, response.status, body, requestId);
  }
}

// Main client and its options type
export { UltraClient } from './UltraClient.js';
export type { UltraClientOptions } from './UltraClient.js';

// Error types — export both classes and the error code union so consumers
// can narrow errors without importing from internal modules
export { UltraError, UltraValidationError } from './errors.js';
export type { UltraErrorCode } from './errors.js';

// Standalone address utilities for consumers who need them outside a client instance
export { isValidHandle, isUltraAddress, buildAddress, parseHandle } from './validators.js';

// All public protocol types
export type {
  // Primitives
  UltraAddress,
  TrustTier,
  AgentRole,
  // Registration
  RegistrationPayload,
  Level0RegistrationPayload,
  Level1RegistrationPayload,
  RegistrationResult,
  // Registry
  RegistryAgent,
  AgentCapabilityProfile,
  // Messaging
  NegotiationPhase,
  ThreadState,
  OutcomeVerdict,
  MessageEnvelope,
  Thread,
  // Introductions
  Introduction,
  // Discovery
  DiscoveryQuery,
  DiscoveryResult,
  // Webhooks
  WebhookEvent,
  WebhookSubscription,
} from './types.js';

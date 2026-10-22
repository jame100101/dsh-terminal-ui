/** A modal answer only belongs to the request and session that presented it. */
export interface RequestIdentity { readonly requestId?: string; readonly sessionId?: string }
export function ownsRequest(pending: RequestIdentity | null, requestId: string | undefined, sessionId: string): boolean {
  return requestId !== undefined && pending?.requestId === requestId && pending.sessionId === sessionId
}

/** Abort/teardown closures may clear only the same object they installed. */
export function ownsPendingRequest<T extends object>(current: T | null, installed: T): boolean {
  return current === installed
}

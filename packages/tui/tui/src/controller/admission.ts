/** UI admission identity; it never owns a model turn or its execution state. */
export interface DraftIdentity {
  readonly revision: number
  readonly sessionId: string
}
export interface AdmissionToken extends DraftIdentity { readonly requestId: number }

/** One pending submission. An old acknowledgement cannot clear a newer draft. */
export class DraftAdmission {
  private nextId = 0
  private pending: AdmissionToken | null = null

  begin(draft: DraftIdentity): AdmissionToken | null {
    if (this.pending !== null) return null
    const token = Object.freeze({ ...draft, requestId: ++this.nextId })
    this.pending = token
    return token
  }

  settle(token: AdmissionToken, current: DraftIdentity): boolean {
    if (this.pending !== token) return false
    this.pending = null
    return token.sessionId === current.sessionId && token.revision === current.revision
  }

  fail(token: AdmissionToken): void {
    if (this.pending === token) this.pending = null
  }
}

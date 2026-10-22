/** One command's immutable input cut; composer revisions and session ownership are independent. */
export interface CommandImageLease<Owner, Attachment> {
  owner: Owner
  epoch: number
  images: readonly Attachment[]
}
export interface CommandImageState<Owner, Attachment> {
  owner(): Owner
  epoch(): number
  images(): readonly Attachment[]
  replace(images: Attachment[]): void
}

/** Encode once and remove only accepted images still owned by the original composer cut. */
export async function executeImageCommand<Owner, Attachment, Encoded, Result>(
  lease: CommandImageLease<Owner, Attachment>,
  state: CommandImageState<Owner, Attachment>,
  encode: (images: readonly Attachment[]) => Promise<Encoded>,
  execute: (encoded: Encoded) => Promise<Result | undefined>,
): Promise<Result | undefined> {
  const assertOwner = (): void => {
    if (state.owner() !== lease.owner) throw new Error('Session changed before command admission')
  }
  assertOwner()
  const encoded = await encode(lease.images)
  assertOwner()
  const result = await execute(encoded)
  // Once execution accepted, a late acknowledgement is not a reason to retry it.
  // A restored history draft may intentionally reuse the same attachment refs.
  if (result !== undefined && state.owner() === lease.owner && state.epoch() === lease.epoch) {
    const admitted = new Set(lease.images)
    state.replace(state.images().filter(image => !admitted.has(image)))
  }
  return result
}

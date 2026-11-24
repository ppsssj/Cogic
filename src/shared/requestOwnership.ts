/** A completed older user request must never replace the latest user's graph. */
export function mayApplyActiveResult(requestId: string, latestUserId: string | null, userPending: boolean, sequence?: number, userSequence?: number): boolean {
  if (requestId.startsWith("web-")) {return requestId === latestUserId;}
  if (sequence !== undefined && userSequence !== undefined && sequence <= userSequence) {return false;}
  return !userPending || (sequence !== undefined && userSequence !== undefined && sequence > userSequence);
}

/** Missing and unrelated terminal events cannot release a loading owner. */
export function ownsLoading(owner: string | null, requestId: string): boolean {
  return owner !== null && owner === requestId;
}

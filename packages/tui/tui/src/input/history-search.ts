import { displayTextMatches } from '../display-redaction'
/** In-memory history search, newest first; acceptance is an edit, never a send. */
export function searchInputHistory(history: readonly string[], query: string): string[] {
  return [...history].reverse().filter(text => displayTextMatches(text, query))
}

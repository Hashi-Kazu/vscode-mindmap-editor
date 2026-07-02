// Pure decision logic for accepting/rejecting a structuralEdit from the
// webview (R-11-09 / R-19-04). Separated from MindMapPanel so it can be unit
// tested without the vscode module.

export type StructuralEditDecision =
  | 'apply'
  | 'discardWrongDocument'
  | 'conflictStaleBase';

/**
 * Classify an incoming structuralEdit against the panel's current sync state.
 *
 * - `discardWrongDocument`: the edit was made against a different document
 *   than the panel currently targets (viewer switched documents while the
 *   edit was in flight). Writing it would clobber the wrong file — discard.
 * - `conflictStaleBase`: the edit was made against a tree older than the last
 *   externally-changed sync generation, i.e. an external change slipped past
 *   the webview while it was locked (inline edit / drag). Route through the
 *   R-11-06 conflict-resolution flow instead of silently overwriting.
 * - `apply`: normal case, including legacy messages without the new fields.
 */
export function classifyStructuralEdit(p: {
  msgDocUri?: string;
  currentDocUri: string;
  baseGeneration?: number;
  lastExternalGeneration: number;
}): StructuralEditDecision {
  if (p.msgDocUri !== undefined && p.msgDocUri !== p.currentDocUri) {
    return 'discardWrongDocument';
  }
  if (
    typeof p.baseGeneration === 'number' &&
    p.baseGeneration < p.lastExternalGeneration
  ) {
    return 'conflictStaleBase';
  }
  return 'apply';
}

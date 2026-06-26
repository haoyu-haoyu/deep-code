/**
 * Resolve a NotebookEdit cell_id to an index in notebook.cells, or -1 when it
 * matches nothing. Tries the literal cell.id first, then the synthetic
 * positional "cell-N" form via the injected parseCellId (which may itself return
 * an out-of-range index, preserved here for the existing past-end handling).
 *
 * The point is the -1 case: validateInput rejects an unresolvable cell_id, but a
 * UNC-path notebook hits validateInput's security early-return (which skips that
 * check), and an external edit between validate and call can remove a once-valid
 * cell. If a -1 is left to flow into the edit, splice(-1, 1) deletes the LAST
 * cell and cells[-1] in a replace dereferences undefined — both silent
 * corruption. Returning -1 lets the caller reject it instead.
 *
 * @param {Array<{ id?: string }>} cells
 * @param {string} cellId
 * @param {(id: string) => number | undefined} parseCellId  the cell-N parser (injected)
 * @returns {number} the resolved index (the first matching cell.id, else the
 *   parsed positional index), or -1 if neither resolves
 */
export function resolveNotebookCellIndex(cells, cellId, parseCellId) {
  const byId = cells.findIndex(cell => cell.id === cellId)
  if (byId !== -1) return byId
  return parseCellId(cellId) ?? -1
}

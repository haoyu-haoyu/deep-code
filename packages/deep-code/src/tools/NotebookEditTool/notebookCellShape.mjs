// Canonical cell-shape reconciliation for a NotebookEdit `replace`.
//
// A replace sets the new source and may also change the cell's type. The
// resulting cell MUST carry the canonical fields for its FINAL type — every
// nbformat v4 cell schema is additionalProperties:false, so each type forbids
// the other's exclusive fields. A code cell requires `execution_count`/`outputs`
// and forbids the markdown/raw-only `attachments`; a markdown cell forbids
// `execution_count`/`outputs`. The bug this fixes: the reset was gated on the
// cell's OLD type and ran BEFORE the type flip, so a code->markdown replace left
// stale `execution_count:null`/`outputs:[]` on the markdown cell, and a
// markdown->code replace produced a code cell MISSING the required fields — and,
// if the markdown cell embedded an image, still carrying the markdown-only
// `attachments` map. Either way a spec-invalid notebook that nbformat.validate()
// / nbconvert / papermill reject.
//
// Mutates `cell` in place (the call site holds a reference into notebook.cells)
// and returns it. Pure & node-testable.

/**
 * @param {{ cell_type: 'code'|'markdown', source?: unknown, execution_count?: unknown, outputs?: unknown, attachments?: unknown }} cell
 * @param {unknown} newSource the replacement source
 * @param {'code'|'markdown'|undefined} requestedType the edit's cell_type (defaults to the cell's current type)
 * @returns {object} the mutated cell
 */
export function applyReplacedCellShape(cell, newSource, requestedType) {
  cell.source = newSource
  // Default to the current type — a replace without a cell_type keeps it.
  const finalType = requestedType ?? cell.cell_type
  cell.cell_type = finalType
  if (finalType === 'code') {
    // The source changed, so any prior run is stale: reset to the unexecuted shape.
    cell.execution_count = null
    cell.outputs = []
    // `attachments` is a markdown/raw-only property — a code cell's schema
    // forbids it, so a (markdown|raw)->code replace must drop the stale map or
    // the notebook is nbformat-invalid.
    delete cell.attachments
  } else {
    // Markdown cells must not carry code-only fields. (`attachments` is legal on
    // markdown/raw, so it is intentionally preserved across this branch.)
    delete cell.execution_count
    delete cell.outputs
  }
  return cell
}

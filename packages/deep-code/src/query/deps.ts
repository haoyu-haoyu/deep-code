import { randomUUID } from 'crypto'
import { autoCompactIfNeeded } from '../services/compact/autoCompact.js'
import { microcompactMessages } from '../services/compact/microCompact.js'
import { createRuntimeCallModel } from '../services/runtime/messageSend.js'

// -- deps

// I/O dependencies for query(). Passing a `deps` override into QueryParams
// lets tests inject fakes directly instead of spyOn-per-module — the most
// common mocks (callModel, autocompact) are each spied in 6-8 test files
// today with module-import-and-spy boilerplate.
//
// callModel is typed by ReturnType<typeof createRuntimeCallModel> so the
// signature tracks the DeepSeek-native adapter automatically. Scope is
// intentionally narrow (4 deps) to prove the pattern.
export type QueryDeps = {
  // -- model
  callModel: ReturnType<typeof createRuntimeCallModel>

  // -- compaction
  microcompact: typeof microcompactMessages
  autocompact: typeof autoCompactIfNeeded

  // -- platform
  uuid: () => string
}

export function productionDeps(): QueryDeps {
  return {
    callModel: createRuntimeCallModel(),
    microcompact: microcompactMessages,
    autocompact: autoCompactIfNeeded,
    uuid: randomUUID,
  }
}

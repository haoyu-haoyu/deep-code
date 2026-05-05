export const DEFAULT_UPLOAD_CONCURRENCY = 4
export const FILE_COUNT_LIMIT = 100
export const OUTPUTS_SUBDIR = 'outputs'

export type TurnStartTime = number

export type PersistedFile = {
  filename: string
  file_id: string | undefined
}

export type FailedPersistence = {
  filename: string
  error: string | undefined
}

export type FilesPersistedEventData = {
  files: PersistedFile[]
  failed: FailedPersistence[]
}

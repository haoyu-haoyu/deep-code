// In its own file to avoid circular dependencies
export const FILE_EDIT_TOOL_NAME = 'Edit'

// Permission pattern for granting session-level access to the project's .deepcode/ folder
export const CLAUDE_FOLDER_PERMISSION_PATTERN = '/.deepcode/**'

// Permission pattern for granting session-level access to the global ~/.deepcode/ folder
export const GLOBAL_CLAUDE_FOLDER_PERMISSION_PATTERN = '~/.deepcode/**'

export const FILE_UNEXPECTEDLY_MODIFIED_ERROR =
  'File has been unexpectedly modified. Read it again before attempting to write it.'

import { mkdir, writeFile } from 'fs/promises'
import { dirname } from 'path'
import {
  getKeybindingsPath,
  isKeybindingCustomizationEnabled,
} from '../../keybindings/loadUserBindings.js'
import { generateKeybindingsTemplate } from '../../keybindings/template.js'
import { getMessage } from '../../i18n/index.js'
import { getErrnoCode } from '../../utils/errors.js'
import { editFileInEditor } from '../../utils/promptEditor.js'

export async function call(): Promise<{ type: 'text'; value: string }> {
  if (!isKeybindingCustomizationEnabled()) {
    return {
      type: 'text',
      value: getMessage('command.keybindings.notEnabled'),
    }
  }

  const keybindingsPath = getKeybindingsPath()

  // Write template with 'wx' flag (exclusive create) — fails with EEXIST if
  // the file already exists. Avoids a stat pre-check (TOCTOU race + extra syscall).
  let fileExists = false
  await mkdir(dirname(keybindingsPath), { recursive: true })
  try {
    await writeFile(keybindingsPath, generateKeybindingsTemplate(), {
      encoding: 'utf-8',
      flag: 'wx',
    })
  } catch (e: unknown) {
    if (getErrnoCode(e) === 'EEXIST') {
      fileExists = true
    } else {
      throw e
    }
  }

  // Open in editor
  const result = await editFileInEditor(keybindingsPath)
  if (result.error) {
    const action = fileExists
      ? getMessage('command.keybindings.action.opened')
      : getMessage('command.keybindings.action.created')
    return {
      type: 'text',
      value: getMessage('command.keybindings.editorError', {
        action,
        path: keybindingsPath,
        error: result.error,
      }),
    }
  }
  return {
    type: 'text',
    value: fileExists
      ? getMessage('command.keybindings.openedInEditor', {
          path: keybindingsPath,
        })
      : getMessage('command.keybindings.createdWithTemplate', {
          path: keybindingsPath,
        }),
  }
}

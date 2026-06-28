import { symlinkEscapesProject } from './importIsExternal.mjs'

/**
 * Markdown-config (commands / agents / skills / output-styles / workflows)
 * discovery follows symlinks: the native walker stat()-follows entries and the
 * ripGrep path runs with `--follow`. A committed in-project symlink whose OWN
 * path is inside the project (e.g. `.deepcode/commands/notes.md` -> `~/.ssh/id_rsa`)
 * is therefore discovered, then readFile() follows it and loads the EXTERNAL
 * target's bytes as the command/agent/skill body — content that flows into the
 * model context (and the API) with no Bash/Read permission prompt, exfiltrating
 * an arbitrary out-of-project file.
 *
 * This is the same committed-symlink bypass that {@link symlinkEscapesProject}
 * already closes for CLAUDE.md/DEEPCODE.md auto-loads and @-imports; the
 * markdown-config loader had no equivalent containment. We reuse the exact same
 * predicate so the boundary is defined identically.
 *
 * Scope (self-guarded by symlinkEscapesProject): a file is dropped ONLY when its
 * LEXICAL path is inside the project AND its symlink-resolved real path lies
 * OUTSIDE the project. Files whose lexical path is already outside the project
 * (managed/policy dir, user `~/.claude`, ancestor dirs) are intentionally loaded
 * and are NOT flagged. A within-project symlink (target still inside the project)
 * is NOT flagged. A broken/unresolvable symlink resolves back to the lexical path
 * (safeResolvePath returns it unchanged), so it is NOT flagged either.
 *
 * @param {string} filePath  the discovered (lexical, non-followed) markdown path
 * @param {(p: string) => string} resolveRealPath  symlink-resolved real path (lexical on failure)
 * @param {(p: string) => boolean} isInsideProject  pathInOriginalCwd
 * @returns {boolean} true if the file symlinks outside the project and must be skipped
 */
export function markdownFileEscapesProject(
  filePath,
  resolveRealPath,
  isInsideProject,
) {
  return symlinkEscapesProject(
    filePath,
    resolveRealPath(filePath),
    isInsideProject,
  )
}

/**
 * Filter a list of discovered markdown-config file paths, dropping any that are
 * in-project symlinks escaping the project (see {@link markdownFileEscapesProject}).
 * Order of the kept files is preserved.
 *
 * @param {string[]} files
 * @param {(p: string) => string} resolveRealPath
 * @param {(p: string) => boolean} isInsideProject
 * @param {(p: string) => void} [onSkip]  invoked once per dropped path (for logging)
 * @returns {string[]} the files that are safe to read
 */
export function filterProjectEscapingMarkdownFiles(
  files,
  resolveRealPath,
  isInsideProject,
  onSkip,
) {
  const kept = []
  for (const filePath of files) {
    if (markdownFileEscapesProject(filePath, resolveRealPath, isInsideProject)) {
      if (onSkip) onSkip(filePath)
      continue
    }
    kept.push(filePath)
  }
  return kept
}

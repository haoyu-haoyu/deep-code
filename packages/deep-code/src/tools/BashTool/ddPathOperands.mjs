/**
 * `dd` does not use dash-flags; it takes `key=value` operands. Its FILE operands
 * are `if=<read source>` and `of=<write target>` (everything else — `bs=`,
 * `count=`, `conv=`, `seek=`, ... — is a non-path value). The generic
 * filterOutFlags extractor cannot handle these: a bare `of=/etc/cron.d/evil`
 * has no leading dash so it would be passed to the path validator verbatim
 * (with the `of=` prefix and an `=`, which the validator special-cases), and
 * the real write target would never be confined. Pull the file operands
 * explicitly so `dd of=<path>` is validated like any other write.
 *
 * Both `if=` (read) and `of=` (write) targets are returned so an out-of-dir
 * READ source is also surfaced; the command's operation type governs the
 * read/write sensitivity of the check.
 *
 * Pure: argv in, path strings out.
 *
 * @param {string[]} args  the tokens after `dd`
 * @returns {string[]} the if=/of= file operands (values only), in order
 */
export function extractDdPathOperands(args) {
  const paths = []
  for (const arg of args) {
    if (typeof arg !== 'string') continue
    const m = /^(?:if|of)=(.+)$/.exec(arg)
    if (m) {
      paths.push(m[1])
    }
  }
  return paths
}

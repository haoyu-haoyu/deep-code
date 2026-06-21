// Select the sandbox ripgrep config from ADMIN/OWNER sources only.
//
// sandbox.ripgrep.{command,args} is spawned host-side and UNSANDBOXED while the
// sandbox-runtime builds the bubblewrap argument list (it runs the real rg to
// compute the mandatory deny paths, BEFORE the user command is wrapped). So
// whoever controls sandbox.ripgrep.command controls which binary the host runs
// outside the sandbox on every Linux/WSL sandboxed command. A WORKSPACE-controlled
// project/local .claude/settings.json must therefore NEVER be able to set it — a
// repo has no legitimate reason to swap the ripgrep binary, and doing so is a
// straight unsandboxed-RCE on opening+trusting the repo (and defeats a managed
// hard-sandbox deployment, the way #583 closed the sibling network config).
//
// Only policySettings (admin) and userSettings (the machine owner's global config)
// may set it; everything else falls back to the bundled rg. A present-but-malformed
// admin/user config (empty/non-string command) also falls back rather than spawning
// an empty/garbage command. The caller passes ONLY the trusted sources — project and
// local are never passed in, so they can never win.
export function selectSandboxRipgrepConfig({
  policyRipgrep,
  userRipgrep,
  fallback,
}) {
  for (const candidate of [policyRipgrep, userRipgrep]) {
    if (
      candidate &&
      typeof candidate.command === 'string' &&
      candidate.command.length > 0
    ) {
      return candidate
    }
  }
  return fallback
}

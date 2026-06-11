// Mouse-wheel / trackpad scroll-acceleration state machine, extracted VERBATIM from
// ScrollKeybindingHandler.tsx so this intricate, tuning-heavy logic is unit-testable under
// `node --test` (it was `export`ed "for tests" but trapped in a .tsx the test runner can't
// load). The component imports computeWheelStep / initWheelAccel / readScrollSpeedBase from
// here and stays a thin event handler. The constants + algorithm are unchanged.
//
// @typedef {Object} WheelAccelState
// @property {number} time  last event (or deferred-flip) timestamp
// @property {number} mult  current rows-per-event multiplier
// @property {0|1|-1} dir   last committed scroll direction
// @property {boolean} xtermJs  true → the VS Code/browser decay path; false → native
// @property {number} frac  carried fractional scroll (xterm.js only)
// @property {number} base  native-path baseline rows/event (reset value)
// @property {boolean} pendingFlip  a direction flip deferred for bounce detection (native)
// @property {boolean} wheelMode    sticky: a confirmed encoder bounce proved a mouse
// @property {number} burstCount    consecutive <5ms events (trackpad-flick signature)

// Native terminals: hard-window linear ramp. Events closer than the window ramp the
// multiplier; idle gaps reset to `base` (default 1). Some emulators pre-multiply at their
// layer (ghostty discrete=3 sends 3 SGR events/notch; iTerm2 "faster scroll" similar) —
// base=1 is correct there. Others send 1 event/notch — users on those can set the
// scroll-speed env var to 3 to match vim/nvim/opencode app-side defaults; we can't detect
// which, so knob it.
const WHEEL_ACCEL_WINDOW_MS = 40
const WHEEL_ACCEL_STEP = 0.3
const WHEEL_ACCEL_MAX = 6

// Encoder bounce debounce + wheel-mode decay curve. Worn/cheap optical
// encoders emit spurious reverse-direction ticks during fast spins — measured
// 28% of events on Boris's mouse (2026-03-17, iTerm2). Pattern is always
// flip-then-flip-back; trackpads produce ZERO flips (0/458 in same recording).
// A confirmed bounce proves a physical wheel is attached — engage the same
// exponential-decay curve the xterm.js path uses (it's already tuned), with
// a higher cap to compensate for the lower event rate (~9/sec vs VS Code's
// ~30/sec). Trackpad can't reach this path.
//
// The decay curve gives: 1st click after idle = 1 row (precision), 2nd = 10,
// 3rd = cap. Slowing down decays smoothly toward 1 — no separate idle
// threshold needed, large gaps just have m≈0 → mult→1. Wheel mode is STICKY:
// once a bounce confirms it's a mouse, the decay curve applies until an idle
// gap or trackpad-flick-burst signals a possible device switch.
const WHEEL_BOUNCE_GAP_MAX_MS = 200 // flip-back must arrive within this
// Mouse is ~9 events/sec vs VS Code's ~30 — STEP is 3× xterm.js's 5 to
// compensate. At gap=100ms (m≈0.63): one click gives 1+15*0.63≈10.5.
const WHEEL_MODE_STEP = 15
const WHEEL_MODE_CAP = 15
// Max mult growth per event. Without this, the +STEP*m term jumps mult
// from 1→10 in one event when wheelMode engages mid-scroll (bounce
// detected after N events in trackpad mode at mult=1). User sees scroll
// suddenly go 10× faster. Cap=3 gives 1→4→7→10→13→15 over ~0.5s at
// 9 events/sec — smooth ramp instead of a jump. Decay is unaffected
// (target<mult wins the min).
const WHEEL_MODE_RAMP = 3
// Device-switch disengage: mouse finger-repositions max at ~830ms (measured);
// trackpad between-gesture pauses are 2000ms+. An idle gap above this means
// the user stopped — might have switched devices. Disengage; the next mouse
// bounce re-engages. Trackpad slow swipe (no <5ms bursts, so the burst-count
// guard doesn't catch it) is what this protects against.
const WHEEL_MODE_IDLE_DISENGAGE_MS = 1500

// xterm.js: exponential decay. momentum=0.5^(gap/hl) — slow click → m≈0
// → mult→1 (precision); fast → m≈1 → carries momentum. Steady-state
// = 1 + step×m/(1-m), capped. Measured event rates in VS Code (wheel.log):
// sustained scroll sends events at 20-50ms gaps (20-40 Hz), plus 0-2ms
// same-batch bursts on flicks. Cap is low (3–6, gap-dependent) because event
// frequency is high — at 40 Hz × 6 = 240 rows/sec max demand, which the
// adaptive drain at ~200fps (measured) handles. Higher cap → pending explosion.
// Tuned empirically (boris 2026-03). See docs/research/terminal-scroll-*.
const WHEEL_DECAY_HALFLIFE_MS = 150
const WHEEL_DECAY_STEP = 5
// Same-batch events (<BURST_MS) arrive in one stdin batch — the terminal
// is doing proportional reporting. Treat as 1 row/event like native.
const WHEEL_BURST_MS = 5
// Cap boundary: slow events (≥GAP_MS) cap low for short smooth drains;
// fast events cap higher for throughput (adaptive drain handles backlog).
const WHEEL_DECAY_GAP_MS = 80
const WHEEL_DECAY_CAP_SLOW = 3 // gap ≥ GAP_MS: precision
const WHEEL_DECAY_CAP_FAST = 6 // gap < GAP_MS: throughput
// Idle threshold: gaps beyond this reset to the kick value (2) so the
// first click after a pause feels responsive regardless of direction.
const WHEEL_DECAY_IDLE_MS = 500

/** Compute rows for one wheel event, mutating accel state. Returns 0 when
 *  a direction flip is deferred for bounce detection — call sites no-op on
 *  step=0 (scrollBy(0) is a no-op, onScroll(false) is idempotent).
 *  @param {WheelAccelState} state @param {1|-1} dir @param {number} now @returns {number} */
export function computeWheelStep(state, dir, now) {
  if (!state.xtermJs) {
    // Device-switch guard ①: idle disengage. Runs BEFORE pendingFlip resolve
    // so a pending bounce (28% of last-mouse-events) doesn't bypass it via
    // the real-reversal early return. state.time is either the last committed
    // event OR the deferred flip — both count as "last activity".
    if (state.wheelMode && now - state.time > WHEEL_MODE_IDLE_DISENGAGE_MS) {
      state.wheelMode = false
      state.burstCount = 0
      state.mult = state.base
    }

    // Resolve any deferred flip BEFORE touching state.time/dir — we need the
    // pre-flip state.dir to distinguish bounce (flip-back) from real reversal
    // (flip persisted), and state.time (= bounce timestamp) for the gap check.
    if (state.pendingFlip) {
      state.pendingFlip = false
      if (dir !== state.dir || now - state.time > WHEEL_BOUNCE_GAP_MAX_MS) {
        // Real reversal: new dir persisted, OR flip-back arrived too late.
        // Commit. The deferred event's 1 row is lost (acceptable latency).
        state.dir = dir
        state.time = now
        state.mult = state.base
        return Math.floor(state.mult)
      }
      // Bounce confirmed: flipped back to original dir within the window.
      // state.dir/mult unchanged from pre-bounce. state.time was advanced to
      // the bounce below, so gap here = flip-back interval — reflects the
      // user's actual click cadence (bounce IS a physical click, just noisy).
      state.wheelMode = true
    }
    const gap = now - state.time
    if (dir !== state.dir && state.dir !== 0) {
      // Flip. Defer — next event decides bounce vs. real reversal. Advance
      // time (but NOT dir/mult): if this turns out to be a bounce, the
      // confirm event's gap will be the flip-back interval, which reflects
      // the user's actual click rate. The bounce IS a physical wheel click,
      // just misread by the encoder — it should count toward cadence.
      state.pendingFlip = true
      state.time = now
      return 0
    }
    state.dir = dir
    state.time = now

    // ─── MOUSE (wheel mode, sticky until device-switch signal) ───
    if (state.wheelMode) {
      if (gap < WHEEL_BURST_MS) {
        // Same-batch burst check (ported from xterm.js): iTerm2 proportional
        // reporting sends 2+ SGR events for one detent when macOS gives
        // delta>1. Without this, the 2nd event at gap<1ms has m≈1 → STEP*m=15
        // → one gentle click gives 1+15=16 rows.
        //
        // Device-switch guard ②: trackpad flick produces 100+ events at <5ms
        // (measured); mouse produces ≤3. 5+ consecutive → trackpad flick.
        if (++state.burstCount >= 5) {
          state.wheelMode = false
          state.burstCount = 0
          state.mult = state.base
        } else {
          return 1
        }
      } else {
        state.burstCount = 0
      }
    }
    // Re-check: may have disengaged above.
    if (state.wheelMode) {
      // xterm.js decay curve with STEP×3, higher cap. No idle threshold —
      // the curve handles it (gap=1000ms → m≈0.01 → mult≈1). No frac —
      // rounding loss is minor at high mult, and frac persisting across idle
      // was causing off-by-one on the first click back.
      const m = Math.pow(0.5, gap / WHEEL_DECAY_HALFLIFE_MS)
      const cap = Math.max(WHEEL_MODE_CAP, state.base * 2)
      const next = 1 + (state.mult - 1) * m + WHEEL_MODE_STEP * m
      state.mult = Math.min(cap, next, state.mult + WHEEL_MODE_RAMP)
      return Math.floor(state.mult)
    }

    // ─── TRACKPAD / HI-RES (native, non-wheel-mode) ───
    // Tight 40ms burst window: sub-40ms events ramp, anything slower resets.
    // Trackpad flick delivers 200+ events at <20ms gaps → rails to cap 6.
    // Trackpad slow swipe at 40-400ms gaps → resets every event → 1 row each.
    if (gap > WHEEL_ACCEL_WINDOW_MS) {
      state.mult = state.base
    } else {
      const cap = Math.max(WHEEL_ACCEL_MAX, state.base * 2)
      state.mult = Math.min(cap, state.mult + WHEEL_ACCEL_STEP)
    }
    return Math.floor(state.mult)
  }

  // ─── VSCODE (xterm.js, browser wheel events) ───
  // Browser wheel events — no encoder bounce, no SGR bursts. Decay curve
  // unchanged from the original tuning. Same formula shape as wheel mode
  // above (keep in sync) but STEP=5 not 15 — higher event rate here.
  const gap = now - state.time
  const sameDir = dir === state.dir
  state.time = now
  state.dir = dir
  // xterm.js path. Debug log shows two patterns: (a) 20-50ms gaps during
  // sustained scroll (~30 Hz), (b) <5ms same-batch bursts on flicks. For
  // (b) give 1 row/event — the burst count IS the acceleration, same as
  // native. For (a) the decay curve gives 3-5 rows. For sparse events
  // (100ms+, slow deliberate scroll) the curve gives 1-3.
  if (sameDir && gap < WHEEL_BURST_MS) return 1
  if (!sameDir || gap > WHEEL_DECAY_IDLE_MS) {
    // Direction reversal or long idle: start at 2 (not 1) so the first
    // click after a pause moves a visible amount. Without this, idle-
    // then-resume in the same direction decays to mult≈1 (1 row).
    state.mult = 2
    state.frac = 0
  } else {
    const m = Math.pow(0.5, gap / WHEEL_DECAY_HALFLIFE_MS)
    const cap = gap >= WHEEL_DECAY_GAP_MS ? WHEEL_DECAY_CAP_SLOW : WHEEL_DECAY_CAP_FAST
    state.mult = Math.min(cap, 1 + (state.mult - 1) * m + WHEEL_DECAY_STEP * m)
  }
  const total = state.mult + state.frac
  const rows = Math.floor(total)
  state.frac = total - rows
  return rows
}

/** Read the scroll-speed env var, default 1, clamp (0, 20].
 *  Some terminals pre-multiply wheel events (ghostty discrete=3, iTerm2
 *  "faster scroll") — base=1 is correct there. Others send 1 event/notch —
 *  set the scroll-speed env var to 3 to match vim/nvim/opencode. We can't
 *  detect which kind of terminal we're in, hence the knob. Called lazily
 *  from initAndLogWheelAccel so globalSettings.env has loaded.
 *  @returns {number} */
export function readScrollSpeedBase() {
  const raw = process.env.CLAUDE_CODE_SCROLL_SPEED
  if (!raw) return 1
  const n = parseFloat(raw)
  return Number.isNaN(n) || n <= 0 ? 1 : Math.min(n, 20)
}

/** Initial wheel accel state. xtermJs=true selects the decay curve.
 *  base is the native-path baseline rows/event (default 1).
 *  @param {boolean} [xtermJs] @param {number} [base] @returns {WheelAccelState} */
export function initWheelAccel(xtermJs = false, base = 1) {
  return {
    time: 0,
    mult: base,
    dir: 0,
    xtermJs,
    frac: 0,
    base,
    pendingFlip: false,
    wheelMode: false,
    burstCount: 0,
  }
}

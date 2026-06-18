// Ambient declarations so the tsc typecheck gate can resolve bundler/runtime-only
// imports that aren't real TypeScript modules. These are virtual modules provided
// by the Bun bundler or non-code assets; the runtime build handles them, but tsc
// (used only as a type gate, never to emit) needs a shape to resolve against.
declare module 'bun:bundle'
declare module '*.md' {
  const content: string
  export default content
}
// Bun global — referenced for runtime feature detection (typeof Bun !== 'undefined').
// @types/bun isn't vendored; a loose ambient keeps the gate from flagging it.
declare const Bun: any

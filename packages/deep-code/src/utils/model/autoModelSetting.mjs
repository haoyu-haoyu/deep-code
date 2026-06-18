// The DeepSeek 'auto' routing sentinel, shared by the node-loadable .mjs provider
// and runtime leaves. The canonical typed definition lives in
// src/utils/model/model.ts (AUTO_MODEL_SETTING + isAutoModelSetting with a type
// predicate); that file is .ts and cannot be imported by the .mjs request path, so
// this leaf mirrors it (the previous mirror was inlined in deepseek-call-model.mjs).
//
// 'auto' selects per-turn flash/pro routing; it is NEVER a literal model name on the
// wire. resolveDeepSeekConfig maps it to a concrete default so a stray 'auto' (a
// caller, a DEEPSEEK_MODEL=auto env, or a config file) can never reach body.model
// as a phantom model.
export const AUTO_MODEL_SETTING = 'auto'

export function isAutoModelSetting(model) {
  return (
    typeof model === 'string' &&
    model.trim().toLowerCase() === AUTO_MODEL_SETTING
  )
}

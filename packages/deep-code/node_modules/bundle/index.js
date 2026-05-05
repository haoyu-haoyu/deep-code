const enabledFeatures = new Set(
  String(process.env.DEEPCODE_FEATURES ?? '')
    .split(',')
    .map(feature => feature.trim())
    .filter(Boolean),
)

export function feature(name) {
  return enabledFeatures.has(name)
}

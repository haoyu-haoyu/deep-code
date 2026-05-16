export function isBilledAsExtraUsage(
  _model: string | null,
  _isFastMode: boolean,
  _isOpus1mMerged: boolean,
): boolean {
  // DeepCode is not a Claude.ai subscriber; no extra-usage billing applies.
  return false
}

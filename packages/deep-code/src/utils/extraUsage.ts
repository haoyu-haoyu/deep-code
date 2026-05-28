export function isBilledAsExtraUsage(
  _model: string | null,
  _isFastMode: boolean,
  _isOpus1mMerged: boolean,
): boolean {
  // DeepCode does not use legacy web-subscriber billing.
  return false
}

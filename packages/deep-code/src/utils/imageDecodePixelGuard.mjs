// Would decoding an image of these raster dimensions exceed the pixel budget?
//
// maybeResizeAndDownsampleImageBuffer reads the (cheap, header-only) metadata to get
// width/height, then runs sharp `.resize().toBuffer()` — a FULL decode of the
// original image to raw RGBA pixels (≈ width × height × 4 bytes). A small compressed
// payload can declare enormous raster dimensions (a decompression / "pixel-flood"
// bomb: e.g. a few-KB near-solid-color PNG at 30000×30000 ≈ 900 megapixels ≈ 3.6 GB
// raw), so an attacker-supplied image (an MCP block or a model-read repo file) could
// OOM the client even though the per-image-resize and #592 count/concurrency caps
// don't bound a SINGLE decode. Checking width × height against an explicit budget on
// the metadata — BEFORE the decode — bounds each decode and is processor-agnostic
// (covers both the sharp and the bundled native image processor, whose own pixel
// limit is unverified), unlike relying on sharp's implicit ~268 Mpx default.
//
// Non-finite / non-positive dimensions return false so the normal
// missing-dimensions path handles them. Pure value-in/value-out, node-testable.
export function exceedsDecodePixelBudget(width, height, maxPixels) {
  if (!Number.isFinite(width) || !Number.isFinite(height)) return false
  if (width <= 0 || height <= 0) return false
  // width*height can lose precision past 2^53 for absurd dims, but the product is
  // still vastly greater than any sane maxPixels, so the comparison stays correct.
  return width * height > maxPixels
}

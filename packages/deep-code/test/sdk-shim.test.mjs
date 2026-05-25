import { describe, expect, test } from 'bun:test'

describe('local SDK shim scaffolding', () => {
  test('runtime errors preserve the SDK-compatible inheritance chain', async () => {
    const {
      APIConnectionError,
      APIError,
      APIUserAbortError,
      AuthenticationError,
      NotFoundError,
    } = await import('../src/utils/sdkErrors.ts')

    const abortError = new APIUserAbortError()
    expect(abortError).toBeInstanceOf(APIError)
    expect(abortError).toBeInstanceOf(APIUserAbortError)
    expect(abortError.message).toBe('Request was aborted.')

    const rateLimitError = new APIError(
      429,
      { error: { type: 'rate_limit_error' } },
      'rate limited',
      { 'retry-after': '10' },
    )
    expect(rateLimitError.status).toBe(429)
    expect(rateLimitError.error).toEqual({
      error: { type: 'rate_limit_error' },
    })
    expect(rateLimitError.headers).toEqual({ 'retry-after': '10' })

    expect(new NotFoundError({}, 'missing')).toBeInstanceOf(APIError)
    expect(new AuthenticationError({}, 'denied')).toBeInstanceOf(APIError)
    expect(new APIConnectionError({ message: 'offline' })).toBeInstanceOf(
      APIError,
    )
  })

  test('type shim module is self-contained at runtime', async () => {
    await expect(import('../src/types/sdk-shim.ts')).resolves.toBeDefined()
  })
})

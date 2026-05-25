/**
 * P1.8.0 local SDK runtime error shim scaffold.
 *
 * P1_8_DESIGN.md Q3 chooses local classes so future migrations preserve stable
 * instanceof behavior without importing or re-exporting the upstream SDK package.
 */

export type APIErrorHeaders = Record<string, string> | globalThis.Headers

export class APIError extends Error {
  readonly status: number | undefined
  readonly error: unknown
  readonly headers: APIErrorHeaders | undefined

  constructor(
    status: number | undefined,
    error: unknown,
    message: string | undefined,
    headers: APIErrorHeaders | undefined,
  ) {
    super(message)
    this.name = 'APIError'
    this.status = status
    this.error = error
    this.headers = headers
  }
}

export class APIUserAbortError extends APIError {
  constructor(message: string = 'Request was aborted.') {
    super(undefined, undefined, message, undefined)
    this.name = 'APIUserAbortError'
  }
}

export class APIConnectionError extends APIError {
  constructor({ message, cause }: { message?: string; cause?: unknown } = {}) {
    super(undefined, undefined, message ?? 'Connection error.', undefined)
    this.name = 'APIConnectionError'
    if (cause !== undefined) {
      ;(this as Error & { cause?: unknown }).cause = cause
    }
  }
}

export class AuthenticationError extends APIError {
  constructor(
    error: unknown,
    message?: string,
    headers?: APIErrorHeaders,
  ) {
    super(401, error, message, headers)
    this.name = 'AuthenticationError'
  }
}

export class NotFoundError extends APIError {
  constructor(
    error: unknown,
    message?: string,
    headers?: APIErrorHeaders,
  ) {
    super(404, error, message, headers)
    this.name = 'NotFoundError'
  }
}

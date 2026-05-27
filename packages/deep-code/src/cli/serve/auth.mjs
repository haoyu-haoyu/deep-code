import { timingSafeEqual } from 'node:crypto'

export function validateBearerToken(req, { env = process.env } = {}) {
  const expectedToken = env.DEEPCODE_HTTP_TOKEN
  if (!expectedToken) return false

  const actualToken = readBearerToken(req)
  if (!actualToken) return false

  return timingSafeTokenEquals(actualToken, expectedToken)
}

export function writeUnauthorized(res) {
  writeJson(res, 401, { error: 'unauthorized' }, {
    'WWW-Authenticate': 'Bearer',
  })
}

export function readBearerToken(req) {
  const authorization = req.headers.authorization
  if (typeof authorization !== 'string') return null
  if (!authorization.startsWith('Bearer ')) return null

  const token = authorization.slice('Bearer '.length)
  return token.length > 0 ? token : null
}

export function timingSafeTokenEquals(actualToken, expectedToken) {
  const actual = Buffer.from(actualToken)
  const expected = Buffer.from(expectedToken)

  if (actual.length !== expected.length) {
    const length = Math.max(actual.length, expected.length)
    const paddedActual = Buffer.alloc(length)
    const paddedExpected = Buffer.alloc(length)
    actual.copy(paddedActual)
    expected.copy(paddedExpected)
    timingSafeEqual(paddedActual, paddedExpected)
    return false
  }

  return timingSafeEqual(actual, expected)
}

export function writeJson(res, statusCode, body, headers = {}) {
  const payload = JSON.stringify(body)
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    ...headers,
  })
  res.end(payload)
}

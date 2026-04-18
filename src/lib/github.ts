import crypto from 'node:crypto'

/**
 * Normalize any GitHub repo reference to canonical `owner/repo` (lowercase).
 * Accepts: https URL, git SSH, plain "owner/repo", trailing .git, trailing slash.
 * Returns null if the input doesn't look like a GitHub repo.
 */
export function normalizeGithubRepo(input: string | null | undefined): string | null {
  if (!input) return null
  let s = input.trim()
  if (!s) return null
  s = s.replace(/\.git$/i, '').replace(/\/+$/, '')
  const httpsMatch = s.match(/^https?:\/\/(?:www\.)?github\.com\/([^/]+)\/([^/?#]+)/i)
  if (httpsMatch) return `${httpsMatch[1]}/${httpsMatch[2]}`.toLowerCase()
  const sshMatch = s.match(/^git@github\.com:([^/]+)\/([^/?#]+)/i)
  if (sshMatch) return `${sshMatch[1]}/${sshMatch[2]}`.toLowerCase()
  const plainMatch = s.match(/^([A-Za-z0-9][A-Za-z0-9-_.]*)\/([A-Za-z0-9][A-Za-z0-9-_.]*)$/)
  if (plainMatch) return `${plainMatch[1]}/${plainMatch[2]}`.toLowerCase()
  return null
}

export function verifyGithubSignature(rawBody: string, signatureHeader: string | null, secret: string): boolean {
  if (!signatureHeader || !secret) return false
  const expected = `sha256=${crypto.createHmac('sha256', secret).update(rawBody).digest('hex')}`
  const a = Buffer.from(signatureHeader)
  const b = Buffer.from(expected)
  if (a.length !== b.length) return false
  try {
    return crypto.timingSafeEqual(a, b)
  } catch {
    return false
  }
}

import crypto from 'node:crypto'
import { prisma } from './db'

export function generateWebhookToken(): { raw: string; hash: string; prefix: string } {
  const raw = 'pmw_' + crypto.randomBytes(32).toString('base64url')
  const hash = hashToken(raw)
  const prefix = raw.slice(0, 12)
  return { raw, hash, prefix }
}

export function hashToken(raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex')
}

export type WebhookTokenVerifyResult =
  | { ok: true; tokenId: string | null }
  | { ok: false; reason: 'unauthorized' | 'disabled' | 'revoked' | 'expired'; tokenId: string | null }

export async function verifyWebhookToken(raw: string, envFallback: string): Promise<WebhookTokenVerifyResult> {
  if (!raw) return { ok: false, reason: 'unauthorized', tokenId: null }

  const hash = hashToken(raw)
  const token = await prisma.webhookToken.findUnique({ where: { tokenHash: hash } })

  if (token) {
    if (token.status === 'REVOKED') return { ok: false, reason: 'revoked', tokenId: token.id }
    if (token.status === 'DISABLED') return { ok: false, reason: 'disabled', tokenId: token.id }
    if (token.expiresAt && token.expiresAt.getTime() <= Date.now())
      return { ok: false, reason: 'expired', tokenId: token.id }
    await prisma.webhookToken.update({ where: { id: token.id }, data: { lastUsedAt: new Date() } })
    return { ok: true, tokenId: token.id }
  }

  if (envFallback && raw === envFallback) return { ok: true, tokenId: null }
  return { ok: false, reason: 'unauthorized', tokenId: null }
}

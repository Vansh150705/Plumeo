import nodemailer from 'nodemailer';
import type { Tx } from '../db/pool';
import type { Ctx } from '../core/context';
import { config } from '../core/config';

export interface MailMessage { to: string; subject: string; text: string; html?: string }
export type Transport = { sendMail: (m: any) => Promise<unknown> };

let override: Transport | null = null;
let cached: Transport | null | undefined;

/** Test hook: inject a fake transport. */
export function setMailTransportForTests(t: Transport | null) { override = t; }

export function mailEnabled(): boolean { return !!override || !!config().SMTP_URL; }

function transport(): Transport | null {
  if (override) return override;
  if (cached === undefined) cached = config().SMTP_URL ? nodemailer.createTransport(config().SMTP_URL!) : null;
  return cached;
}

export async function sendMail(m: MailMessage) {
  const t = transport();
  if (!t) throw new Error('SMTP is not configured');
  await t.sendMail({ from: config().SMTP_FROM, to: m.to, subject: m.subject, text: m.text, html: m.html });
}

export const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

/** Queue an invitation / reset email through the same outbox as notifications (retried, status-tracked). */
export async function sendInviteEmail(tx: Tx, ctx: Ctx, a: { userId: string; email: string; name: string; token: string; reset?: boolean }) {
  if (!mailEnabled()) return;
  const url = `${config().APP_URL}/accept-invite?token=${a.token}`;
  await tx.exec(
    `insert into notification_deliveries (org_id, channel, user_id, payload, dedupe_key) values ($1,'email',$2,$3,$4) on conflict do nothing`,
    [ctx.orgId, a.userId, JSON.stringify({
      subject: a.reset ? 'Reset your Plumeo password' : 'You have been invited to Plumeo',
      text: `Hi ${a.name},\n\n${a.reset ? 'Use the link below to choose a new password.' : 'Use the link below to set your password and get started.'}\n\n${url}\n\nThis link expires and can only be used once.`,
      sensitive: true,
    }), `invite:${a.userId}:${a.token.slice(0, 8)}`]);
}

// send-email: Supabase Auth "Send Email" hook that delivers mail through Resend.
//
// Supabase signs the payload with the hook secret; the function verifies that
// signature before sending. The Resend key and hook secret live only in the
// function environment. Nothing here logs an address or a token.
//
// Emails carry the 6-digit code (`email_data.token`) the app verifies with
// `verifyOtp`. There is no link: a browser redirect to a custom scheme is
// unreliable, and entering the code keeps the whole flow inside Viby.

import { Webhook } from 'https://esm.sh/standardwebhooks@1.0.0'

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? ''
const HOOK_SECRET = (Deno.env.get('SEND_EMAIL_HOOK_SECRET') ?? '').replace(/^v1,whsec_/, '')
// ondavi.space is verified in Resend; the onboarding address only reaches the
// Resend account's own mailbox, so it must never be the default in production.
const FROM = Deno.env.get('RESEND_FROM') ?? 'Viby <welcome@ondavi.space>'

type EmailData = {
  token: string
  token_hash: string
  redirect_to: string
  email_action_type: string
  site_url: string
}

type Payload = { user: { email: string }; email_data: EmailData }

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  })
}

function subjectFor(type: string): string {
  switch (type) {
    case 'signup':
      return 'Your Viby confirmation code'
    case 'magiclink':
      return 'Your Viby sign-in code'
    case 'recovery':
      return 'Your Viby password reset code'
    case 'invite':
      return "You're invited to Viby"
    case 'email_change':
      return 'Confirm your new Viby email'
    default:
      return 'Your Viby code'
  }
}

function copyFor(type: string): { lead: string; note: string } {
  switch (type) {
    case 'signup':
      return {
        lead: 'Enter this code in Viby to finish creating your account.',
        note: 'If you did not create a Viby account, you can ignore this message.'
      }
    case 'magiclink':
      return {
        lead: 'Enter this code in Viby to sign in.',
        note: 'If you did not ask for this code, you can ignore this message.'
      }
    case 'recovery':
      return {
        lead: 'Enter this code in Viby to choose a new password.',
        note: 'If you did not ask to reset your password, you can ignore this message.'
      }
    case 'invite':
      return {
        lead: 'Enter this code in Viby to accept the invitation.',
        note: 'If you were not expecting this, you can ignore this message.'
      }
    case 'email_change':
      return {
        lead: 'Enter this code in Viby to confirm your new email address.',
        note: 'If you did not request this change, ignore this message.'
      }
    default:
      return {
        lead: 'Enter this code in Viby to finish the requested action.',
        note: 'If you were not expecting this message, you can ignore it.'
      }
  }
}

function render(type: string, code: string): { html: string; text: string } {
  const copy = copyFor(type)
  const html = `
    <div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:520px;margin:0 auto;padding:28px 24px;color:#111">
      <h1 style="font-size:20px;margin:0 0 12px">Viby</h1>
      <p style="font-size:14px;line-height:1.6;margin:0 0 20px">${copy.lead}</p>
      <p style="margin:0 0 8px;font-size:32px;font-weight:650;letter-spacing:8px">${code}</p>
      <p style="font-size:12px;line-height:1.6;color:#666;margin:0 0 10px">The code expires shortly and can be used once.</p>
      <p style="font-size:12px;line-height:1.6;color:#666;margin:0">${copy.note}</p>
    </div>`
  const text = `${copy.lead}\n\n${code}\n\nThe code expires shortly and can be used once.\n\n${copy.note}`
  return { html, text }
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response('ok')
  if (req.method !== 'POST') return json({ error: 'method-not-allowed' }, 405)

  if (!RESEND_API_KEY || !HOOK_SECRET) {
    return json({ error: 'email-function-not-configured' }, 500)
  }

  const payload = await req.text()
  const headers = Object.fromEntries(req.headers)
  let data: Payload
  try {
    data = new Webhook(HOOK_SECRET).verify(payload, headers) as Payload
  } catch {
    return json({ error: 'invalid-signature' }, 401)
  }

  const email = data?.user?.email
  const emailData = data?.email_data
  if (!email || !emailData) return json({ error: 'invalid-payload' }, 400)
  if (!emailData.token) return json({ error: 'missing-code' }, 400)

  const { html, text } = render(emailData.email_action_type, emailData.token)

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: FROM,
      to: [email],
      subject: subjectFor(emailData.email_action_type),
      html,
      text
    })
  })

  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    console.error('resend rejected the email', response.status, detail.slice(0, 200))
    return json({ error: 'email-send-failed' }, 502)
  }

  return json({}, 200)
})

'use strict';

const config = require('./config');

/**
 * Transactional email. When RESEND_API_KEY is set it sends via Resend; otherwise
 * it runs in sandbox: logs the message and returns the link so flows still work
 * end-to-end. Swap the provider here without touching callers.
 */
async function send({ to, subject, html, text }) {
  if (!to) return { ok: false, sandbox: true };
  if (!config.RESEND_API_KEY) {
    console.log(`[email:sandbox] to=${to} subject="${subject}"`);
    return { ok: true, sandbox: true };
  }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: config.EMAIL_FROM, to, subject, html, text }),
    });
    return { ok: res.ok, sandbox: false };
  } catch (e) {
    console.error('[email] send failed:', e.message);
    return { ok: false, error: e.message };
  }
}

function layout(title, body) {
  return `<div style="font-family:Inter,system-ui,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#0B1424">
    <div style="font-weight:700;font-size:20px;color:#0FB877">Transfado</div>
    <h1 style="font-size:22px;margin:18px 0 8px">${title}</h1>
    ${body}
    <p style="color:#8593AC;font-size:12px;margin-top:28px">Transfado — the new way to get paid. Sandbox environment.</p>
  </div>`;
}

function welcome(to, name) {
  return send({ to, subject: 'Welcome to Transfado', html: layout('Welcome aboard 🎉', `<p>Hi ${name || 'there'}, your Transfado account is ready. Sign in to take your first payment, create a payment link, and grab your API keys.</p><p><a href="https://transfado.com/dashboard" style="color:#0FB877">Open your dashboard →</a></p>`) });
}
function verifyEmail(to, link) {
  return send({ to, subject: 'Verify your email', html: layout('Confirm your email', `<p>Confirm this address to finish setting up your Transfado account:</p><p><a href="${link}" style="color:#0FB877">Verify email →</a></p><p style="color:#8593AC;font-size:13px">${link}</p>`) });
}
function passwordReset(to, link) {
  return send({ to, subject: 'Reset your password', html: layout('Reset your password', `<p>Click below to choose a new password. This link expires in 1 hour. If you didn't request it, ignore this email.</p><p><a href="${link}" style="color:#0FB877">Reset password →</a></p><p style="color:#8593AC;font-size:13px">${link}</p>`) });
}

module.exports = { send, welcome, verifyEmail, passwordReset };

/**
 * Swanson Worx — booking-request API (Cloudflare Worker)
 *
 * Flow:  static site (GitHub Pages)  ->  this Worker (POST /v1/bookings)  ->  Supabase (service-role insert)  ->  Resend emails.
 *
 * This records a booking REQUEST only. It never confirms a booking.
 * No Twilio / SMS / Google Calendar / CRM / authentication / confirmed-booking logic.
 */

export interface Env {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;

  BOOKING_NOTIFICATION_EMAIL: string;

  MGRNZ_SMTP_HOST: string;
  MGRNZ_SMTP_PORT: string;
  MGRNZ_SMTP_USERNAME: string;
  MGRNZ_SMTP_PASSWORD: string;

  ALLOWED_ORIGINS: string;

  BOOKINGS_KV?: KVNamespace;
}

const MAX_BODY_BYTES = 16 * 1024; // 16 KB payload cap
const RATE_LIMIT_MAX = 8; // max requests per window per IP (only enforced when KV is bound)
const RATE_LIMIT_WINDOW = 600; // seconds
const IDEMPOTENCY_TTL = 600; // seconds

interface BookingInput {
  customer_name: string;
  customer_phone: string;
  customer_email: string;
  customer_notes: string;
  services: string[];
  vehicle_year: string;
  vehicle_make: string;
  vehicle_model: string;
  vehicle_registration: string;
  preferred_slot: string;
  indicative_estimate: number | null;
  source: string;
}

/* ----------------------------- helpers ----------------------------- */

function corsHeaders(origin: string | null): Record<string, string> {
  const h: Record<string, string> = {
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Idempotency-Key',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
  if (origin) h['Access-Control-Allow-Origin'] = origin;
  return h;
}

function json(body: unknown, status: number, origin: string | null): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
  });
}

function allowedOrigins(env: Env): string[] {
  return (env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Non-browser callers (no Origin header) are allowed; browser Origins must be on the allowlist. */
function pickOrigin(request: Request, env: Env): { origin: string | null; blocked: boolean } {
  const origin = request.headers.get('Origin');
  if (!origin) return { origin: null, blocked: false };
  return allowedOrigins(env).includes(origin) ? { origin, blocked: false } : { origin: null, blocked: true };
}

function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function str(v: unknown, max: number): string {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

function validEmail(e: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
}

function bookingReference(): string {
  const d = new Date();
  const ymd =
    d.getUTCFullYear().toString() +
    String(d.getUTCMonth() + 1).padStart(2, '0') +
    String(d.getUTCDate()).padStart(2, '0');
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no ambiguous chars
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  let suffix = '';
  for (const b of bytes) suffix += alphabet[b % alphabet.length];
  return `SWW-${ymd}-${suffix}`;
}

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function normalise(raw: any): { data?: BookingInput; error?: string } {
  if (!raw || typeof raw !== 'object') return { error: 'Invalid request body.' };

  const services: string[] = Array.isArray(raw.services)
    ? raw.services.map((s: unknown) => str(s, 80)).filter(Boolean).slice(0, 12)
    : [];

  const rawEstimate = raw.indicative_estimate;
  const indicative_estimate =
    rawEstimate === null || rawEstimate === undefined || rawEstimate === '' ? null : Number(rawEstimate);

  const data: BookingInput = {
    customer_name: str(raw.customer_name, 120),
    customer_phone: str(raw.customer_phone, 40),
    customer_email: str(raw.customer_email, 200).toLowerCase(),
    customer_notes: str(raw.customer_notes, 2000),
    services,
    vehicle_year: str(raw.vehicle_year, 10),
    vehicle_make: str(raw.vehicle_make, 60),
    vehicle_model: str(raw.vehicle_model, 60),
    vehicle_registration: str(raw.vehicle_registration, 20),
    preferred_slot: str(raw.preferred_slot, 120),
    indicative_estimate,
    source: str(raw.source, 60) || 'swanson-worx-staging',
  };

  if (!data.customer_name) return { error: 'Name is required.' };
  if (!data.customer_phone) return { error: 'Phone is required.' };
  if (!data.customer_email || !validEmail(data.customer_email)) return { error: 'A valid email is required.' };
  if (data.services.length === 0) return { error: 'Select at least one service.' };
  if (!data.vehicle_make || !data.vehicle_model) return { error: 'Vehicle make and model are required.' };
  if (!data.preferred_slot) return { error: 'A preferred slot is required.' };
  if (data.indicative_estimate !== null && (!isFinite(data.indicative_estimate) || data.indicative_estimate < 0)) {
    return { error: 'Invalid estimate.' };
  }
  return { data };
}

/* ------------------------------ email ------------------------------ */

async function sendEmail(
  env: Env,
  to: string,
  subject: string,
  html: string
): Promise<void> {
  const smtp = getSmtpConfig(env);

  const message = buildSmtpMessage({
    to,
    subject,
    html,
    fromEmail: smtp.username,
  });

  await sendSmtpEmail(
    smtp,
    message,
    to
  );
}
function getSmtpConfig(env: Env) {
  const host = env.MGRNZ_SMTP_HOST;
  const port = Number(env.MGRNZ_SMTP_PORT || "465");
  const username = env.MGRNZ_SMTP_USERNAME;
  const password = env.MGRNZ_SMTP_PASSWORD;

  if (!host || !port || !username || !password) {
    throw new Error("MGRNZ SMTP configuration is invalid.");
  }

  return {
    host,
    port,
    username,
    password,
  };
}
async function sendEmails(env: Env, reference: string, data: BookingInput): Promise<void> {
  const vehicle = [data.vehicle_year, data.vehicle_make, data.vehicle_model].filter(Boolean).join(' ');
  const reg = data.vehicle_registration ? ` (${esc(data.vehicle_registration)})` : '';
  const est = data.indicative_estimate != null ? `$${data.indicative_estimate.toFixed(2)}` : '—';
  const servicesList = data.services.map((s) => `<li>${esc(s)}</li>`).join('');

  const internalHtml =
    `<h2>New Swanson Worx booking request</h2>` +
    `<p><strong>Reference:</strong> ${esc(reference)}</p>` +
    `<p><strong>Status:</strong> Awaiting confirmation — this is a request, not a confirmed booking.</p>` +
    `<p><strong>Customer:</strong> ${esc(data.customer_name)}<br>` +
    `<strong>Phone:</strong> ${esc(data.customer_phone)}<br>` +
    `<strong>Email:</strong> ${esc(data.customer_email)}</p>` +
    `<p><strong>Vehicle:</strong> ${esc(vehicle)}${reg}</p>` +
    `<p><strong>Services:</strong></p><ul>${servicesList}</ul>` +
    `<p><strong>Preferred slot:</strong> ${esc(data.preferred_slot)}<br>` +
    `<strong>Indicative estimate:</strong> ${esc(est)}</p>` +
    `<p><strong>Notes:</strong> ${esc(data.customer_notes) || '—'}</p>` +
    `<p>Please contact the customer to confirm availability and the final price.</p>`;

  const customerHtml =
    `<p>Hi ${esc(data.customer_name)},</p>` +
    `<p>Thanks — we've received your booking request. <strong>This is a request, not a confirmed booking.</strong> ` +
    `Swanson Worx will contact you to confirm availability and the final price after a quick inspection.</p>` +
    `<p><strong>Your reference:</strong> ${esc(reference)}</p>` +
    `<p><strong>Vehicle:</strong> ${esc(vehicle)}${reg}<br>` +
    `<strong>Services:</strong> ${esc(data.services.join(', '))}<br>` +
    `<strong>Preferred slot:</strong> ${esc(data.preferred_slot)}<br>` +
    `<strong>Indicative estimate:</strong> ${esc(est)} (indicative only — confirmed after we inspect the vehicle)</p>` +
    `<p>Need to reach us sooner? Call or text 09-833 9988.</p>` +
    `<p>— Swanson Worx</p>`;

  // Internal notification (after successful storage).
  await sendEmail(env, env.BOOKING_NOTIFICATION_EMAIL, `New Swanson Worx booking request — ${reference}`, internalHtml);

  // Customer acknowledgement. A failure here must NOT delete the stored request and must NOT surface to the browser.
  try {
    await sendEmail(env, data.customer_email, "We've received your Swanson Worx booking request", customerHtml);
  } catch (e) {
    console.error('customer ack email failed', reference, (e as Error).message);
  }
}

/* ------------------------------ worker ------------------------------ */

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const { origin, blocked } = pickOrigin(request, env);

    if (request.method === 'OPTIONS') {
      if (blocked) return new Response(null, { status: 403 });
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    if (url.pathname !== '/v1/bookings') return json({ ok: false, error: 'Not found.' }, 404, origin);

    if (request.method !== 'POST') {
      return new Response(JSON.stringify({ ok: false, error: 'Method not allowed.' }), {
        status: 405,
        headers: { 'Content-Type': 'application/json', Allow: 'POST, OPTIONS', ...corsHeaders(origin) },
      });
    }

    if (blocked) return json({ ok: false, error: 'Origin not allowed.' }, 403, null);

    const ct = (request.headers.get('Content-Type') || '').toLowerCase();
    if (!ct.includes('application/json')) {
      return json({ ok: false, error: 'Content-Type must be application/json.' }, 415, origin);
    }

    const declaredLen = Number(request.headers.get('Content-Length') || '0');
    if (declaredLen && declaredLen > MAX_BODY_BYTES) {
      return json({ ok: false, error: 'Payload too large.' }, 413, origin);
    }
    const bodyText = await request.text();
    if (bodyText.length > MAX_BODY_BYTES) return json({ ok: false, error: 'Payload too large.' }, 413, origin);

    let raw: any;
    try {
      raw = bodyText ? JSON.parse(bodyText) : {};
    } catch {
      return json({ ok: false, error: 'Invalid JSON.' }, 400, origin);
    }

    // Honeypot: silently accept, do not store, do not email.
    if (str(raw.company_website, 200)) {
      return json({ ok: true, booking_reference: bookingReference(), status: 'received' }, 200, origin);
    }

    const { data, error } = normalise(raw);
    if (error || !data) return json({ ok: false, error: error || 'Invalid request.' }, 400, origin);

    const ip = request.headers.get('CF-Connecting-IP') || '';
    const ipHash = ip ? await sha256Hex(ip) : null;
    const idemKey = request.headers.get('Idempotency-Key') || '';

    // Optional idempotency + per-IP rate limiting (only when a KV namespace is bound).
    if (env.BOOKINGS_KV) {
      try {
        if (idemKey) {
          const prev = await env.BOOKINGS_KV.get('idem:' + idemKey);
          if (prev) return json({ ok: true, booking_reference: prev, status: 'received' }, 200, origin);
        }
        if (ipHash) {
          const rlKey = 'rl:' + ipHash;
          const count = Number((await env.BOOKINGS_KV.get(rlKey)) || '0') + 1;
          if (count > RATE_LIMIT_MAX) {
            return json({ ok: false, error: 'Too many requests. Please try again shortly.' }, 429, origin);
          }
          await env.BOOKINGS_KV.put(rlKey, String(count), { expirationTtl: RATE_LIMIT_WINDOW });
        }
      } catch (e) {
        console.error('kv error', (e as Error).message);
      }
    }

    const reference = bookingReference();
    const record = {
      booking_reference: reference,
      customer_name: data.customer_name,
      customer_phone: data.customer_phone,
      customer_email: data.customer_email,
      customer_notes: data.customer_notes || null,
      vehicle_year: data.vehicle_year || null,
      vehicle_make: data.vehicle_make,
      vehicle_model: data.vehicle_model,
      vehicle_registration: data.vehicle_registration || null,
      services: data.services,
      preferred_slot: data.preferred_slot,
      indicative_estimate: data.indicative_estimate,
      status: 'received',
      source: data.source,
      request_ip_hash: ipHash,
      user_agent: (request.headers.get('User-Agent') || '').slice(0, 300) || null,
    };

    // Store first. The service-role key bypasses RLS (there are no public insert policies).
    try {
      const res = await fetch(`${env.SUPABASE_URL}/rest/v1/swanson_worx_booking_requests`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: env.SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
          Prefer: 'return=minimal',
        },
        body: JSON.stringify(record),
      });
      if (!res.ok) {
        console.error('supabase insert failed', res.status, (await res.text()).slice(0, 300));
        return json({ ok: false, error: 'Could not save your request. Please call 09-833 9988.' }, 502, origin);
      }
    } catch (e) {
      console.error('supabase insert error', (e as Error).message);
      return json({ ok: false, error: 'Could not save your request. Please call 09-833 9988.' }, 502, origin);
    }

    // Record idempotency mapping only after a successful write.
    if (env.BOOKINGS_KV && idemKey) {
      try {
        await env.BOOKINGS_KV.put('idem:' + idemKey, reference, { expirationTtl: IDEMPOTENCY_TTL });
      } catch (e) {
        console.error('kv idem put error', (e as Error).message);
      }
    }

    // Emails are best-effort AFTER storage: logged on failure, never surfaced, never delete the record.
    ctx.waitUntil(sendEmails(env, reference, data).catch((e) => console.error('email error', reference, (e as Error).message)));

    return json({ ok: true, booking_reference: reference, status: 'received' }, 201, origin);
  },
};

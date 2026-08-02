/**
 * בניית ושליחת אירוע Purchase ל-Meta Conversions API.
 * https://developers.facebook.com/docs/marketing-api/conversions-api/
 *
 * event_id = מזהה העסקה של PayPlus. מטא מבצעת דדופליקציה לפי
 * event_name + event_id בחלון של 48 שעות, כך שאם יתווסף בעתיד
 * Pixel Purchase בדפדפן - הוא חייב לשלוח בדיוק את אותו מזהה.
 */

import crypto from 'node:crypto';

const GRAPH_VERSION = 'v21.0';

const sha256 = (value) => crypto.createHash('sha256').update(value, 'utf8').digest('hex');

/** מטא דורשת אימייל מנורמל: trim + lowercase, ואז SHA-256. */
export function normalizeEmail(email) {
  if (typeof email !== 'string') return null;
  const trimmed = email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(trimmed)) return null;
  return trimmed;
}

/** מטא דורשת טלפון בספרות בלבד עם קידומת מדינה. 05X → 9725X. */
export function normalizePhone(phone) {
  if (typeof phone !== 'string') return null;
  let digits = phone.replace(/\D/g, '');
  if (!digits) return null;
  if (digits.startsWith('972')) {
    // כבר בפורמט בינלאומי
  } else if (digits.startsWith('0')) {
    digits = '972' + digits.slice(1);
  }
  if (digits.length < 10 || digits.length > 15) return null;
  return digits;
}

/** שם פרטי/משפחה: lowercase בלי רווחים, ואז SHA-256. */
function normalizeName(name) {
  if (typeof name !== 'string') return null;
  const cleaned = name.trim().toLowerCase().replace(/\s+/g, '');
  return cleaned || null;
}

/**
 * בונה את גוף האירוע. מוחזר גם matchQuality כדי שנוכל לתעד ביומן
 * כמה מזהי לקוח באמת נשלחו - אירוע בלי אף מזהה נדחה על ידי מטא.
 */
export function buildPurchaseEvent({ transaction, customer = {}, eventSourceUrl, eventTimeSeconds }) {
  const user_data = {};

  const email = normalizeEmail(customer.email);
  if (email) user_data.em = [sha256(email)];

  const phone = normalizePhone(customer.phone);
  if (phone) user_data.ph = [sha256(phone)];

  const firstName = normalizeName(customer.firstName);
  if (firstName) user_data.fn = [sha256(firstName)];

  const lastName = normalizeName(customer.lastName);
  if (lastName) user_data.ln = [sha256(lastName)];

  const event = {
    event_name: 'Purchase',
    event_time: eventTimeSeconds,
    event_id: String(transaction.uid),
    action_source: 'website',
    user_data,
    custom_data: {
      value: transaction.amount,
      currency: transaction.currency,
      content_name: 'מסיוט לחלום',
      content_type: 'product',
      order_id: String(transaction.number ?? transaction.uid),
    },
  };

  if (eventSourceUrl) event.event_source_url = eventSourceUrl;

  return { event, matchQuality: Object.keys(user_data).length };
}

/** שולח את האירוע. מחזיר {ok, status, body} ולא זורק, כדי שה-handler ישלוט בזרימה. */
export async function sendPurchaseEvent({ pixelId, accessToken, event, testEventCode, fetchImpl = fetch }) {
  if (!pixelId) return { ok: false, status: 0, body: 'missing META_PIXEL_ID' };
  if (!accessToken) return { ok: false, status: 0, body: 'missing META_ACCESS_TOKEN' };

  const payload = { data: [event] };
  if (testEventCode) payload.test_event_code = testEventCode;

  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${pixelId}/events`;

  let response;
  try {
    response = await fetchImpl(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    return { ok: false, status: 0, body: `network_error: ${err.message}` };
  }

  const text = await response.text();
  return { ok: response.ok, status: response.status, body: text };
}

/**
 * הזרימה המלאה של טיפול ב-callback, עם כל התלויות מוזרקות מבחוץ
 * (אחסון, שליחה למטא, שעון) כדי שאפשר יהיה לבדוק אותה בלי רשת
 * ובלי סביבת Netlify.
 */

import { verifyCallbackSignature, extractApprovedCharge, extractCustomer } from './payplus.js';
import { buildPurchaseEvent } from './meta-capi.js';

/**
 * @param {object}   input
 * @param {string}   input.rawBody      גוף הבקשה הגולמי (חובה - לא אובייקט מפוענח)
 * @param {object}   input.headers      כותרות בקטנות
 * @param {object}   input.env          משתני סביבה
 * @param {object}   input.store        {get(key), setJSON(key,val), delete(key)}
 * @param {Function} input.sendEvent    (event) => {ok, status, body}
 * @param {Function} input.now          () => Date בשניות אפוך
 */
export async function handleCallback({ rawBody, headers, env, store, sendEvent, now }) {
  // ── 1. האם זה באמת PayPlus ──
  const verdict = verifyCallbackSignature({
    rawBody,
    hashHeader: headers['hash'],
    userAgent: headers['user-agent'],
    secret: env.PAYPLUS_SECRET_KEY,
  });
  if (!verdict.ok) {
    return { status: 401, result: 'rejected', reason: verdict.reason };
  }

  let body;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return { status: 400, result: 'rejected', reason: 'body_not_json' };
  }

  // ── 2. האם זו עסקה שאושרה, ולא זיכוי או כישלון ──
  const charge = extractApprovedCharge(body);
  if (!charge.ok) {
    // 200 בכוונה: הבקשה תקפה, פשוט אין מה לדווח עליה.
    // 4xx היה גורם ל-PayPlus לנסות שוב שוב על עסקה שנכשלה.
    return { status: 200, result: 'ignored', reason: charge.reason };
  }
  const { transaction } = charge;

  // ── 3. אידמפוטנטיות: תופסים את המזהה *לפני* השליחה ──
  // סדר הפעולות חשוב. אם נשלח קודם ונסמן אחר כך, קריסה בין
  // השניים תגרום לדיווח כפול על אותה עסקה.
  const key = `purchase:${transaction.uid}`;
  if (store) {
    const existing = await store.get(key);
    if (existing) {
      return { status: 200, result: 'duplicate', reason: 'already_reported', uid: transaction.uid };
    }
    await store.setJSON(key, {
      uid: transaction.uid,
      amount: transaction.amount,
      currency: transaction.currency,
      reportedAt: new Date(now() * 1000).toISOString(),
      status: 'reserved',
    });
  }

  // ── 4. בניית האירוע ושליחה ──
  const customer = extractCustomer(body);
  const { event, matchQuality } = buildPurchaseEvent({
    transaction,
    customer,
    eventSourceUrl: env.SITE_URL ? `${env.SITE_URL.replace(/\/$/, '')}/start.html` : undefined,
    eventTimeSeconds: now(),
  });

  const sent = await sendEvent(event);

  if (!sent.ok) {
    // משחררים את התפיסה כדי ש-retry של PayPlus יוכל לנסות שוב.
    // 500 מסמן ל-PayPlus שכדאי לנסות שנית.
    if (store) await store.delete(key);
    return {
      status: 500,
      result: 'send_failed',
      reason: `meta_${sent.status}`,
      detail: sent.body,
      uid: transaction.uid,
    };
  }

  if (store) {
    await store.setJSON(key, {
      uid: transaction.uid,
      amount: transaction.amount,
      currency: transaction.currency,
      reportedAt: new Date(now() * 1000).toISOString(),
      status: 'sent',
      matchQuality,
    });
  }

  return {
    status: 200,
    result: 'sent',
    uid: transaction.uid,
    value: transaction.amount,
    currency: transaction.currency,
    matchQuality,
  };
}

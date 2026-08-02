/**
 * אימות וחילוץ של callback מ-PayPlus.
 *
 * התיעוד הרשמי:
 *   אימות בקשות   https://docs.payplus.co.il/reference/validate-requests-received-from-payplus
 *   מבנה ה-callback https://docs.payplus.co.il/reference/get_yourdomain-yourendpoint
 *
 * הקובץ הזה הוא לוגיקה טהורה בלבד - בלי רשת, בלי סביבת Netlify -
 * כדי שאפשר יהיה לבדוק אותו ישירות.
 */

import crypto from 'node:crypto';

/** השוואה בזמן קבוע, בלי לדלוף מידע דרך משך ההשוואה. */
function safeEqual(a, b) {
  const bufA = Buffer.from(String(a), 'utf8');
  const bufB = Buffer.from(String(b), 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * מאמת שה-callback באמת הגיע מ-PayPlus.
 *
 * לפי התיעוד: user-agent חייב להיות 'PayPlus', וכותרת 'hash' מכילה
 * HMAC-SHA256 של גוף הבקשה עם ה-API secret key, בקידוד base64.
 *
 * הערה חשובה: התיעוד מדגים JSON.stringify(response.body), כלומר
 * הצפנה מחדש של אובייקט שכבר עבר parse. סדר המפתחות והרווחים שם
 * לא בהכרח זהים לגוף הגולמי, אז אנחנו מנסים את שתי הצורות.
 * שתיהן נגזרות מאותו secret - זה לא מחליש את האימות.
 */
export function verifyCallbackSignature({ rawBody, hashHeader, userAgent, secret }) {
  if (!secret) return { ok: false, reason: 'missing_secret' };
  if (userAgent !== 'PayPlus') return { ok: false, reason: 'bad_user_agent' };
  if (!hashHeader) return { ok: false, reason: 'missing_hash_header' };
  if (typeof rawBody !== 'string' || rawBody.length === 0) {
    return { ok: false, reason: 'empty_body' };
  }

  const candidates = [rawBody];
  try {
    const restringified = JSON.stringify(JSON.parse(rawBody));
    if (restringified !== rawBody) candidates.push(restringified);
  } catch {
    return { ok: false, reason: 'body_not_json' };
  }

  for (const message of candidates) {
    const generated = crypto.createHmac('sha256', secret).update(message, 'utf8').digest('base64');
    if (safeEqual(generated, hashHeader)) return { ok: true };
  }

  return { ok: false, reason: 'hash_mismatch' };
}

/** status_code של עסקה מאושרת. כל ערך אחר = לא לדווח. */
const APPROVED_STATUS_CODE = '000';

/**
 * מחלץ עסקה מאומתת מגוף ה-callback.
 *
 * שים לב שהשדות מקוננים תחת transaction, ואילו transaction_type
 * יושב ברמה העליונה - זה מקור טעות נפוץ.
 */
export function extractApprovedCharge(body) {
  if (!body || typeof body !== 'object') return { ok: false, reason: 'no_body' };

  // זיכוי הוא לא רכישה. בלי הבדיקה הזו החזר כספי היה נספר כמכירה נוספת.
  if (body.transaction_type !== 'Charge') {
    return { ok: false, reason: `not_a_charge:${body.transaction_type ?? 'missing'}` };
  }

  const t = body.transaction;
  if (!t || typeof t !== 'object') return { ok: false, reason: 'no_transaction_object' };

  if (String(t.status_code) !== APPROVED_STATUS_CODE) {
    return { ok: false, reason: `not_approved:${t.status_code ?? 'missing'}` };
  }

  const uid = t.uid;
  if (!uid || typeof uid !== 'string') return { ok: false, reason: 'no_transaction_uid' };

  const amount = Number(t.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, reason: `bad_amount:${t.amount}` };
  }

  return {
    ok: true,
    transaction: {
      uid,
      amount,
      currency: t.currency || 'ILS',
      number: t.number ?? null,
      approvalNumber: t.approval_number ?? null,
      date: t.date ?? null,
      paymentRequestUid: t.payment_request_uid ?? null,
    },
  };
}

/**
 * מחלץ פרטי לקוח מ-data.hash_data (base64 של JSON).
 *
 * הם משפרים משמעותית את איכות ההתאמה של מטא, אבל הם לא חובה
 * ולא תמיד תקינים - בתיעוד עצמו הדוגמה מכילה JSON פגום.
 * לכן כל כשל כאן הוא שקט ומחזיר אובייקט ריק.
 */
export function extractCustomer(body) {
  const out = {};

  const holder = body?.data?.card_information?.card_holder_name;
  if (typeof holder === 'string' && holder.trim()) {
    const parts = holder.trim().split(/\s+/);
    out.firstName = parts[0];
    if (parts.length > 1) out.lastName = parts.slice(1).join(' ');
  }

  const raw = body?.data?.hash_data;
  if (typeof raw === 'string' && raw) {
    try {
      const decoded = Buffer.from(raw, 'base64').toString('utf8');
      const parsed = JSON.parse(decoded);
      if (typeof parsed.email === 'string') out.email = parsed.email;
      if (typeof parsed.phone === 'string') out.phone = parsed.phone;
      if (typeof parsed.name === 'string' && !out.firstName) {
        const parts = parsed.name.trim().split(/\s+/);
        out.firstName = parts[0];
        if (parts.length > 1) out.lastName = parts.slice(1).join(' ');
      }
    } catch {
      // hash_data פגום - ממשיכים בלעדיו
    }
  }

  return out;
}

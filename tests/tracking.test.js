/**
 * בדיקות מעקב הרכישות.  הרצה:  npm test
 *
 * כל התלויות החיצוניות מוזרקות, כך שהבדיקות רצות בלי רשת,
 * בלי Netlify ובלי סודות אמיתיים.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { handleCallback } from '../netlify/functions/lib/handle-callback.js';
import { verifyCallbackSignature, extractApprovedCharge } from '../netlify/functions/lib/payplus.js';
import { buildPurchaseEvent, normalizePhone, normalizeEmail } from '../netlify/functions/lib/meta-capi.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SECRET = 'test-secret-not-real';

/* ── עוזרים ── */

function chargeBody(overrides = {}) {
  return {
    transaction_type: 'Charge',
    transaction: {
      uid: 'txn-aaa-111',
      payment_request_uid: 'req-1',
      number: 'fd138',
      date: '2026-08-02 12:32:52',
      status_code: '000',
      amount: 247,
      currency: 'ILS',
      approval_number: '002341',
      ...overrides.transaction,
    },
    data: {
      card_information: { card_holder_name: 'Moshe Cohen' },
      hash_data: Buffer.from(
        JSON.stringify({ email: 'Buyer@Example.COM ', phone: '050-123-4567', name: 'Moshe Cohen' })
      ).toString('base64'),
      ...overrides.data,
    },
    ...(overrides.top || {}),
  };
}

function sign(body) {
  const raw = JSON.stringify(body);
  const hash = crypto.createHmac('sha256', SECRET).update(raw, 'utf8').digest('base64');
  return { raw, headers: { 'user-agent': 'PayPlus', hash } };
}

function makeStore() {
  const map = new Map();
  return {
    map,
    async get(k) { return map.get(k) ?? null; },
    async setJSON(k, v) { map.set(k, v); },
    async delete(k) { map.delete(k); },
  };
}

function makeSender() {
  const sent = [];
  const fn = async (event) => { sent.push(event); return { ok: true, status: 200, body: '{}' }; };
  fn.sent = sent;
  return fn;
}

const ENV = { PAYPLUS_SECRET_KEY: SECRET, SITE_URL: 'https://redreaming.netlify.app' };
const NOW = () => 1785000000;

async function run({ body = chargeBody(), store = makeStore(), sendEvent = makeSender(), headers, raw } = {}) {
  const signed = sign(body);
  const outcome = await handleCallback({
    rawBody: raw ?? signed.raw,
    headers: headers ?? signed.headers,
    env: ENV,
    store,
    sendEvent,
    now: NOW,
  });
  return { outcome, store, sendEvent };
}

/* ── 1. שני קונים שונים מקבלים מזהי עסקה שונים ── */

test('1. שני קונים שונים → event_id שונה, שתי הרכישות נספרות', async () => {
  const sender = makeSender();
  const store = makeStore();

  await run({ body: chargeBody({ transaction: { uid: 'txn-aaa-111' } }), store, sendEvent: sender });
  await run({ body: chargeBody({ transaction: { uid: 'txn-bbb-222' } }), store, sendEvent: sender });

  assert.equal(sender.sent.length, 2, 'שתי העסקאות נשלחו');
  assert.notEqual(sender.sent[0].event_id, sender.sent[1].event_id, 'event_id חייב להיות שונה');
  assert.equal(sender.sent[0].event_id, 'txn-aaa-111');
  assert.equal(sender.sent[1].event_id, 'txn-bbb-222');
});

/* ── 2. callback כפול של אותה עסקה מדווח פעם אחת ── */

test('2. callback כפול על אותה עסקה → דיווח אחד בלבד', async () => {
  const sender = makeSender();
  const store = makeStore();
  const body = chargeBody();

  const first = await run({ body, store, sendEvent: sender });
  const second = await run({ body, store, sendEvent: sender });

  assert.equal(first.outcome.result, 'sent');
  assert.equal(second.outcome.result, 'duplicate');
  assert.equal(sender.sent.length, 1, 'נשלח למטא פעם אחת בלבד');
});

/* ── 3. פתיחה ידנית של start.html לא שולחת Purchase ── */

test('3. start.html לא מכיל שום ירי Purchase', () => {
  const html = readFileSync(join(ROOT, 'start.html'), 'utf8');
  assert.ok(!/fbq\s*\(\s*['"]track['"]\s*,\s*['"]Purchase['"]/.test(html),
    'אסור ש-start.html יירה Purchase - פתיחת דף אינה הוכחת תשלום');
  assert.ok(html.includes("fbq('track', 'PageView')"), 'PageView נשאר');
  assert.ok(/name="robots"\s+content="noindex/.test(html), 'noindex קיים');
});

test('3ב. בקשה בלי חתימה תקפה נדחית', async () => {
  const sender = makeSender();
  const { outcome } = await run({
    headers: { 'user-agent': 'Mozilla/5.0', hash: 'whatever' },
    sendEvent: sender,
  });
  assert.equal(outcome.status, 401);
  assert.equal(outcome.reason, 'bad_user_agent');
  assert.equal(sender.sent.length, 0);
});

test('3ג. חתימה שגויה נדחית', async () => {
  const sender = makeSender();
  const body = chargeBody();
  const { outcome } = await run({
    body,
    headers: { 'user-agent': 'PayPlus', hash: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' },
    sendEvent: sender,
  });
  assert.equal(outcome.status, 401);
  assert.equal(outcome.reason, 'hash_mismatch');
  assert.equal(sender.sent.length, 0);
});

/* ── 4. רענון start.html לא שולח Purchase נוסף ── */

/* ── דף התודה הזמני: Purchase מהדפדפן עד ש-CAPI עולה ── */

/**
 * מריץ את בלוק ה-Purchase האמיתי מתוך thank-you.html מול DOM מדומה.
 *
 * הבדיקות הקודמות רק חיפשו מחרוזות ב-HTML, ולכן פספסו באג אמיתי:
 * פתיחה ישירה של הדף ירתה Purchase והדליקה מנעול קבוע שחסם אחר כך
 * כל רכישה אמיתית מאותו דפדפן. מכאן ואילך בודקים התנהגות, לא טקסט.
 */
function runThankYou({ referrer = '', storage = {}, now = 1785000000000 } = {}) {
  const html = readFileSync(join(ROOT, 'thank-you.html'), 'utf8');
  const start = html.indexOf('(function () {');
  const end = html.indexOf('})();', start);
  assert.ok(start > -1 && end > start, 'בלוק ה-Purchase לא נמצא בדף');

  const store = { ...storage };
  const fired = [];
  const win = {
    location: { origin: 'https://redreaming.netlify.app' },
    localStorage: {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: (k) => { delete store[k]; },
    },
  };
  const fbq = (...args) => { if (args[1] === 'Purchase') fired.push(args); };
  const FrozenDate = class extends Date { static now() { return now; } };

  new Function('window', 'document', 'fbq', 'Date', html.slice(start, end + 5))(
    win, { referrer }, fbq, FrozenDate
  );

  return { fired, store, params: fired[0]?.[2], opts: fired[0]?.[3] };
}

const PAYPLUS = 'https://payments.payplus.co.il/';
const NOW_MS = 1785000000000;
const token = (age = 0, id = 'web-test-abc123') =>
  ({ mb_checkout: JSON.stringify({ t: NOW_MS - age, id }) });

test('3ד. חזרה מ-PayPlus אחרי צ׳קאאוט → Purchase אחד עם 247/ILS ו-eventID', () => {
  const { fired, params, opts } = runThankYou({ referrer: PAYPLUS, storage: token() });

  assert.equal(fired.length, 1, 'Purchase נורה בדיוק פעם אחת');
  assert.equal(params.value, 247.00);
  assert.equal(params.currency, 'ILS');
  assert.equal(opts.eventID, 'web-test-abc123', 'eventID מגיע מאסימון הצ׳קאאוט');
});

test('3ד2. גם בלי referrer (שער תשלום שמסתיר אותו) הרכישה נספרת', () => {
  const { fired } = runThankYou({ referrer: '', storage: token() });
  assert.equal(fired.length, 1, 'referrer ריק אינו סיבה לפספס רכישה אמיתית');
});

test('3ה. הגעה מדף פנימי באתר לא יורה Purchase', () => {
  const { fired } = runThankYou({
    referrer: 'https://redreaming.netlify.app/index.html',
    storage: token(),
  });
  assert.equal(fired.length, 0);
});

test('3ו. פתיחה ישירה של /thank-you בלי צ׳קאאוט לא יורה Purchase', () => {
  const { fired } = runThankYou({ referrer: '', storage: {} });
  assert.equal(fired.length, 0, 'בלי אסימון אין הוכחת תשלום - ורכישה מזויפת מרעילה את הקמפיין');
});

test('3ז. רענון אחרי ירי לא יורה Purchase שני', () => {
  const first = runThankYou({ referrer: PAYPLUS, storage: token() });
  assert.equal(first.fired.length, 1);

  // אותו דפדפן, אותו storage אחרי הירי הראשון
  const second = runThankYou({ referrer: PAYPLUS, storage: first.store });
  assert.equal(second.fired.length, 0, 'האסימון נצרך, ורענון לא מוסיף רכישה');
});

test('3ח. אסימון ישן מ-3 שעות לא יורה - זה ביקור חוזר, לא רכישה', () => {
  const { fired, store } = runThankYou({
    referrer: PAYPLUS,
    storage: token(4 * 60 * 60 * 1000),
  });
  assert.equal(fired.length, 0);
  assert.ok(!('mb_checkout' in store), 'האסימון הישן נמחק ולא נשאר להטריד');
});

test('3ט. המנעול הישן mb_purchase_fired לא חוסם רכישה אמיתית', () => {
  const { fired, store } = runThankYou({
    referrer: PAYPLUS,
    storage: { ...token(), mb_purchase_fired: '1' },
  });
  assert.equal(fired.length, 1, 'זה בדיוק הבאג שהפיל את הרכישה האמיתית של 2.8');
  assert.ok(!('mb_purchase_fired' in store), 'המנעול הישן מנוקה מהדפדפן');
});

test('3י. script.js מנפיק את האסימון בלחיצה על הצ׳קאאוט', () => {
  const js = readFileSync(join(ROOT, 'script.js'), 'utf8');
  assert.ok(/localStorage\.setItem\(\s*\n?\s*["']mb_checkout["']/.test(js),
    'בלי הנפקה בצד הכפתור, דף התודה לעולם לא יירה');
  assert.ok(/InitiateCheckout/.test(js), 'ההנפקה יושבת ליד ה-InitiateCheckout');
});

test('3כ. דף התודה נשאר נקי ממוצר ומאינדוקס', () => {
  const html = readFileSync(join(ROOT, 'thank-you.html'), 'utf8');
  assert.ok(/name="robots"\s+content="noindex/.test(html), 'noindex');
  assert.ok(/למחוק ברגע ש-CAPI עולה/.test(html), 'אזהרת הזמניות קיימת בקוד');
  assert.ok(!/files\/audio|workbook|\.pdf/.test(html),
    'קבצי המוצר נשארים ב-start.html בלבד');
});

test('4. רענון הדף לא מייצר Purchase (אין קוד כזה בדף)', () => {
  const html = readFileSync(join(ROOT, 'start.html'), 'utf8');

  // בודקים קריאות אמיתיות, לא אזכור של המילה בהערה
  assert.ok(!/localStorage\s*\.\s*(get|set|remove)Item/.test(html),
    'אין יותר מנעול localStorage - הוא היה תחליף כושל להוכחת תשלום');
  assert.ok(!/\beventID\s*:/.test(html), 'אין eventID בצד הדפדפן');
  assert.ok(!/URLSearchParams|location\.search/.test(html),
    'הדף לא קורא query string - פרמטר לא מאומת אינו הוכחת תשלום');

  // ה-fbq היחיד שמותר כאן הוא init ו-PageView
  const fbqCalls = [...html.matchAll(/fbq\(\s*['"](\w+)['"]\s*,\s*['"]([^'"]+)['"]/g)]
    .map((m) => `${m[1]}:${m[2]}`);
  assert.deepEqual(fbqCalls, ['init:4064369010530258', 'track:PageView'],
    `נמצאו קריאות fbq לא צפויות: ${fbqCalls.join(', ')}`);
});

/* ── 5. עסקה שנכשלה או בוטלה לא שולחת Purchase ── */

test('5א. status_code שאינו 000 → לא נשלח', async () => {
  const sender = makeSender();
  const { outcome } = await run({
    body: chargeBody({ transaction: { status_code: '033' } }),
    sendEvent: sender,
  });
  assert.equal(outcome.result, 'ignored');
  assert.match(outcome.reason, /^not_approved/);
  assert.equal(sender.sent.length, 0);
});

test('5ב. זיכוי (Refund) לא נספר כרכישה', async () => {
  const sender = makeSender();
  const { outcome } = await run({
    body: chargeBody({ top: { transaction_type: 'Refund' } }),
    sendEvent: sender,
  });
  assert.equal(outcome.result, 'ignored');
  assert.match(outcome.reason, /^not_a_charge/);
  assert.equal(sender.sent.length, 0);
});

test('5ג. כשל שליחה למטא משחרר את התפיסה ל-retry', async () => {
  const store = makeStore();
  const failing = async () => ({ ok: false, status: 500, body: 'boom' });
  const { outcome } = await run({ store, sendEvent: failing });

  assert.equal(outcome.result, 'send_failed');
  assert.equal(outcome.status, 500);
  assert.equal(store.map.size, 0, 'התפיסה שוחררה כדי ש-retry יעבוד');

  // ה-retry מצליח
  const sender = makeSender();
  const retry = await run({ store, sendEvent: sender });
  assert.equal(retry.outcome.result, 'sent');
  assert.equal(sender.sent.length, 1);
});

/* ── 6 + 7. הערך 247 והמטבע ILS ── */

test('6+7. value=247 ו-currency=ILS נשלחים למטא', async () => {
  const sender = makeSender();
  await run({ sendEvent: sender });

  const event = sender.sent[0];
  assert.equal(event.custom_data.value, 247);
  assert.equal(event.custom_data.currency, 'ILS');
  assert.equal(event.event_name, 'Purchase');
  assert.equal(event.action_source, 'website');
});

test('6ב. הסכום מגיע מ-PayPlus ולא מקובע בקוד', async () => {
  const sender = makeSender();
  await run({ body: chargeBody({ transaction: { uid: 'txn-x', amount: 197 } }), sendEvent: sender });
  assert.equal(sender.sent[0].custom_data.value, 197,
    'סכום אמיתי מ-PayPlus, כדי שהנחה או מחיר אחר לא ידווחו שגוי');
});

/* ── 8. Pixel ו-CAPI חולקים את אותו eventID ── */

test('8. event_id הוא מזהה העסקה של PayPlus (בסיס לדדופליקציה)', async () => {
  const sender = makeSender();
  await run({ body: chargeBody({ transaction: { uid: 'txn-dedup-9' } }), sendEvent: sender });

  assert.equal(sender.sent[0].event_id, 'txn-dedup-9');
  assert.equal(typeof sender.sent[0].event_id, 'string', 'מטא דורשת מחרוזת, לא מספר');
});

test('8ב. פרטי לקוח נשלחים מגובבים בלבד', async () => {
  const sender = makeSender();
  await run({ sendEvent: sender });
  const ud = sender.sent[0].user_data;

  assert.ok(ud.em?.[0], 'אימייל נשלח');
  assert.match(ud.em[0], /^[a-f0-9]{64}$/, 'SHA-256 hex');
  assert.ok(!JSON.stringify(ud).includes('Buyer'), 'אין אימייל גולמי');
  assert.ok(!JSON.stringify(ud).includes('@'), 'אין כתובת קריאה');

  // נרמול לפי דרישות מטא
  assert.equal(normalizeEmail(' Buyer@Example.COM '), 'buyer@example.com');
  assert.equal(normalizePhone('050-123-4567'), '972501234567');
});

/* ── 9. אין סודות בקוד ── */

test('9. אין סודות אמיתיים בקבצי המקור', () => {
  const suspicious = [
    /EAA[A-Za-z0-9]{40,}/,                          // Meta access token
    /access_token\s*[:=]\s*['"][^'"]{20,}['"]/i,
    /(?:secret|api[_-]?key)\s*[:=]\s*['"]([^'"]{16,})['"]/i,
  ];

  // ערכים שברור מהם עצמם שהם לא אמיתיים
  const isFixture = (value = '') =>
    /test|example|fake|placeholder|not-?a-?real|not-real|your-|xxx|dummy/i.test(value);

  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      if (['node_modules', '.git', '.netlify', 'files', 'mockups'].includes(name)) continue;
      const full = join(dir, name);
      if (statSync(full).isDirectory()) { walk(full); continue; }
      if (!/\.(js|mjs|html|json|toml|example)$/.test(name)) continue;

      const text = readFileSync(full, 'utf8');
      for (const pattern of suspicious) {
        const match = text.match(pattern);
        if (!match) continue;
        assert.ok(isFixture(match[1] ?? match[0]),
          `נמצא סוד חשוד ב-${name}: ${match[0].slice(0, 40)}`);
      }
    }
  };
  walk(ROOT);

  const envExample = readFileSync(join(ROOT, '.env.example'), 'utf8');
  for (const line of envExample.split('\n')) {
    if (line.startsWith('#') || !line.includes('=')) continue;
    const [key, value] = line.split('=');
    if (key === 'SITE_URL') continue;   // כתובת ציבורית, לא סוד
    assert.equal(value.trim(), '', `${key} חייב להישאר ריק ב-.env.example`);
  }

  const gitignore = readFileSync(join(ROOT, '.gitignore'), 'utf8');
  assert.ok(gitignore.includes('.env'), '.env חייב להיות ב-gitignore');
});

/* ── 10. תקינות מבנית נוספת ── */

test('10. אימות חתימה עמיד לשינוי ולו בית אחד בגוף', () => {
  const body = chargeBody();
  const raw = JSON.stringify(body);
  const hash = crypto.createHmac('sha256', SECRET).update(raw, 'utf8').digest('base64');

  assert.equal(
    verifyCallbackSignature({ rawBody: raw, hashHeader: hash, userAgent: 'PayPlus', secret: SECRET }).ok,
    true
  );

  const tampered = raw.replace('"amount":247', '"amount":1');
  assert.equal(
    verifyCallbackSignature({ rawBody: tampered, hashHeader: hash, userAgent: 'PayPlus', secret: SECRET }).ok,
    false,
    'שינוי בסכום חייב לפסול את החתימה'
  );
});

test('10ב. גוף בלי transaction נדחה בלי לקרוס', () => {
  assert.equal(extractApprovedCharge({ transaction_type: 'Charge' }).ok, false);
  assert.equal(extractApprovedCharge(null).ok, false);
  assert.equal(extractApprovedCharge({}).ok, false);
});

test('10ג. hash_data פגום לא מפיל את הזרימה', async () => {
  const sender = makeSender();
  const { outcome } = await run({
    body: chargeBody({ data: { hash_data: 'לא-base64-תקין!!!', card_information: {} } }),
    sendEvent: sender,
  });
  assert.equal(outcome.result, 'sent', 'העסקה עדיין מדווחת');
  assert.equal(sender.sent.length, 1);
});

test('10ד. אירוע בלי אף מזהה לקוח מסומן ב-matchQuality אפס', () => {
  const { matchQuality } = buildPurchaseEvent({
    transaction: { uid: 'x', amount: 247, currency: 'ILS' },
    customer: {},
    eventTimeSeconds: NOW(),
  });
  assert.equal(matchQuality, 0,
    'מטא דוחה אירוע בלי אף פרמטר לקוח - matchQuality=0 הוא סימן אזהרה ביומן');
});

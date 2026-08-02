/**
 * נקודת הקצה שמקבלת את ה-callback מ-PayPlus אחרי תשלום.
 *
 * כתובת בפרודקשן:  https://redreaming.netlify.app/api/payplus-callback
 *
 * זה המקום היחיד בכל הפרויקט ששולח Purchase למטא. דף התודה
 * (start.html) לא שולח כלום - פתיחת דף אינה הוכחת תשלום.
 */

import { getStore } from '@netlify/blobs';
import { handleCallback } from './lib/handle-callback.js';
import { sendPurchaseEvent } from './lib/meta-capi.js';

export default async (req) => {
  if (req.method !== 'POST') {
    return Response.json({ error: 'method_not_allowed' }, { status: 405 });
  }

  const rawBody = await req.text();

  const headers = {};
  req.headers.forEach((value, name) => {
    headers[name.toLowerCase()] = value;
  });

  const env = {
    PAYPLUS_SECRET_KEY: process.env.PAYPLUS_SECRET_KEY,
    META_PIXEL_ID: process.env.META_PIXEL_ID,
    META_ACCESS_TOKEN: process.env.META_ACCESS_TOKEN,
    META_TEST_EVENT_CODE: process.env.META_TEST_EVENT_CODE,
    SITE_URL: process.env.SITE_URL,
  };

  // consistency: 'strong' חיוני - בלעדיו קריאה מיד אחרי כתיבה
  // עלולה להחזיר ערך ישן, ואז אותה עסקה תדווח פעמיים.
  let store = null;
  try {
    store = getStore({ name: 'purchases', consistency: 'strong' });
  } catch (err) {
    // בלי אחסון עדיין שולחים - הדדופליקציה של מטא לפי event_id
    // היא שכבת ההגנה השנייה - אבל מתעדים שזה קרה.
    console.warn('[payplus-callback] blobs unavailable, idempotency degraded:', err.message);
  }

  let outcome;
  try {
    outcome = await handleCallback({
      rawBody,
      headers,
      env,
      store,
      now: () => Math.floor(Date.now() / 1000),
      sendEvent: (event) =>
        sendPurchaseEvent({
          pixelId: env.META_PIXEL_ID,
          accessToken: env.META_ACCESS_TOKEN,
          testEventCode: env.META_TEST_EVENT_CODE,
          event,
        }),
    });
  } catch (err) {
    console.error('[payplus-callback] unhandled:', err);
    return Response.json({ error: 'internal_error' }, { status: 500 });
  }

  // ביומן: אף פעם לא את גוף הבקשה - הוא מכיל פרטי לקוח.
  console.log('[payplus-callback]', JSON.stringify({
    result: outcome.result,
    reason: outcome.reason,
    uid: outcome.uid,
    matchQuality: outcome.matchQuality,
  }));

  const { status, detail, ...safe } = outcome;
  return Response.json(safe, { status });
};

export const config = {
  path: '/api/payplus-callback',
};

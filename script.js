/* =========================================================
   מסיוט לחלום — סקריפט הדף

   ⚠️  שינוי אחד לפני העלייה לאוויר: השורה הבאה.
   ========================================================= */

const CHECKOUT_URL = "https://payments.payplus.co.il/l/d30803aa-b0d1-49fa-80f0-61b4fe9ebc5e";

/* מחיר הבטא. מופיע גם ב-thank-you.html (Purchase) - שני המקומות
   חייבים להישאר זהים, אחרת מטא תקבל ערך אחר בצ׳קאאוט וברכישה. */
const PRICE = 49;

/* ========================================================= */

const isPlaceholder = CHECKOUT_URL.includes("YOUR-PAYPLUS");

/* ── כפתורי הרכישה: קישור + אירוע פיקסל ── */
document.querySelectorAll("[data-checkout]").forEach((el) => {
  if (!isPlaceholder) el.setAttribute("href", CHECKOUT_URL);

  el.addEventListener("click", (event) => {
    if (isPlaceholder) {
      event.preventDefault();
      alert("יש להחליף ב-script.js את CHECKOUT_URL בקישור התשלום של PayPlus.");
      return;
    }
    if (window.fbq) fbq("track", "InitiateCheckout", { value: PRICE, currency: "ILS" });

    // אסימון צ'קאאוט: ההוכחה היחידה שדף התודה יקבל לכך שהגולש
    // באמת יצא לתשלום. בלעדיו כל פתיחה של /thank-you נספרת כרכישה.
    // ה-id נוצר כאן ולא שם, כדי שרענון של דף התודה לא ייצר מזהה חדש.
    try {
      localStorage.setItem(
        "mb_checkout",
        JSON.stringify({
          t: Date.now(),
          id: "web-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10),
        })
      );
    } catch (e) {}
  });
});

if (isPlaceholder) {
  console.warn(
    "⚠️ מסיוט לחלום: קישור התשלום לא הוגדר.\n" +
    "לפתוח script.js ולהחליף את CHECKOUT_URL בקישור מ-PayPlus."
  );
}

/* ── שנה בפוטר ── */
const yearEl = document.getElementById("year");
if (yearEl) yearEl.textContent = new Date().getFullYear();

/* ── אנימציית חשיפה בגלילה ── */
const revealEls = document.querySelectorAll(".reveal");
if ("IntersectionObserver" in window) {
  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("visible");
          io.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.12, rootMargin: "0px 0px -40px 0px" }
  );
  revealEls.forEach((el) => io.observe(el));
} else {
  revealEls.forEach((el) => el.classList.add("visible"));
}

/* ── גלילה עמוקה: קהל לריטרגטינג ──
   נורה פעם אחת כשהמבקר עבר 60% מהדף. זה הקהל
   שקרא באמת, והוא הכי שווה לריטרגטינג.        */
let deepFired = false;
window.addEventListener(
  "scroll",
  () => {
    if (deepFired) return;
    const scrolled = (window.scrollY + window.innerHeight) / document.body.scrollHeight;
    if (scrolled > 0.6) {
      deepFired = true;
      if (window.fbq) fbq("trackCustom", "ScrollDeep");
    }
  },
  { passive: true }
);

/* ── פתיחת FAQ: סיגנל כוונה ──
   מי שפותח 3 שאלות ומעלה נמצא בשלב שיקול מתקדם. */
let faqOpens = 0;
document.querySelectorAll(".faq-item").forEach((item) => {
  item.addEventListener("toggle", () => {
    if (!item.open) return;
    faqOpens += 1;
    if (faqOpens === 3 && window.fbq) fbq("trackCustom", "FaqEngaged");
  });
});

/* ── הגיע לכרטיס המחיר: השלב שהיה חסר במשפך ──
   עד עכשיו ידענו רק כמה נכנסו וכמה לחצו לתשלום, בלי שום
   מדידה של מי בכלל הגיע לראות את המחיר. ViewContent סוגר את
   הפער, והוא גם אירוע סטנדרטי שמטא יודעת לבצע עליו
   אופטימיזציה - בניגוד לאירוע מותאם.                    */
const priceSection = document.getElementById("price");
if (priceSection && "IntersectionObserver" in window) {
  const priceIO = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        priceIO.disconnect();
        if (window.fbq) fbq("track", "ViewContent", { content_name: "price", value: PRICE, currency: "ILS" });
      });
    },
    { threshold: 0.4 }
  );
  priceIO.observe(priceSection);
}

/* ── וידאו המוצר: טעינה רק כשמגיעים אליו ──
   הקובץ שוקל 3.67MB. עם autoplay הדפדפן הוריד אותו כבר
   בטעינת הדף, הרבה לפני שמישהו גלל עד אליו.            */
document.querySelectorAll("video[data-lazyvideo]").forEach((video) => {
  if (!("IntersectionObserver" in window)) { video.play().catch(() => {}); return; }
  const vio = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        vio.disconnect();
        video.preload = "auto";
        video.load();
        video.play().catch(() => {}); // דפדפן שחוסם ניגון אוטומטי נשאר עם ה-poster
      });
    },
    { rootMargin: "200px" }
  );
  vio.observe(video);
});

/* ── נגן ההצצה בהירו ── */
(function () {
  var box = document.querySelector(".ps-audio");
  var clip = document.getElementById("heroClip");
  if (!box || !clip) return;
  box.addEventListener("click", function () {
    if (clip.paused) { clip.currentTime = 3.5; clip.play(); }
    else clip.pause();
  });
  clip.addEventListener("play",  function(){ box.classList.add("playing"); });
  clip.addEventListener("pause", function(){ box.classList.remove("playing"); });
  clip.addEventListener("timeupdate", function () {
    if (clip.currentTime >= 23.5) clip.pause();
  });
})();

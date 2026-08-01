/* =========================================================
   מסיוט לחלום — סקריפט הדף

   ⚠️  שינוי אחד לפני העלייה לאוויר: השורה הבאה.
   ========================================================= */

const CHECKOUT_URL = "https://payments.payplus.co.il/l/58054a94-4d5e-4e1f-ae5d-a735670a20da";

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
    if (window.fbq) fbq("track", "InitiateCheckout", { value: 247, currency: "ILS" });
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

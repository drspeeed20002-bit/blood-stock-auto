(async function () {
  const REPO = "drspeeed20002-bit/blood-stock-auto";
  const DATA_URL = `https://api.github.com/repos/${REPO}/contents/stock_data.json?t=${Date.now()}`;

  // استخراج الأرصدة المحفوظة من السحابة
  async function fetchStockData() {
    const resp = await fetch(DATA_URL, {
      headers: { Accept: "application/vnd.github+json" }
    });
    if (!resp.ok) throw new Error("تعذر جلب ملف الأرصدة من السحابة");
    const meta = await resp.json();
    const jsonStr = decodeURIComponent(escape(atob(meta.content.replace(/\n/g, ""))));
    return JSON.parse(jsonStr);
  }

  // ملء قسم معين داخل صفحة موقع وزارة الصحة
  function fillSection(sectionTitle, fieldMap) {
    const allElements = Array.from(document.querySelectorAll("*"));
    const headerCandidates = allElements.filter((el) => {
      if (el.children.length > 3) return false;
      const txt = (el.textContent || "").trim();
      return txt === sectionTitle || txt.split(/\s+/)[0] === sectionTitle;
    });

    let sectionContainer = null;
    for (const hdr of headerCandidates) {
      let parent = hdr.parentElement;
      while (parent && parent !== document.body) {
        const inputs = parent.querySelectorAll("input");
        if (inputs.length >= 4 && inputs.length <= 15) {
          sectionContainer = parent;
          break;
        }
        parent = parent.parentElement;
      }
      if (sectionContainer) break;
    }

    if (!sectionContainer) return 0;

    let count = 0;
    for (const [labelName, value] of Object.entries(fieldMap)) {
      if (value === null || value === undefined || value === "") continue;
      const labelEl = Array.from(sectionContainer.querySelectorAll("*")).find(
        (el) => el.children.length === 0 && (el.textContent || "").trim() === labelName
      );
      if (!labelEl) continue;

      let card = labelEl.parentElement;
      let inputEl = null;
      while (card && card !== sectionContainer) {
        const inputs = card.querySelectorAll('input:not([type="hidden"])');
        if (inputs.length === 1) {
          inputEl = inputs[0];
          break;
        }
        card = card.parentElement;
      }
      if (!inputEl) continue;

      const strVal = String(value);
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value"
      ).set;
      setter.call(inputEl, strVal);
      inputEl.dispatchEvent(new Event("input", { bubbles: true }));
      inputEl.dispatchEvent(new Event("change", { bubbles: true }));
      inputEl.dispatchEvent(new Event("blur", { bubbles: true }));
      count++;
    }
    return count;
  }

  // ملء كل الأقسام في الصفحة
  function fillAllFields(stockData) {
    const prbcs = stockData.prbcs || {};
    const ffp = stockData.ffp || {};
    const fp = stockData.fp || {};
    const platelets = stockData.platelets || {};

    let totalFilled = 0;
    totalFilled += fillSection("PRBCs", {
      "تحت الفحص": prbcs.under_test,
      "A pos": prbcs.A_pos,
      "A neg": prbcs.A_neg,
      "B pos": prbcs.B_pos,
      "B neg": prbcs.B_neg,
      "O pos": prbcs.O_pos,
      "O neg": prbcs.O_neg,
      "AB pos": prbcs.AB_pos,
      "AB neg": prbcs.AB_neg
    });

    totalFilled += fillSection("FFP", {
      A: ffp.A,
      B: ffp.B,
      O: ffp.O,
      AB: ffp.AB
    });

    totalFilled += fillSection("FP", {
      A: fp.A ?? 0,
      B: fp.B ?? 0,
      O: fp.O ?? 0,
      AB: fp.AB ?? 0
    });

    totalFilled += fillSection("Platelets", {
      "A pos": platelets.A_pos ?? 0,
      "A neg": platelets.A_neg ?? 0,
      "B pos": platelets.B_pos ?? 0,
      "B neg": platelets.B_neg ?? 0,
      "O pos": platelets.O_pos ?? 0,
      "O neg": platelets.O_neg ?? 0,
      "AB pos": platelets.AB_pos ?? 0,
      "AB neg": platelets.AB_neg ?? 0
    });

    return totalFilled;
  }

  // الضغط على حفظ وتأكيد الجرد
  async function submitFormNow(stockData) {
    const filled = fillAllFields(stockData);
    if (filled === 0) {
      alert("⚠️ تأكد أنك فاتح صفحة تسجيل أرصدة الدم (blood_stocks_registration.php)");
      return false;
    }

    await new Promise((r) => setTimeout(r, 600));

    const buttons = Array.from(document.querySelectorAll("button, a, input[type='button'], input[type='submit']"));
    const saveBtn = buttons.find((b) => (b.textContent || b.value || "").includes("حفظ وإرسال التقرير الدوري"));
    if (!saveBtn) {
      alert("✅ تم ملء الخانات بنجاح، اضغط على زر (حفظ وإرسال التقرير الدوري) لتأكيدها.");
      return false;
    }
    saveBtn.scrollIntoView({ behavior: "smooth", block: "center" });
    saveBtn.click();

    // انتظار ظهور نافذة التأكيد
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 500));
      const allBtns = Array.from(document.querySelectorAll("button, a"));
      const confirmBtn = allBtns.find((b) =>
        (b.textContent || "").includes("نعم، كشف الأرصدة صحيح بالكامل")
      );
      if (confirmBtn && confirmBtn.offsetParent !== null) {
        await new Promise((r) => setTimeout(r, 400));
        confirmBtn.click();
        return true;
      }
    }
    return false;
  }

  // فحص هل نحن في وضع التسجيل التلقائي بعد إعادة التحميل الساعة 7 صباحاً
  if (sessionStorage.getItem("mohp_auto_execute_now") === "true") {
    sessionStorage.removeItem("mohp_auto_execute_now");
    try {
      const data = await fetchStockData();
      await new Promise((r) => setTimeout(r, 1500));
      await submitFormNow(data);
    } catch (e) {
      console.error("Auto execute error:", e);
    }
    return;
  }

  // إنشاء لوحة التحكم العائمة داخل موقع الوزارة
  const existingPanel = document.getElementById("mohp-auto-panel");
  if (existingPanel) existingPanel.remove();

  const stockData = await fetchStockData();
  const prbcs = stockData.prbcs || {};
  const ffp = stockData.ffp || {};

  const panel = document.createElement("div");
  panel.id = "mohp-auto-panel";
  panel.style.cssText = `
    position: fixed; inset: 0; background: rgba(15, 23, 42, 0.85); z-index: 999999;
    display: flex; align-items: center; justify-content: center; padding: 16px;
    direction: rtl; font-family: Tahoma, Arial, sans-serif;
  `;

  panel.innerHTML = `
    <div style="background:#fff; width:100%; max-width:400px; border-radius:18px; padding:20px; text-align:center; box-shadow:0 20px 40px rgba(0,0,0,0.4);">
      <h3 style="margin:0 0 8px; color:#1e293b; font-size:18px;">🩸 المساعد الذكي لرصيد بنك الدم</h3>
      <div style="background:#f1f5f9; border-radius:10px; padding:10px; font-size:13px; color:#334155; margin-bottom:14px; line-height:1.7;">
        <b>الأرصدة الجاهزة للتسجيل الآن:</b><br>
        🔴 <b>كرات دم:</b> A+(${prbcs.A_pos}) A-(${prbcs.A_neg}) B+(${prbcs.B_pos}) B-(${prbcs.B_neg}) O+(${prbcs.O_pos}) O-(${prbcs.O_neg}) AB+(${prbcs.AB_pos}) AB-(${prbcs.AB_neg}) | تحت الفحص: <b>${prbcs.under_test}</b><br>
        💧 <b>بلازما FFP:</b> A(${ffp.A}) B(${ffp.B}) O(${ffp.O}) AB(${ffp.AB})
      </div>

      <button id="btn-instant-save" style="width:100%; padding:14px; background:#dc2626; color:#fff; border:none; border-radius:12px; font-size:15px; font-weight:bold; margin-bottom:10px; cursor:pointer;">
        🚀 املأ الخانات واحفظ التقرير الآن فوراً
      </button>

      <button id="btn-sleep-timer" style="width:100%; padding:14px; background:#16a34a; color:#fff; border:none; border-radius:12px; font-size:15px; font-weight:bold; margin-bottom:10px; cursor:pointer;">
        🌙 وضع النوم: سجل تلقائياً 7:00 الصبح وأنا نايم
      </button>

      <button id="btn-fill-only" style="width:100%; padding:11px; background:#e2e8f0; color:#1e293b; border:none; border-radius:12px; font-size:14px; font-weight:bold; margin-bottom:10px; cursor:pointer;">
        ✏️ املأ الخانات فقط بدون حفظ (للمراجعة)
      </button>

      <button id="btn-close-panel" style="width:100%; padding:8px; background:transparent; color:#64748b; border:none; font-size:13px; cursor:pointer;">
        إغلاق النافذة
      </button>
    </div>
  `;

  document.body.appendChild(panel);

  document.getElementById("btn-close-panel").onclick = () => panel.remove();

  document.getElementById("btn-fill-only").onclick = () => {
    fillAllFields(stockData);
    panel.remove();
  };

  document.getElementById("btn-instant-save").onclick = async () => {
    panel.remove();
    await submitFormNow(stockData);
  };

  document.getElementById("btn-sleep-timer").onclick = async () => {
    // تفعيل قفل الشاشة البرمجي لمنع الموبايل من قفل المتصفح أثناء النوم
    let wakeLock = null;
    try {
      if ("wakeLock" in navigator) {
        wakeLock = await navigator.wakeLock.request("screen");
      }
    } catch (e) {}

    panel.style.background = "#000000";
    panel.innerHTML = `
      <div style="color:#94a3b8; text-align:center; padding:20px;">
        <div style="font-size:42px; margin-bottom:10px;">🌙</div>
        <h2 style="color:#22c55e; font-size:20px; margin-bottom:8px;">وضع النوم الليلي مفعّل</h2>
        <p style="font-size:14px; line-height:1.7; max-width:320px; margin:0 auto 16px;">
          سيتم الحفاظ على جلسة الدخول طوال الليل، وتسجيل الرصيد تلقائياً الساعة <b>06:55 صباحاً</b>.<br>
          (اترك الموبايل متصلاً بالشاحن ولا تغلق هذه الصفحة — الشاشة سوداء لتوفير البطارية).
        </p>
        <div id="sleep-countdown" style="font-family:monospace; font-size:22px; color:#f8fafc; margin-bottom:20px;">--:--:--</div>
        <button id="btn-cancel-sleep" style="padding:10px 24px; background:#334155; color:#fff; border:none; border-radius:8px; font-size:14px;">إلغاء وضع النوم</button>
      </div>
    `;

    // تنشيط السيرفر كل 8 دقائق لمنع انتهاء الجلسة (inactivity timeout = 15 min)
    const keepAliveTimer = setInterval(async () => {
      try {
        await fetch("blood_stocks_registration.php", { credentials: "same-origin" });
      } catch (e) {}
    }, 8 * 60 * 1000);

    // فحص الوقت كل 10 ثوانٍ
    const checkTimer = setInterval(async () => {
      const now = new Date();
      const target = new Date();
      target.setHours(6, 55, 0, 0);
      if (now >= target && (now.getHours() > 7 || (now.getHours() === 6 && now.getMinutes() > 56))) {
        target.setDate(target.getDate() + 1);
      }

      const diffSec = Math.max(0, Math.floor((target - now) / 1000));
      const hrs = String(Math.floor(diffSec / 3600)).padStart(2, "0");
      const mins = String(Math.floor((diffSec % 3600) / 60)).padStart(2, "0");
      const secs = String(diffSec % 60).padStart(2, "0");
      const cdEl = document.getElementById("sleep-countdown");
      if (cdEl) cdEl.textContent = `متبقي: ${hrs}:${mins}:${secs}`;

      // عندما تدق الساعة 06:55 صباحاً أو 18:55 مساءً
      if (
        (now.getHours() === 6 && now.getMinutes() >= 55) ||
        (now.getHours() === 18 && now.getMinutes() >= 55)
      ) {
        clearInterval(checkTimer);
        clearInterval(keepAliveTimer);
        if (cdEl) cdEl.textContent = "🚀 جاري تسجيل الرصيد الآن...";
        try {
          const freshData = await fetchStockData();
          const ok = await submitFormNow(freshData);
          if (wakeLock) await wakeLock.release();
          if (ok && cdEl) {
            cdEl.style.color = "#22c55e";
            cdEl.textContent = "✅ تم تسجيل الرصيد بنجاح الساعة " + now.toLocaleTimeString("ar-EG");
          }
        } catch (err) {
          if (cdEl) cdEl.textContent = "❌ خطأ: " + err.message;
        }
      }
    }, 5000);

    document.getElementById("btn-cancel-sleep").onclick = async () => {
      clearInterval(checkTimer);
      clearInterval(keepAliveTimer);
      if (wakeLock) {
        try { await wakeLock.release(); } catch (e) {}
      }
      panel.remove();
    };
  };
})();

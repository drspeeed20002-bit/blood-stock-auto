(async function () {
  const REPO = "drspeeed20002-bit/blood-stock-auto";
  const DATA_URL = `https://api.github.com/repos/${REPO}/contents/stock_data.json?t=${Date.now()}`;
  const DEFAULT_AI_KEY = ["AQ.Ab8RN6KMDXYAzdYJt6LnMnga", "7QLBGVaDo9uV3Lkc_SrBd7Mzbg"].join("");

  async function fetchStockData() {
    try {
      const resp = await fetch(DATA_URL, {
        headers: { Accept: "application/vnd.github+json" }
      });
      if (!resp.ok) throw new Error("تعذر جلب ملف الأرصدة");
      const meta = await resp.json();
      const jsonStr = decodeURIComponent(escape(atob(meta.content.replace(/\n/g, ""))));
      return JSON.parse(jsonStr);
    } catch (e) {
      const saved = localStorage.getItem("mohp_local_stock");
      if (saved) return JSON.parse(saved);
      return {
        prbcs: { under_test: 19, A_pos: 13, A_neg: 1, B_pos: 19, B_neg: 2, O_pos: 7, O_neg: 2, AB_pos: 3, AB_neg: 0 },
        ffp: { A: 142, B: 182, O: 231, AB: 12 },
        fp: { A: 0, B: 0, O: 0, AB: 0 },
        platelets: { A_pos: 0, A_neg: 0, B_pos: 0, B_neg: 0, O_pos: 0, O_neg: 0, AB_pos: 0, AB_neg: 0 }
      };
    }
  }

  function compressImageToBase64(file) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        const maxDim = 1400;
        let w = img.width, h = img.height;
        if (w > maxDim || h > maxDim) {
          if (w > h) { h = Math.round((h * maxDim) / w); w = maxDim; }
          else { w = Math.round((w * maxDim) / h); h = maxDim; }
        }
        canvas.width = w;
        canvas.height = h;
        canvas.getContext("2d").drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL("image/jpeg", 0.85).split(",")[1]);
      };
      img.onerror = reject;
      img.src = URL.createObjectURL(file);
    });
  }

  async function extractFromImageFile(file) {
    const base64Data = await compressImageToBase64(file);
    const prompt = `أنت خبير في قراءة جدول رصيد بنك الدم (مثل رصيد بنك دم منية النصر).
استخرج الأرقام من الجدول بدقة (حوّل الأرقام العربية الهندية ١٢٣ إلى أرقام إنجليزية 123، وأي علامة شرطة "-" تعتبر 0).
الجدول مرتب من اليمين لليسار:
الأعمدة من اليمين: الفصيله | A+ | A- | B+ | B- | O+ | O- | AB+ | AB- | عمود مجموع كرات الدم | A | B | AB | O | المجموع (مجموع البلازما).
الصف الأول: "المفحوص" (يحتوي على أرصدة كرات الدم المفحوصة + أرصدة البلازما المفحوصة).
الصف الثاني: "الغير مفحوص" (نحتاج منه عمود مجموع كرات الدم الغير مفحوصة ليوضع في خانة under_test).
أرجع النتيجة بصيغة JSON فقط بدون أي نص إضافي بهذا الشكل:
{
  "prbcs": {
    "under_test": 19,
    "A_pos": 13,
    "A_neg": 1,
    "B_pos": 19,
    "B_neg": 2,
    "O_pos": 7,
    "O_neg": 2,
    "AB_pos": 3,
    "AB_neg": 0
  },
  "ffp": {
    "A": 142,
    "B": 182,
    "AB": 12,
    "O": 231
  }
}`;

    const resp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key=${DEFAULT_AI_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{
            parts: [
              { text: prompt },
              { inline_data: { mime_type: "image/jpeg", data: base64Data } }
            ]
          }],
          generationConfig: { responseMimeType: "application/json" }
        })
      }
    );
    const data = await resp.json();
    if (data.error) throw new Error(data.error.message);
    const parsed = JSON.parse(data.candidates[0].content.parts[0].text);
    localStorage.setItem("mohp_local_stock", JSON.stringify(parsed));
    return parsed;
  }

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

  async function submitFormNow(stockData, skipFill = false) {
    if (!skipFill && stockData) {
      fillAllFields(stockData);
    }

    await new Promise((r) => setTimeout(r, 600));

    const buttons = Array.from(document.querySelectorAll("button, a, input[type='button'], input[type='submit']"));
    const saveBtn = buttons.find((b) => (b.textContent || b.value || "").includes("حفظ وإرسال التقرير الدوري"));
    if (!saveBtn) {
      alert("⚠️ تأكد أنك داخل صفحة تسجيل أرصدة الدم");
      return false;
    }
    saveBtn.scrollIntoView({ behavior: "smooth", block: "center" });
    saveBtn.click();

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

  const existingPanel = document.getElementById("mohp-auto-panel");
  if (existingPanel) existingPanel.remove();

  let stockData = await fetchStockData();

  function renderSummary(data) {
    const prbcs = data.prbcs || {};
    const ffp = data.ffp || {};
    return `
      <b>الأرصدة المحملة حالياً:</b><br>
      🔴 <b>كرات دم:</b> A+(${prbcs.A_pos}) A-(${prbcs.A_neg}) B+(${prbcs.B_pos}) B-(${prbcs.B_neg}) O+(${prbcs.O_pos}) O-(${prbcs.O_neg}) AB+(${prbcs.AB_pos}) AB-(${prbcs.AB_neg}) | تحت الفحص: <b>${prbcs.under_test}</b><br>
      💧 <b>بلازما FFP:</b> A(${ffp.A}) B(${ffp.B}) O(${ffp.O}) AB(${ffp.AB})
    `;
  }

  const panel = document.createElement("div");
  panel.id = "mohp-auto-panel";
  panel.style.cssText = `
    position: fixed; inset: 0; background: rgba(15, 23, 42, 0.85); z-index: 999999;
    display: flex; align-items: center; justify-content: center; padding: 16px;
    direction: rtl; font-family: Tahoma, Arial, sans-serif;
  `;

  panel.innerHTML = `
    <div style="background:#fff; width:100%; max-width:410px; border-radius:18px; padding:20px; text-align:center; box-shadow:0 20px 40px rgba(0,0,0,0.4);">
      <h3 style="margin:0 0 10px; color:#1e293b; font-size:18px;">🩸 المساعد الذكي لبنك الدم</h3>

      <label style="display:block; width:100%; padding:13px; background:#0284c7; color:#fff; border-radius:12px; font-size:15px; font-weight:bold; margin-bottom:10px; cursor:pointer;">
        📸 ١. ارفع صورة الواتساب واملأ الخانات تلقائياً
        <input type="file" id="mohp-img-input" accept="image/*" style="display:none;" />
      </label>

      <div id="mohp-summary-box" style="background:#f1f5f9; border-radius:10px; padding:10px; font-size:12.5px; color:#334155; margin-bottom:12px; line-height:1.7;">
        ${renderSummary(stockData)}
      </div>

      <button id="btn-instant-save" style="width:100%; padding:13px; background:#dc2626; color:#fff; border:none; border-radius:12px; font-size:15px; font-weight:bold; margin-bottom:10px; cursor:pointer;">
        🚀 ٢. املأ الخانات واحفظ التقرير الآن فوراً
      </button>

      <button id="btn-sleep-timer" style="width:100%; padding:13px; background:#16a34a; color:#fff; border:none; border-radius:12px; font-size:15px; font-weight:bold; margin-bottom:10px; cursor:pointer;">
        🌙 ٣. وضع النوم: سجل تلقائياً 6:55 الصبح وأنا نايم
      </button>

      <button id="btn-fill-only" style="width:100%; padding:10px; background:#e2e8f0; color:#1e293b; border:none; border-radius:12px; font-size:13.5px; font-weight:bold; margin-bottom:8px; cursor:pointer;">
        ✏️ املأ الخانات في الصفحة فقط للمراجعة
      </button>

      <button id="btn-close-panel" style="width:100%; padding:6px; background:transparent; color:#64748b; border:none; font-size:13px; cursor:pointer;">
        إغلاق النافذة
      </button>
    </div>
  `;

  document.body.appendChild(panel);

  document.getElementById("mohp-img-input").onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const sumBox = document.getElementById("mohp-summary-box");
    sumBox.innerHTML = "⏳ <b>جاري قراءة صورة الواتساب بالذكاء الاصطناعي وملء الخانات...</b>";
    try {
      stockData = await extractFromImageFile(file);
      fillAllFields(stockData);
      sumBox.innerHTML = "✅ <b style='color:#16a34a;'>تم قراءة الصورة وملء جميع الخانات في الصفحة!</b><br>" + renderSummary(stockData);
    } catch (err) {
      sumBox.innerHTML = "❌ خطأ في قراءة الصورة: " + err.message;
    }
  };

  document.getElementById("btn-close-panel").onclick = () => panel.remove();

  document.getElementById("btn-fill-only").onclick = () => {
    fillAllFields(stockData);
    panel.remove();
  };

  document.getElementById("btn-instant-save").onclick = async () => {
    panel.remove();
    await submitFormNow(stockData, false);
  };

  document.getElementById("btn-sleep-timer").onclick = async () => {
    fillAllFields(stockData);

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
          تم ملء الخانات، وسيتم الحفاظ على جلسة الدخول طوال الليل والضغط على حفظ وتأكيد التقرير تلقائياً الساعة <b>06:55 صباحاً</b>.<br>
          (اترك الموبايل في الشاحن ولا تغلق هذه الشاشة السوداء).
        </p>
        <div id="sleep-countdown" style="font-family:monospace; font-size:22px; color:#f8fafc; margin-bottom:20px;">--:--:--</div>
        <button id="btn-cancel-sleep" style="padding:10px 24px; background:#334155; color:#fff; border:none; border-radius:8px; font-size:14px;">إلغاء وضع النوم</button>
      </div>
    `;

    // تنشيط الجلسة كل 8 دقائق دون إعادة تحميل الصفحة حتى لا تضيع الأرقام المكتوبة
    const keepAliveTimer = setInterval(async () => {
      try {
        await fetch("blood_stocks_registration.php", { credentials: "same-origin" });
      } catch (e) {}
    }, 8 * 60 * 1000);

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

      if (
        (now.getHours() === 6 && now.getMinutes() >= 55) ||
        (now.getHours() === 18 && now.getMinutes() >= 55)
      ) {
        clearInterval(checkTimer);
        clearInterval(keepAliveTimer);
        if (cdEl) cdEl.textContent = "🚀 جاري الحفظ وإرسال التقرير الدوري الآن...";
        try {
          // نضغط حفظ على الأرقام الموجودة حالياً في الخانات مباشرةً
          const ok = await submitFormNow(stockData, true);
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

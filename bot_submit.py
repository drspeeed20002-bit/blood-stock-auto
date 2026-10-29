import os
import sys
import json
import time
import urllib.request
import urllib.parse
from pathlib import Path
from playwright.sync_api import sync_playwright, TimeoutError as PlaywrightTimeoutError

LOGIN_URL = "https://geohealthmap.mohp.gov.eg/gis/login.php"
STOCK_URL = "https://geohealthmap.mohp.gov.eg/gis/blood_stocks_registration.php"
DATA_FILE = Path(__file__).parent / "stock_data.json"


def send_telegram_photo(bot_token: str, chat_id: str, photo_path: str, caption: str):
    """يرسل صورة السكرين شوت مع رسالة تأكيد على تليجرام (اختياري)"""
    if not bot_token or not chat_id or not os.path.exists(photo_path):
        return
    try:
        boundary = "----WebKitFormBoundary7MA4YWxkTrZu0gW"
        url = f"https://api.telegram.org/bot{bot_token}/sendPhoto"
        with open(photo_path, "rb") as f:
            photo_bytes = f.read()

        body = (
            f"--{boundary}\r\n"
            f'Content-Disposition: form-data; name="chat_id"\r\n\r\n{chat_id}\r\n'
            f"--{boundary}\r\n"
            f'Content-Disposition: form-data; name="caption"\r\n\r\n{caption}\r\n'
            f"--{boundary}\r\n"
            f'Content-Disposition: form-data; name="photo"; filename="result.png"\r\n'
            f"Content-Type: image/png\r\n\r\n"
        ).encode("utf-8") + photo_bytes + f"\r\n--{boundary}--\r\n".encode("utf-8")

        req = urllib.request.Request(
            url,
            data=body,
            headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
            method="POST",
        )
        urllib.request.urlopen(req, timeout=20)
        print("✅ تم إرسال سكرين شوت التأكيد على تليجرام بنجاح.")
    except Exception as e:
        print(f"⚠️ تعذر إرسال إشعار تليجرام: {e}")


def fill_section_fields(page, section_title: str, field_map: dict):
    """
    يبحث عن القسم (PRBCs, FFP, FP, Platelets) ويملأ الخانات بداخله بدقة
    مع تفعيل أحداث input و change لضمان تحديث الإجمالي وحالة الفورم.
    """
    result = page.evaluate(
        """({ sectionTitle, fieldMap }) => {
            const log = [];
            // إيجاد الهيدر الذي يحتوي على اسم القسم (مثل PRBCs أو FFP)
            const allElements = Array.from(document.querySelectorAll('*'));
            const headerCandidates = allElements.filter(el => {
                if (el.children.length > 3) return false;
                const txt = (el.textContent || '').trim();
                return txt === sectionTitle || txt.split(/\\s+/)[0] === sectionTitle;
            });

            let sectionContainer = null;
            for (const hdr of headerCandidates) {
                let parent = hdr.parentElement;
                while (parent && parent !== document.body) {
                    const inputs = parent.querySelectorAll('input');
                    if (inputs.length >= 4 && inputs.length <= 15) {
                        sectionContainer = parent;
                        break;
                    }
                    parent = parent.parentElement;
                }
                if (sectionContainer) break;
            }

            if (!sectionContainer) {
                return { success: false, error: `لم يتم العثور على قسم ${sectionTitle}` };
            }

            for (const [labelName, value] of Object.entries(fieldMap)) {
                if (value === null || value === undefined || value === "") continue;

                // البحث عن العنصر الذي يحمل اسم الفصيلة داخل القسم
                const labelEl = Array.from(sectionContainer.querySelectorAll('*')).find(el => {
                    return el.children.length === 0 && (el.textContent || '').trim() === labelName;
                });

                if (!labelEl) {
                    log.push(`⚠️ لم يتم العثور على خانة [${labelName}] داخل قسم [${sectionTitle}]`);
                    continue;
                }

                // الصعود لأقرب كارت يحتوي على input
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

                if (!inputEl) {
                    log.push(`⚠️ لم يتم العثور على حقل إدخال لـ [${labelName}]`);
                    continue;
                }

                const strVal = String(value);
                const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
                    window.HTMLInputElement.prototype,
                    'value'
                ).set;
                nativeInputValueSetter.call(inputEl, strVal);
                inputEl.dispatchEvent(new Event('input', { bubbles: true }));
                inputEl.dispatchEvent(new Event('change', { bubbles: true }));
                inputEl.dispatchEvent(new Event('blur', { bubbles: true }));
                log.push(`✅ [${sectionTitle}] ${labelName} = ${strVal}`);
            }

            return { success: true, log };
        }""",
        {"sectionTitle": section_title, "fieldMap": field_map},
    )

    if not result.get("success"):
        print(f"❌ خطأ في قسم {section_title}: {result.get('error')}")
    else:
        for line in result.get("log", []):
            print(line)


def run_bot(dry_run: bool = False):
    username = os.environ.get("MOHP_USERNAME", "").strip()
    password = os.environ.get("MOHP_PASSWORD", "").strip()
    tg_token = os.environ.get("TELEGRAM_BOT_TOKEN", "").strip()
    tg_chat_id = os.environ.get("TELEGRAM_CHAT_ID", "").strip()

    if not username or not password:
        print("❌ يرجى ضبط متغيرات البيئة MOHP_USERNAME و MOHP_PASSWORD")
        sys.exit(1)

    if not DATA_FILE.exists():
        print(f"❌ ملف البيانات غير موجود: {DATA_FILE}")
        sys.exit(1)

    with open(DATA_FILE, "r", encoding="utf-8") as f:
        stock_data = json.load(f)

    prbcs = stock_data.get("prbcs", {})
    ffp = stock_data.get("ffp", {})
    fp = stock_data.get("fp", {})
    platelets = stock_data.get("platelets", {})

    print("🚀 بدء تشغيل بوت تسجيل رصيد الدم التلقائي...")

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(
            viewport={"width": 430, "height": 932},
            locale="ar-EG",
            timezone_id="Africa/Cairo",
        )
        page = context.new_page()

        try:
            # 1. فتح صفحة تسجيل الدخول
            print("🌐 جاري فتح صفحة تسجيل الدخول...")
            page.goto(LOGIN_URL, wait_until="networkidle", timeout=60000)

            # الانتظار حتى يقوم FingerprintJS بتوليد visitor_id وتفعيل زر الدخول
            page.wait_for_function(
                """() => {
                    const btn = document.querySelector('button[type="submit"]');
                    return btn && !btn.disabled;
                }""",
                timeout=20000,
            )

            print("🔑 جاري إدخال بيانات الحساب...")
            page.fill("#username", username)
            page.fill("#password", password)
            page.click('button[type="submit"]')

            # الانتظار حتى ينجح الدخول
            page.wait_for_load_state("networkidle", timeout=60000)
            time.sleep(2)

            if "login.php" in page.url:
                page.screenshot(path="login_error.png", full_page=True)
                send_telegram_photo(
                    tg_token,
                    tg_chat_id,
                    "login_error.png",
                    "❌ فشل تسجيل الدخول إلى موقع وزارة الصحة. تأكد من اسم المستخدم وكلمة المرور.",
                )
                raise RuntimeError("فشل تسجيل الدخول: ما زلنا في صفحة login.php")

            # 2. الانتقال إلى صفحة تسجيل أرصدة الدم
            print("📋 جاري فتح صفحة تسجيل أرصدة الدم...")
            page.goto(STOCK_URL, wait_until="networkidle", timeout=60000)
            time.sleep(3)

            # 3. ملء بيانات PRBCs (كرات الدم الحمراء)
            prbcs_map = {
                "تحت الفحص": prbcs.get("under_test"),
                "A pos": prbcs.get("A_pos"),
                "A neg": prbcs.get("A_neg"),
                "B pos": prbcs.get("B_pos"),
                "B neg": prbcs.get("B_neg"),
                "O pos": prbcs.get("O_pos"),
                "O neg": prbcs.get("O_neg"),
                "AB pos": prbcs.get("AB_pos"),
                "AB neg": prbcs.get("AB_neg"),
            }
            fill_section_fields(page, "PRBCs", prbcs_map)

            # 4. ملء بيانات FFP (البلازما الطازجة المجمدة)
            ffp_map = {
                "A": ffp.get("A"),
                "B": ffp.get("B"),
                "O": ffp.get("O"),
                "AB": ffp.get("AB"),
            }
            fill_section_fields(page, "FFP", ffp_map)

            # 5. ملء بيانات FP
            fp_map = {
                "A": fp.get("A", 0),
                "B": fp.get("B", 0),
                "O": fp.get("O", 0),
                "AB": fp.get("AB", 0),
            }
            fill_section_fields(page, "FP", fp_map)

            # 6. ملء بيانات Platelets (الصفائح الدموية)
            platelets_map = {
                "A pos": platelets.get("A_pos", 0),
                "A neg": platelets.get("A_neg", 0),
                "B pos": platelets.get("B_pos", 0),
                "B neg": platelets.get("B_neg", 0),
                "O pos": platelets.get("O_pos", 0),
                "O neg": platelets.get("O_neg", 0),
                "AB pos": platelets.get("AB_pos", 0),
                "AB neg": platelets.get("AB_neg", 0),
            }
            fill_section_fields(page, "Platelets", platelets_map)

            time.sleep(1)
            page.screenshot(path="before_submit.png", full_page=True)

            # 7. الضغط على زر "حفظ وإرسال التقرير الدوري"
            print("📤 جاري الضغط على زر [حفظ وإرسال التقرير الدوري]...")
            save_btn = page.locator("text=حفظ وإرسال التقرير الدوري").first
            save_btn.scroll_into_view_if_needed()
            save_btn.click()

            # 8. انتظار نافذة التأكيد "مراجعة كشف الجرد المفتوح"
            print("⏳ انتظار نافذة مراجعة كشف الجرد المفتوح...")
            confirm_btn = page.locator("text=نعم، كشف الأرصدة صحيح بالكامل").first
            confirm_btn.wait_for(state="visible", timeout=15000)
            time.sleep(1)
            page.screenshot(path="confirmation_modal.png")

            if dry_run:
                print("🧪 وضع التجربة (Dry Run): تم التوقف قبل الضغط على زر التأكيد النهائي.")
                send_telegram_photo(
                    tg_token,
                    tg_chat_id,
                    "confirmation_modal.png",
                    "🧪 تجربة ناجحة! تم ملء جميع الخانات وظهور نافذة التأكيد.",
                )
            else:
                print("✅ جاري الضغط على [نعم، كشف الأرصدة صحيح بالكامل]...")
                confirm_btn.click()
                page.wait_for_load_state("networkidle", timeout=30000)
                time.sleep(4)
                page.screenshot(path="result_screenshot.png", full_page=True)
                print("🎉 تم حفظ وإرسال التقرير الدوري بنجاح!")

                summary = (
                    f"✅ تم تسجيل رصيد بنك الدم بنجاح!\n"
                    f"📅 تاريخ البيانات: {stock_data.get('source_date', 'اليوم')}\n"
                    f"🩸 كرات الدم (المفحوص): A+({prbcs.get('A_pos')}) A-({prbcs.get('A_neg')}) "
                    f"B+({prbcs.get('B_pos')}) B-({prbcs.get('B_neg')}) "
                    f"O+({prbcs.get('O_pos')}) O-({prbcs.get('O_neg')}) "
                    f"AB+({prbcs.get('AB_pos')}) AB-({prbcs.get('AB_neg')}) | تحت الفحص: {prbcs.get('under_test')}\n"
                    f"💧 البلازما (FFP): A({ffp.get('A')}) B({ffp.get('B')}) O({ffp.get('O')}) AB({ffp.get('AB')})"
                )
                send_telegram_photo(tg_token, tg_chat_id, "result_screenshot.png", summary)

        finally:
            browser.close()


if __name__ == "__main__":
    is_dry_run = "--dry-run" in sys.argv
    run_bot(dry_run=is_dry_run)

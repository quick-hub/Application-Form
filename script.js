/* ============================================================
   APPLICATION FORM · COMPLETE script.js
   ------------------------------------------------------------
   Handles:
   - form initialization
   - conditional fields (ID, pets, deposit)
   - occupant/kids steppers
   - fee calculation
   - file labels + image/PDF previews
   - image → PNG conversion (front ID, back ID, signature)
   - signature capture
   - validation
  - multipart submission to FormSubmit.co
  - FormSubmit's generated confirmation page
   ------------------------------------------------------------
   ANTI-SPAM:
     • FormSubmit's CAPTCHA remains enabled (do not set _captcha=false).
     • The honeypot field rejects submissions from simple bots.
     • Inbox placement depends on sender authentication and reputation;
       client-side code cannot guarantee it.
   ============================================================ */

(() => {
  "use strict";

  /* ============================================================
     1. CONFIG
     ============================================================ */
  const CONFIG = Object.freeze({
    feePerAdult: 50,
    maxAdults: 20,
    maxKids: 20,

    maxSingleFileMB: 15,
    maxCombinedAttachmentsMB: 9,    // FormSubmit's documented cap is 10 MB

    idDimensionSteps: [1400, 1100, 900, 720, 560, 420],

    signatureMaxWidth: 700,
    signatureHeight: 180
  });

  const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const PHONE_REGEX = /^[+\d][\d\s\-().]{6,}$/;

  /* ============================================================
     2. DOM REFERENCES
     ============================================================ */
  const $ = (id) => document.getElementById(id);

  const form = $("houseAppForm");
  if (!form) {
    console.error("[Application Form] #houseAppForm not found.");
    return;
  }

  const el = {
    submitBtn: $("submitBtn"),
    replyTo: $("_replyto"),
    nextUrl: $("nextUrl"),
    feeHidden: $("feeHidden"),
    signatureUpload: $("signatureUpload"),
    referenceId: $("referenceId"),

    fullname: $("fullname"),
    email: $("email"),
    phone: $("phone"),
    maritalStatus: $("maritalStatus"),
    propertyAddr: $("propertyAddress"),

    idType: $("idType"),
    idUploadGroup: $("idUploadGroup"),
    idFront: $("idFront"),
    idBack: $("idBack"),
    idFrontText: $("idFrontText"),
    idBackText: $("idBackText"),
    idFrontPreview: $("idFrontPreview"),
    idBackPreview: $("idBackPreview"),

    numOccupants: $("numOccupants"),
    numKids: $("numKids"),
    occMinus: $("occMinus"),
    occPlus: $("occPlus"),
    kidsMinus: $("kidsMinus"),
    kidsPlus: $("kidsPlus"),

    smoking: $("smoking"),
    hasPets: $("hasPets"),
    petType: $("petType"),
    petDetails: $("petDetails"),
    petDetailsGroup: $("petDetailsGroup"),

    wantDeposit: $("wantDeposit"),
    depositAmount: $("depositAmount"),
    depositAmountGroup: $("depositAmountGroup"),

    paymentMethod: $("paymentMethod"),

    signaturePad: $("signaturePad"),
    clearSigBtn: $("clearSignature"),

    amountDisplay: $("amountDisplay"),
    amountDisplayValue: $("amountDisplayValue"),
    amountDisplaySub: $("amountDisplaySub"),
    thankYouPanel: $("thankYouPanel"),
    tyName: $("tyName")
  };

  let hasAttemptedSubmit = false;
  let isSubmitting = false;
  let hasSignature = false;

  /* ============================================================
     3. SMALL HELPERS
     ============================================================ */
  function clamp(value, min, max) {
    let n = parseInt(value, 10);
    if (Number.isNaN(n)) n = min;
    return Math.min(Math.max(n, min), max);
  }

  function getGroup(input) {
    return input ? (input.closest(".field-group") || input.closest(".field")) : null;
  }

  function setInvalid(input, invalid) {
    const group = getGroup(input);
    if (!group || group.classList.contains("field--optional")) return;
    group.classList.toggle("is-invalid", invalid);
    group.classList.toggle("invalid", invalid);
  }

  function isFileAllowed(file) {
    return file.type.startsWith("image/") || file.type === "application/pdf";
  }

  function cleanForSubject(text) {
    return String(text || "")
      .replace(/[^\w\s.\-']/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 40);
  }

  function makeReference() {
    return "APP-" + Date.now().toString(36).toUpperCase().slice(-6);
  }

  /* ---------- base64 / PNG helpers ---------- */

  function dataUrlToBlob(dataUrl) {
    const parts = dataUrl.split(",");
    const mime = (parts[0].match(/:(.*?);/) || [])[1] || "image/png";
    const binary = atob(parts[1]);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: mime });
  }

  function loadImageFromFile(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("image decode failed"));
      };
      img.src = url;
    });
  }

  // Draw on white canvas at w×h and return a PNG File.
  function drawToPngFile(source, w, h, fileName) {
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, h);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(source, 0, 0, w, h);

    const dataUrl = canvas.toDataURL("image/png");
    const blob = dataUrlToBlob(dataUrl);
    return new File([blob], fileName, { type: "image/png" });
  }

  // Convert any browser-decodable image to a PNG that fits maxBytes.
  async function imageFileToPng(file, baseName, maxBytes) {
    let img;
    try {
      img = await loadImageFromFile(file);
    } catch (err) {
      console.warn(`Could not decode ${baseName}.`, err);
      return null;
    }

    const longest = Math.max(img.naturalWidth, img.naturalHeight);
    let best = null;

    for (const step of CONFIG.idDimensionSteps) {
      const scale = Math.min(1, step / longest);
      const w = Math.max(1, Math.round(img.naturalWidth * scale));
      const h = Math.max(1, Math.round(img.naturalHeight * scale));

      best = drawToPngFile(img, w, h, `${baseName}.png`);
      if (best.size <= maxBytes) return best;
    }
    return best;
  }

  // Signature canvas → flattened white PNG file.
  function signatureToFile() {
    const src = el.signaturePad;
    const srcW = src.width || 600;
    const srcH = src.height || (CONFIG.signatureHeight * 2);
    const outW = Math.min(srcW, CONFIG.signatureMaxWidth);
    const outH = Math.max(1, Math.round(srcH * (outW / srcW)));
    return drawToPngFile(src, outW, outH, "signature.png");
  }

  /* ============================================================
     4. SIGNATURE PAD
     ============================================================ */
  const sig = { ctx: null, drawing: false, lastX: 0, lastY: 0, width: 0 };

  function setupCanvas() {
    const canvas = el.signaturePad;
    const width = Math.round(canvas.getBoundingClientRect().width);
    if (!width || width === sig.width) return;

    const ratio = Math.max(window.devicePixelRatio || 1, 1);
    const saved = hasSignature ? canvas.toDataURL("image/png") : null;
    const hadWidth = sig.width > 0;

    sig.width = width;
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(CONFIG.signatureHeight * ratio);

    sig.ctx = canvas.getContext("2d");
    sig.ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    sig.ctx.lineWidth = 2.2;
    sig.ctx.lineCap = "round";
    sig.ctx.lineJoin = "round";
    sig.ctx.strokeStyle = "#0b2a4a";

    if (saved && hadWidth) {
      const img = new Image();
      img.onload = () => sig.ctx.drawImage(img, 0, 0, width, CONFIG.signatureHeight);
      img.src = saved;
    }
  }

  function pointerPos(e) {
    const rect = el.signaturePad.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function startDraw(e) {
    e.preventDefault();
    if (!sig.ctx) setupCanvas();
    el.signaturePad.setPointerCapture(e.pointerId);
    sig.drawing = true;
    const p = pointerPos(e);
    sig.lastX = p.x;
    sig.lastY = p.y;
  }

  function draw(e) {
    if (!sig.drawing) return;
    e.preventDefault();
    const p = pointerPos(e);
    sig.ctx.beginPath();
    sig.ctx.moveTo(sig.lastX, sig.lastY);
    sig.ctx.lineTo(p.x, p.y);
    sig.ctx.stroke();
    sig.lastX = p.x;
    sig.lastY = p.y;
    hasSignature = true;
    setInvalid(el.signaturePad, false);
  }

  function endDraw() { sig.drawing = false; }

  function clearSignature() {
    if (!sig.ctx) return;
    sig.ctx.save();
    sig.ctx.setTransform(1, 0, 0, 1, 0, 0);
    sig.ctx.clearRect(0, 0, el.signaturePad.width, el.signaturePad.height);
    sig.ctx.restore();
    hasSignature = false;
    setInvalid(el.signaturePad, false);
  }

  function initSignature() {
    const c = el.signaturePad;
    c.addEventListener("pointerdown", startDraw);
    c.addEventListener("pointermove", draw);
    c.addEventListener("pointerup", endDraw);
    c.addEventListener("pointercancel", endDraw);
    c.addEventListener("pointerleave", endDraw);
    el.clearSigBtn.addEventListener("click", clearSignature);
    window.addEventListener("resize", setupCanvas);
    window.addEventListener("load", setupCanvas);
    setupCanvas();
  }

  /* ============================================================
     5. FEE DISPLAY
     ============================================================ */
  function updateFee() {
    const raw = parseInt(el.numOccupants.value, 10);
    const valid = !Number.isNaN(raw) && raw >= 1;

    el.amountDisplay.hidden = !valid;

    if (!valid) {
      el.feeHidden.value = `$${CONFIG.feePerAdult}.00 USD (1 occupant)`;
      return;
    }

    const adults = clamp(raw, 1, CONFIG.maxAdults);
    const amount = adults * CONFIG.feePerAdult;
    const label = adults === 1 ? "1 occupant" : `${adults} occupants`;

    el.feeHidden.value = `$${amount.toFixed(2)} USD (${label})`;
    el.amountDisplayValue.textContent = `$${amount}`;
    el.amountDisplaySub.textContent = `$${CONFIG.feePerAdult} × ${label}`;
  }

  /* ============================================================
     6. STEPPERS
     ============================================================ */
  function initStepper(input, minusBtn, plusBtn, min, max, onChange) {
    function step(delta) {
      const current = parseInt(input.value, 10);
      input.value = Number.isNaN(current) ? min : clamp(current + delta, min, max);
      onChange();
    }

    minusBtn.addEventListener("click", () => step(-1));
    plusBtn.addEventListener("click", () => step(1));

    input.addEventListener("input", () => {
      input.value = input.value.replace(/\D/g, "").slice(0, 2);
      onChange();
    });

    input.addEventListener("blur", () => {
      if (input.value !== "") input.value = clamp(input.value, min, max);
      onChange();
    });
  }

  /* ============================================================
     7. CONDITIONAL SECTIONS
     ============================================================ */
  function updateIdUploadVisibility() {
    const show = el.idType.value !== "";
    el.idUploadGroup.hidden = !show;

    if (!show) {
      resetFileInput(el.idFront, el.idFrontText, "Click to upload front");
      resetFileInput(el.idBack, el.idBackText, "Click to upload back");
    }
  }

  function updatePetVisibility() {
    const show = el.hasPets.value === "Yes";
    el.petDetailsGroup.hidden = !show;
    if (!show) {
      el.petType.value = "";
      el.petDetails.value = "";
    }
  }

  function updateDepositVisibility() {
    const show = el.wantDeposit.value === "Yes";
    el.depositAmountGroup.hidden = !show;
    if (!show) {
      el.depositAmount.value = "";
      setInvalid(el.depositAmount, false);
    }
  }

  /* ============================================================
     8. ID FILE UPLOADS
     ============================================================ */
  function resetFileInput(input, label, placeholder) {
    input.value = "";
    label.textContent = placeholder;
    const drop = input.closest(".field").querySelector(".file-drop");
    if (drop) drop.classList.remove("has-file");
  }

  function initFileInput(input, label, placeholder, niceName) {
    input.addEventListener("change", () => {
      const file = input.files && input.files[0];

      if (!file) {
        resetFileInput(input, label, placeholder);
        return;
      }

      if (!isFileAllowed(file)) {
        alert(`${niceName} must be an image or PDF file.`);
        resetFileInput(input, label, placeholder);
        return;
      }

      if (file.size > CONFIG.maxSingleFileMB * 1024 * 1024) {
        alert(`${niceName} is too large (limit ${CONFIG.maxSingleFileMB} MB).`);
        resetFileInput(input, label, placeholder);
        return;
      }

      label.textContent = file.name;
      input.closest(".field").querySelector(".file-drop").classList.add("has-file");
    });
  }

  /* ============================================================
     9. VALIDATION
     ============================================================ */
  const notEmpty = (input) => () => input.value !== "";

  const rules = [
    { el: el.fullname,      test: () => el.fullname.value.trim().length >= 2 },
    { el: el.email,         test: () => EMAIL_REGEX.test(el.email.value.trim()) },
    { el: el.phone,         test: () => PHONE_REGEX.test(el.phone.value.trim()) },
    { el: el.propertyAddr,  test: () => el.propertyAddr.value.trim().length >= 4 },
    { el: el.maritalStatus, test: notEmpty(el.maritalStatus) },
    { el: el.numOccupants,  test: () => {
        const n = parseInt(el.numOccupants.value, 10);
        return !Number.isNaN(n) && n >= 1 && n <= CONFIG.maxAdults;
      } },
    { el: el.smoking,       test: notEmpty(el.smoking) },
    { el: el.hasPets,       test: notEmpty(el.hasPets) },
    { el: el.wantDeposit,   test: notEmpty(el.wantDeposit) },
    { el: el.depositAmount, test: () =>
        el.wantDeposit.value !== "Yes" || parseFloat(el.depositAmount.value) > 0 },
    { el: el.paymentMethod, test: notEmpty(el.paymentMethod) },
    { el: el.signaturePad,  test: () => hasSignature }
  ];

  function runRule(rule) {
    const ok = rule.test();
    setInvalid(rule.el, !ok);
    return ok;
  }

  function validateAll() {
    let firstInvalid = null;
    rules.forEach((rule) => {
      if (!runRule(rule) && !firstInvalid) firstInvalid = rule.el;
    });
    return firstInvalid;
  }

  function initLiveValidation() {
    rules.forEach((rule) => {
      if (rule.el === el.signaturePad) return;

      const handler = () => {
        if (hasAttemptedSubmit) runRule(rule);
        else setInvalid(rule.el, false);
      };
      ["input", "change", "blur"].forEach((evt) => rule.el.addEventListener(evt, handler));
    });
  }

  /* ============================================================
     10. SUBMISSION
     ============================================================ */
  function setSubmitting(state) {
    isSubmitting = state;
    el.submitBtn.disabled = state;
    el.submitBtn.innerHTML = state
      ? '<span class="btn-submit__icon">⏳</span><span class="btn-submit__text">Submitting…</span>'
      : '<span class="btn-submit__icon">📨</span><span class="btn-submit__text">Submit application</span>';
  }

  function explainError(err) {
    if (window.location.protocol === "file:") {
      return "This page is open as a local file. Please host it " +
             "(or use a local server such as http://localhost) — " +
             "FormSubmit will not accept requests from file://.";
    }
    return "Your application could not be sent" +
           (err && err.message ? ` (${err.message})` : "") +
           ". Please check your connection and try again.";
  }

  // Assign a File to an <input type="file"> (used to inject the PNGs
  // into the form so FormData picks them up as real multipart parts).
  function setFileInput(input, file) {
    const transfer = new DataTransfer();
    transfer.items.add(file);
    input.files = transfer.files;
  }

  async function prepareIdFile(file, baseName, perFileBudget) {
    if (!file) return null;
    if (!file.type.startsWith("image/")) return file;

    const png = await imageFileToPng(file, baseName, perFileBudget);
    return png || file;
  }

  function showThankYou() {
    let applicantName = el.fullname.value.trim();
    try {
      applicantName = sessionStorage.getItem("rentalApplicationName") || applicantName;
      sessionStorage.removeItem("rentalApplicationName");
    } catch (err) {
      console.warn("Could not restore applicant name for confirmation.", err);
    }
    if (el.tyName) el.tyName.textContent = applicantName || "Applicant";
    form.hidden = true;
    if (el.thankYouPanel) {
      el.thankYouPanel.hidden = false;
      el.thankYouPanel.classList.add("is-visible");
      el.thankYouPanel.scrollIntoView({ behavior: "smooth", block: "start" });
    }

    const title = document.querySelector(".form-header__title");
    const subtitle = document.querySelector(".form-header__subtitle");
    if (title) title.textContent = "Application submitted";
    if (subtitle) subtitle.textContent = "Thank you. Your application was sent successfully.";
  }

  async function submitApplication() {
    setSubmitting(true);

    try {
      if (window.location.protocol === "file:") {
        throw new Error("Host this form on a website or local web server before submitting.");
      }

      const name = el.fullname.value.trim();
      const applicantEmail = el.email.value.trim();
      const ref = makeReference();

      // 1. Reply-to so the email threads back to the applicant.
      el.replyTo.value = applicantEmail;

      // 2. Refresh the fee and application reference fields.
      updateFee();
      if (el.referenceId) el.referenceId.value = ref;

      // 3. Prepare attachments.
      const signatureFile = signatureToFile();

      const idCount =
        (el.idFront.files[0] ? 1 : 0) + (el.idBack.files[0] ? 1 : 0);
      const remaining =
        CONFIG.maxCombinedAttachmentsMB * 1024 * 1024 - signatureFile.size;
      const perFileBudget = idCount ? Math.floor(remaining / idCount) : remaining;

      const frontFile = await prepareIdFile(el.idFront.files[0], "front-id", perFileBudget);
      const backFile  = await prepareIdFile(el.idBack.files[0],  "back-id",  perFileBudget);

      const attachments = [signatureFile];
      if (frontFile) attachments.push(frontFile);
      if (backFile)  attachments.push(backFile);

      const uploadBytes = attachments.reduce((sum, file) => sum + file.size, 0);
      if (uploadBytes > CONFIG.maxCombinedAttachmentsMB * 1024 * 1024) {
        throw new Error(
          `attachments are ${(uploadBytes / 1048576).toFixed(1)} MB, ` +
          `limit is ${CONFIG.maxCombinedAttachmentsMB} MB. Try smaller photos`
        );
      }

      // 4. Inject the PNG files so the browser posts each named file part.
      if (frontFile) setFileInput(el.idFront, frontFile);
      if (backFile)  setFileInput(el.idBack,  backFile);
      setFileInput(el.signatureUpload, signatureFile);

      // 5. Build the subject with reference + applicant name.
      const subjectInput = form.querySelector('[name="_subject"]');
      if (subjectInput) {
        subjectInput.value =
          `Rental application ${ref} - ${cleanForSubject(name)}`;
      }

      const returnUrl = new URL(window.location.href);
      returnUrl.searchParams.set("submitted", "1");
      returnUrl.hash = "";
      el.nextUrl.value = returnUrl.href;
      try {
        sessionStorage.setItem("rentalApplicationName", name);
      } catch (err) {
        console.warn("Could not preserve applicant name for confirmation.", err);
      }

      // Submit all three distinct file fields as native multipart data.
      // FormSubmit then displays its generated confirmation page.
      HTMLFormElement.prototype.submit.call(form);
    } catch (err) {
      console.error("Submission failed:", err);
      setSubmitting(false);
      alert(explainError(err));
    }
  }

  /* ============================================================
     11. FORM SUBMIT HANDLER
     ============================================================ */
  form.addEventListener("submit", function (event) {
    event.preventDefault();
    if (isSubmitting) return;

    hasAttemptedSubmit = true;

    // Honeypot — abort silently if a bot filled the hidden field.
    const honey = form.querySelector('input[name="_honey"]');
    if (honey && honey.value !== "") {
      console.warn("Honeypot triggered — aborting submission.");
      return;
    }

    const firstInvalid = validateAll();
    if (firstInvalid) {
      firstInvalid.scrollIntoView({ behavior: "smooth", block: "center" });
      if (typeof firstInvalid.focus === "function") {
        firstInvalid.focus({ preventScroll: true });
      }
      alert("Please complete the highlighted fields before submitting.");
      return;
    }

    const adults = clamp(el.numOccupants.value, 1, CONFIG.maxAdults);
    const kids = clamp(el.numKids.value || 0, 0, CONFIG.maxKids);

    const confirmed = window.confirm(
      "You are about to submit your application.\n\n" +
      `Adults: ${adults}\n` +
      `Kids: ${kids}\n` +
      `Application fee: $${adults * CONFIG.feePerAdult}\n` +
      `Payment method: ${el.paymentMethod.value}\n\n` +
      "Click OK to submit."
    );
    if (!confirmed) return;

    submitApplication();
  });

  /* ============================================================
     12. INIT
     ============================================================ */
  initSignature();
  initStepper(el.numOccupants, el.occMinus, el.occPlus, 1, CONFIG.maxAdults, updateFee);
  initStepper(el.numKids, el.kidsMinus, el.kidsPlus, 0, CONFIG.maxKids, () => {});
  initFileInput(el.idFront, el.idFrontText, "Click to upload front", "Front ID");
  initFileInput(el.idBack, el.idBackText, "Click to upload back", "Back ID");
  initLiveValidation();

  el.idType.addEventListener("change", updateIdUploadVisibility);
  el.hasPets.addEventListener("change", updatePetVisibility);
  el.wantDeposit.addEventListener("change", updateDepositVisibility);

  if (!el.numKids.value) el.numKids.value = "0";
  updateFee();
  updateIdUploadVisibility();
  updatePetVisibility();
  updateDepositVisibility();

  if (new URLSearchParams(window.location.search).get("submitted") === "1") {
    showThankYou();
  }

  console.info("[Application Form] Initialized successfully.");
})();

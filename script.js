/* ============================================================
   APPLICATION FORM · FormSubmit.co integration
   ------------------------------------------------------------
   Structure
     1. Config
     2. DOM references
     3. Small helpers
     4. Signature pad
     5. Fee display
     6. Steppers
     7. Conditional sections
     8. ID file uploads
     9. Validation
    10. Submission (fetch → FormSubmit AJAX endpoint)
    11. Init
   ============================================================ */

(function () {
  'use strict';

  /* ============================================================
     1. CONFIG
     ============================================================ */
  const CONFIG = {
    // FormSubmit AJAX endpoint (same address as the form's `action`,
    // prefixed with /ajax/). Returns JSON so we know if it really worked.
    endpoint: 'https://formsubmit.co/ajax/Cjsind90@gmail.com',

    feePerAdult: 50,
    maxAdults: 20,
    maxKids: 20,

    // Conservative cap on combined attachments (IDs + signature).
    maxUploadBytes: 5 * 1024 * 1024,

    signatureHeight: 180
  };

  const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const PHONE_REGEX = /^[+\d][\d\s\-().]{6,}$/;

  /* ============================================================
     2. DOM REFERENCES
     ============================================================ */
  const $ = (id) => document.getElementById(id);

  const form = $('houseAppForm');
  if (!form) {
    console.error('Form #houseAppForm not found.');
    return;
  }

  const el = {
    submitBtn: $('submitBtn'),
    replyTo: $('_replyto'),
    feeHidden: $('feeHidden'),

    fullname: $('fullname'),
    email: $('email'),
    phone: $('phone'),
    maritalStatus: $('maritalStatus'),
    propertyAddr: $('propertyAddress'),

    idType: $('idType'),
    idUploadGroup: $('idUploadGroup'),
    idFront: $('idFront'),
    idBack: $('idBack'),
    idFrontText: $('idFrontText'),
    idBackText: $('idBackText'),

    numOccupants: $('numOccupants'),
    numKids: $('numKids'),
    occMinus: $('occMinus'),
    occPlus: $('occPlus'),
    kidsMinus: $('kidsMinus'),
    kidsPlus: $('kidsPlus'),

    smoking: $('smoking'),
    hasPets: $('hasPets'),
    petType: $('petType'),
    petDetails: $('petDetails'),
    petDetailsGroup: $('petDetailsGroup'),

    wantDeposit: $('wantDeposit'),
    depositAmount: $('depositAmount'),
    depositAmountGroup: $('depositAmountGroup'),

    paymentMethod: $('paymentMethod'),

    signaturePad: $('signaturePad'),
    clearSigBtn: $('clearSignature'),

    amountDisplay: $('amountDisplay'),
    amountDisplayValue: $('amountDisplayValue'),
    amountDisplaySub: $('amountDisplaySub'),

    thankYouPanel: $('thankYouPanel'),
    tyName: $('tyName')
  };

  let hasAttemptedSubmit = false;
  let isSubmitting = false;

  /* ============================================================
     3. SMALL HELPERS
     ============================================================ */
  function clamp(value, min, max) {
    let n = parseInt(value, 10);
    if (Number.isNaN(n)) n = min;
    return Math.min(Math.max(n, min), max);
  }

  function getGroup(input) {
    return input ? (input.closest('.field-group') || input.closest('.field')) : null;
  }

  // Toggle the red dot / border / hint (CSS handles the visuals).
  function setInvalid(input, invalid) {
    const group = getGroup(input);
    if (!group || group.classList.contains('field--optional')) return;
    group.classList.toggle('is-invalid', invalid);
    group.classList.toggle('invalid', invalid);
  }

  function isFileAllowed(file) {
    return file.type.startsWith('image/') || file.type === 'application/pdf';
  }

  /* ============================================================
     4. SIGNATURE PAD  (Pointer Events: mouse + touch + pen)
     ============================================================ */
  const sig = { ctx: null, drawing: false, has: false, lastX: 0, lastY: 0, width: 0 };

  function setupCanvas() {
    const canvas = el.signaturePad;
    const width = Math.round(canvas.getBoundingClientRect().width);
    if (!width || width === sig.width) return; // ignore no-op resizes (mobile URL bar)

    const ratio = Math.max(window.devicePixelRatio || 1, 1);
    const saved = sig.has ? canvas.toDataURL('image/png') : null;
    const hadWidth = sig.width > 0;

    sig.width = width;
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(CONFIG.signatureHeight * ratio);

    sig.ctx = canvas.getContext('2d');
    sig.ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    sig.ctx.lineWidth = 2.2;
    sig.ctx.lineCap = 'round';
    sig.ctx.lineJoin = 'round';
    sig.ctx.strokeStyle = '#0b2a4a';

    // Keep the existing signature when the canvas is resized.
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
    sig.has = true;
    setInvalid(el.signaturePad, false);
  }

  function endDraw() {
    sig.drawing = false;
  }

  function clearSignature() {
    if (!sig.ctx) return;
    sig.ctx.clearRect(0, 0, el.signaturePad.width, el.signaturePad.height);
    sig.has = false;
    setInvalid(el.signaturePad, false);
  }

  function signatureToBlob() {
    return new Promise((resolve) => el.signaturePad.toBlob(resolve, 'image/png'));
  }

  function initSignature() {
    const c = el.signaturePad;
    c.addEventListener('pointerdown', startDraw);
    c.addEventListener('pointermove', draw);
    c.addEventListener('pointerup', endDraw);
    c.addEventListener('pointercancel', endDraw);
    el.clearSigBtn.addEventListener('click', clearSignature);
    window.addEventListener('resize', setupCanvas);
    window.addEventListener('load', setupCanvas);
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
    const label = adults === 1 ? '1 occupant' : `${adults} occupants`;

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
      // Empty field: either button starts at the minimum.
      input.value = Number.isNaN(current) ? min : clamp(current + delta, min, max);
      onChange();
    }

    minusBtn.addEventListener('click', () => step(-1));
    plusBtn.addEventListener('click', () => step(1));

    input.addEventListener('input', () => {
      input.value = input.value.replace(/\D/g, '').slice(0, 2);
      onChange();
    });

    input.addEventListener('blur', () => {
      if (input.value !== '') input.value = clamp(input.value, min, max);
      onChange();
    });
  }

  /* ============================================================
     7. CONDITIONAL SECTIONS
     (`[hidden]` is forced to display:none in style.css)
     ============================================================ */
  function updateIdUploadVisibility() {
    const show = el.idType.value !== '';
    el.idUploadGroup.hidden = !show;

    if (!show) {
      resetFileInput(el.idFront, el.idFrontText, 'Click to upload front');
      resetFileInput(el.idBack, el.idBackText, 'Click to upload back');
    }
  }

  function updatePetVisibility() {
    const show = el.hasPets.value === 'Yes';
    el.petDetailsGroup.hidden = !show;
    if (!show) {
      el.petType.value = '';
      el.petDetails.value = '';
    }
  }

  function updateDepositVisibility() {
    const show = el.wantDeposit.value === 'Yes';
    el.depositAmountGroup.hidden = !show;
    if (!show) {
      el.depositAmount.value = '';
      setInvalid(el.depositAmount, false);
    }
  }

  /* ============================================================
     8. ID FILE UPLOADS  (optional)
     ============================================================ */
  function resetFileInput(input, label, placeholder) {
    input.value = '';
    label.textContent = placeholder;
    const drop = input.closest('.field').querySelector('.file-drop');
    if (drop) drop.classList.remove('has-file');
  }

  function initFileInput(input, label, placeholder, niceName) {
    input.addEventListener('change', () => {
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

      if (file.size > CONFIG.maxUploadBytes) {
        alert(`${niceName} is too large (limit ${CONFIG.maxUploadBytes / 1048576} MB).`);
        resetFileInput(input, label, placeholder);
        return;
      }

      label.textContent = file.name;
      input.closest('.field').querySelector('.file-drop').classList.add('has-file');
    });
  }

  /* ============================================================
     9. VALIDATION  (table-driven)
     ------------------------------------------------------------
     Each rule: the element that gets the red styling + a test.
     Order here = order of "scroll to first error".
     ============================================================ */
  const notEmpty = (input) => () => input.value !== '';

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
        el.wantDeposit.value !== 'Yes' || parseFloat(el.depositAmount.value) > 0 },
    { el: el.paymentMethod, test: notEmpty(el.paymentMethod) },
    { el: el.signaturePad,  test: () => sig.has }
  ];

  function runRule(rule) {
    const ok = rule.test();
    setInvalid(rule.el, !ok);
    return ok;
  }

  // Runs every rule (so all errors show at once); returns the first failing element.
  function validateAll() {
    let firstInvalid = null;
    rules.forEach((rule) => {
      if (!runRule(rule) && !firstInvalid) firstInvalid = rule.el;
    });
    return firstInvalid;
  }

  // Live validation: only after the first submit attempt.
  function initLiveValidation() {
    rules.forEach((rule) => {
      if (rule.el === el.signaturePad) return; // handled while drawing

      const handler = () => {
        if (hasAttemptedSubmit) runRule(rule);
        else setInvalid(rule.el, false);
      };
      ['input', 'change', 'blur'].forEach((evt) => rule.el.addEventListener(evt, handler));
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

  function showThankYou() {
    el.tyName.textContent = el.fullname.value.trim() || 'Applicant';
    form.style.display = 'none';

    el.thankYouPanel.hidden = false;
    el.thankYouPanel.classList.add('is-visible');
    el.thankYouPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });

    const title = document.querySelector('.form-header__title');
    const subtitle = document.querySelector('.form-header__subtitle');
    if (title) title.textContent = '✅ Application Submitted';
    if (subtitle) subtitle.textContent = 'Thank you for your submission.';
  }

  function explainError(err) {
    if (window.location.protocol === 'file:') {
      return 'This page is open as a local file. Please host it (or use a local ' +
             'server such as http://localhost) — FormSubmit will not accept requests from file://.';
    }
    return 'Your application could not be sent' +
           (err && err.message ? ` (${err.message})` : '') +
           '. Please check your connection and try again.';
  }

  async function submitApplication() {
    setSubmitting(true);

    try {
      el.replyTo.value = el.email.value.trim();
      updateFee();

      // Collects every named field, including the ID files.
      const data = new FormData(form);

      // Signature → real PNG attachment.
      const blob = await signatureToBlob();
      if (!blob) throw new Error('signature could not be read');

      const uploadBytes =
        blob.size +
        ((el.idFront.files[0] && el.idFront.files[0].size) || 0) +
        ((el.idBack.files[0] && el.idBack.files[0].size) || 0);

      if (uploadBytes > CONFIG.maxUploadBytes) {
        throw new Error(`attachments exceed ${CONFIG.maxUploadBytes / 1048576} MB`);
      }

      data.set('signature_image', blob, 'signature.png');

      // Don't set Content-Type — the browser adds the multipart boundary.
      const response = await fetch(CONFIG.endpoint, {
        method: 'POST',
        headers: { Accept: 'application/json' },
        body: data
      });

      let result = {};
      try { result = await response.json(); } catch (_) { /* non-JSON reply */ }

      const failed = !response.ok || result.success === false || result.success === 'false';
      if (failed) throw new Error(result.message || `HTTP ${response.status}`);

      showThankYou();
    } catch (err) {
      console.error('Submission failed:', err);
      setSubmitting(false);
      alert(explainError(err));
    }
  }

  form.addEventListener('submit', function (event) {
    event.preventDefault(); // we always submit via fetch
    if (isSubmitting) return;

    hasAttemptedSubmit = true;

    const firstInvalid = validateAll();
    if (firstInvalid) {
      firstInvalid.scrollIntoView({ behavior: 'smooth', block: 'center' });
      if (typeof firstInvalid.focus === 'function') firstInvalid.focus({ preventScroll: true });
      alert('Please complete the highlighted fields before submitting.');
      return;
    }

    const adults = clamp(el.numOccupants.value, 1, CONFIG.maxAdults);
    const kids = clamp(el.numKids.value || 0, 0, CONFIG.maxKids);

    const confirmed = window.confirm(
      'You are about to submit your application.\n\n' +
      `Adults: ${adults}\n` +
      `Kids: ${kids}\n` +
      `Application fee: $${adults * CONFIG.feePerAdult}\n` +
      `Payment method: ${el.paymentMethod.value}\n\n` +
      'Click OK to submit.'
    );
    if (!confirmed) return;

    submitApplication();
  });

  /* ============================================================
     11. INIT
     ============================================================ */
  initSignature();
  initStepper(el.numOccupants, el.occMinus, el.occPlus, 1, CONFIG.maxAdults, updateFee);
  initStepper(el.numKids, el.kidsMinus, el.kidsPlus, 0, CONFIG.maxKids, () => {});
  initFileInput(el.idFront, el.idFrontText, 'Click to upload front', 'Front ID');
  initFileInput(el.idBack, el.idBackText, 'Click to upload back', 'Back ID');
  initLiveValidation();

  el.idType.addEventListener('change', updateIdUploadVisibility);
  el.hasPets.addEventListener('change', updatePetVisibility);
  el.wantDeposit.addEventListener('change', updateDepositVisibility);

  if (!el.numKids.value) el.numKids.value = '0';
  updateFee();
  updateIdUploadVisibility();
  updatePetVisibility();
  updateDepositVisibility();
})();

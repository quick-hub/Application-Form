/* ============================================================
   APPLICATION FORM · FormSubmit.co integration
   ------------------------------------------------------------
   - Validates the complete application before sending
   - Sends ALL named form fields to FormSubmit
   - Sends optional ID files
   - Converts the drawn signature to a real PNG attachment
   - Uses the documented native FormSubmit endpoint:
       https://formsubmit.co/Cjsind90@gmail.com
   - Uses a hidden iframe so the page does not navigate away
   - Does NOT use the iframe's initial load as a success signal
   - Shows the thank-you panel only after the POST has been sent
   ============================================================ */

(function () {
  'use strict';

  const form = document.getElementById('houseAppForm');
  if (!form) {
    console.error('Application form #houseAppForm was not found.');
    return;
  }

  /* ------------------------------------------------------------
     DOM
     ------------------------------------------------------------ */
  const feeHidden = document.getElementById('feeHidden');
  const submitBtn = document.getElementById('submitBtn');
  const hiddenFrame = document.getElementById('hiddenFrame');

  const fullname = document.getElementById('fullname');
  const email = document.getElementById('email');
  const phone = document.getElementById('phone');
  const maritalStatus = document.getElementById('maritalStatus');
  const propertyAddr = document.getElementById('propertyAddress');

  const idType = document.getElementById('idType');
  const idUploadGroup = document.getElementById('idUploadGroup');
  const idFront = document.getElementById('idFront');
  const idBack = document.getElementById('idBack');
  const idFrontText = document.getElementById('idFrontText');
  const idBackText = document.getElementById('idBackText');

  const numOccupants = document.getElementById('numOccupants');
  const numKids = document.getElementById('numKids');
  const occMinus = document.getElementById('occMinus');
  const occPlus = document.getElementById('occPlus');
  const kidsMinus = document.getElementById('kidsMinus');
  const kidsPlus = document.getElementById('kidsPlus');

  const smoking = document.getElementById('smoking');
  const hasPets = document.getElementById('hasPets');
  const petType = document.getElementById('petType');
  const petDetails = document.getElementById('petDetails');
  const petDetailsGroup = document.getElementById('petDetailsGroup');

  const wantDeposit = document.getElementById('wantDeposit');
  const depositAmount = document.getElementById('depositAmount');
  const depositAmountGroup = document.getElementById('depositAmountGroup');
  const depositAmountHint = document.getElementById('depositAmountHint');

  const paymentMethod = document.getElementById('paymentMethod');

  const signaturePad = document.getElementById('signaturePad');
  const clearSigBtn = document.getElementById('clearSignature');
  const signatureData = document.getElementById('signatureData');
  const signatureImgInput = document.getElementById('signatureImageInput');

  const fullnameHint = document.getElementById('fullnameHint');
  const emailHint = document.getElementById('emailHint');
  const phoneHint = document.getElementById('phoneHint');
  const propertyAddrHint = document.getElementById('propertyAddressHint');
  const signatureHint = document.getElementById('signatureHint');
  const numOccupantsHint = document.getElementById('numOccupantsHint');

  const feeSummaryText = document.getElementById('feeSummaryText');
  const feeAmountEl = document.getElementById('feeAmount');
  const amountDisplay = document.getElementById('amountDisplay');
  const amountDisplayValue = document.getElementById('amountDisplayValue');
  const amountDisplaySub = document.getElementById('amountDisplaySub');

  const thankYouPanel = document.getElementById('thankYouPanel');
  const tyName = document.getElementById('tyName');

  /* ------------------------------------------------------------
     Constants / state
     ------------------------------------------------------------ */
  const FEE_PER_OCCUPANT = 50;
  const MAX_OCCUPANTS = 20;
  const MAX_KIDS = 20;
  const MAX_FILE_SIZE = 10 * 1024 * 1024; // FormSubmit total upload limit
  const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const PHONE_REGEX = /^[+\d][\d\s\-().]{6,}$/;

  let hasAttemptedSubmit = false;
  let isSubmitting = false;
  let submissionSent = false;

  /* ------------------------------------------------------------
     Helpers
     ------------------------------------------------------------ */
  function getFieldGroup(input) {
    if (!input) return null;
    return input.closest('.field-group') || input.closest('.field');
  }

  function clearInvalid(input, hint) {
    const group = getFieldGroup(input);
    if (group) group.classList.remove('is-invalid', 'invalid');
    if (hint) hint.style.display = 'none';
  }

  function markInvalid(input, hint, invalid) {
    const group = getFieldGroup(input);
    if (!group) return;

    if (group.classList.contains('field--optional')) {
      group.classList.remove('is-invalid', 'invalid');
      if (hint) hint.style.display = 'none';
      return;
    }

    group.classList.toggle('is-invalid', invalid);
    group.classList.toggle('invalid', invalid);
    if (hint) hint.style.display = invalid ? 'block' : 'none';
  }

  function clampValue(value, min, max) {
    let n = parseInt(value, 10);
    if (Number.isNaN(n)) n = min;
    return Math.min(Math.max(n, min), max);
  }

  function showSubmitError(message) {
    alert(message);
  }

  /* ------------------------------------------------------------
     Signature pad
     ------------------------------------------------------------ */
  let ctx = null;
  let drawing = false;
  let hasSignature = false;
  let lastX = 0;
  let lastY = 0;

  function resizeCanvas() {
    if (!signaturePad) return;

    const rect = signaturePad.getBoundingClientRect();
    const cssWidth = Math.max(rect.width, 1);
    const cssHeight = 180;
    const ratio = Math.max(window.devicePixelRatio || 1, 1);

    // Preserve existing drawing when possible.
    const oldData = hasSignature ? signaturePad.toDataURL('image/png') : null;

    signaturePad.width = Math.round(cssWidth * ratio);
    signaturePad.height = Math.round(cssHeight * ratio);
    signaturePad.style.height = cssHeight + 'px';

    ctx = signaturePad.getContext('2d');
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.lineWidth = 2.2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#0b2a4a';

    if (oldData) {
      const image = new Image();
      image.onload = function () {
        ctx.drawImage(image, 0, 0, cssWidth, cssHeight);
      };
      image.src = oldData;
    }
  }

  function getPointerPosition(event) {
    const rect = signaturePad.getBoundingClientRect();
    const source = event.touches && event.touches.length
      ? event.touches[0]
      : event;

    return {
      x: source.clientX - rect.left,
      y: source.clientY - rect.top
    };
  }

  function startDraw(event) {
    event.preventDefault();
    if (!ctx) resizeCanvas();

    drawing = true;
    const pos = getPointerPosition(event);
    lastX = pos.x;
    lastY = pos.y;
  }

  function draw(event) {
    if (!drawing || !ctx) return;

    event.preventDefault();

    const pos = getPointerPosition(event);
    ctx.beginPath();
    ctx.moveTo(lastX, lastY);
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();

    lastX = pos.x;
    lastY = pos.y;
    hasSignature = true;

    clearInvalid(signaturePad, signatureHint);
  }

  function endDraw() {
    drawing = false;
  }

  function clearSignature() {
    if (!signaturePad || !ctx) return;

    ctx.clearRect(0, 0, signaturePad.width, signaturePad.height);
    hasSignature = false;

    if (signatureData) signatureData.value = '';
    if (signatureImgInput) signatureImgInput.value = '';

    clearInvalid(signaturePad, signatureHint);
  }

  if (signaturePad) {
    signaturePad.addEventListener('mousedown', startDraw);
    signaturePad.addEventListener('mousemove', draw);
    signaturePad.addEventListener('mouseup', endDraw);
    signaturePad.addEventListener('mouseleave', endDraw);

    signaturePad.addEventListener('touchstart', startDraw, { passive: false });
    signaturePad.addEventListener('touchmove', draw, { passive: false });
    signaturePad.addEventListener('touchend', endDraw, { passive: true });

    window.addEventListener('resize', resizeCanvas);
    window.addEventListener('load', resizeCanvas);
    resizeCanvas();
  }

  function signatureToFile() {
    if (!signaturePad || !hasSignature) return null;

    const dataURL = signaturePad.toDataURL('image/png');
    const parts = dataURL.split(',');
    if (parts.length !== 2) return null;

    const byteString = atob(parts[1]);
    const bytes = new Uint8Array(byteString.length);

    for (let i = 0; i < byteString.length; i++) {
      bytes[i] = byteString.charCodeAt(i);
    }

    return new File(
      [bytes],
      'application-signature.png',
      { type: 'image/png' }
    );
  }

  function attachSignatureToForm() {
    const file = signatureToFile();
    if (!file || !signatureImgInput) return false;

    try {
      const transfer = new DataTransfer();
      transfer.items.add(file);
      signatureImgInput.files = transfer.files;

      if (signatureData) {
        signatureData.value = signaturePad.toDataURL('image/png');
      }

      return true;
    } catch (error) {
      console.error('Unable to attach signature:', error);
      return false;
    }
  }

  /* ------------------------------------------------------------
     Fee
     ------------------------------------------------------------ */
  function updateFee() {
    const raw = parseInt(numOccupants ? numOccupants.value : '', 10);

    if (Number.isNaN(raw) || raw < 1) {
      if (amountDisplay) amountDisplay.style.display = 'none';
      if (feeHidden) feeHidden.value = '$50.00 USD (1 occupant)';
      return;
    }

    const occupants = clampValue(raw, 1, MAX_OCCUPANTS);
    const amount = occupants * FEE_PER_OCCUPANT;
    const label = occupants === 1 ? '1 occupant' : `${occupants} occupants`;

    if (feeHidden) feeHidden.value = `$${amount.toFixed(2)} USD (${label})`;
    if (feeSummaryText) feeSummaryText.textContent = `Application fee (${label})`;

    if (feeAmountEl) {
      feeAmountEl.textContent = `$${amount}`;
    }

    if (amountDisplay) {
      amountDisplay.style.display = 'flex';
      if (amountDisplayValue) amountDisplayValue.textContent = `$${amount}`;
      if (amountDisplaySub) {
        amountDisplaySub.textContent =
          `$${FEE_PER_OCCUPANT} × ${occupants} ${occupants === 1 ? 'occupant' : 'occupants'}`;
      }
    }
  }

  /* ------------------------------------------------------------
     Steppers
     ------------------------------------------------------------ */
  function stepOccupants(delta) {
    const current = clampValue(numOccupants.value || 1, 1, MAX_OCCUPANTS);
    numOccupants.value = clampValue(current + delta, 1, MAX_OCCUPANTS);
    if (hasAttemptedSubmit) validateOccupants();
    updateFee();
  }

  function stepKids(delta) {
    const current = clampValue(numKids.value || 0, 0, MAX_KIDS);
    numKids.value = clampValue(current + delta, 0, MAX_KIDS);
  }

  if (occMinus) occMinus.addEventListener('click', () => stepOccupants(-1));
  if (occPlus) occPlus.addEventListener('click', () => stepOccupants(1));
  if (kidsMinus) kidsMinus.addEventListener('click', () => stepKids(-1));
  if (kidsPlus) kidsPlus.addEventListener('click', () => stepKids(1));

  /* ------------------------------------------------------------
     Conditional sections
     ------------------------------------------------------------ */
  function updateIdUploadVisibility() {
    if (!idUploadGroup || !idType) return;

    const selected = idType.value.trim() !== '';
    idUploadGroup.hidden = !selected;
    idUploadGroup.style.display = selected ? '' : 'none';

    if (!selected) {
      if (idFront) idFront.value = '';
      if (idBack) idBack.value = '';
      if (idFrontText) idFrontText.textContent = 'Click to upload front';
      if (idBackText) idBackText.textContent = 'Click to upload back';

      clearInvalid(idFront);
      clearInvalid(idBack);
    }
  }

  function updatePetDetailsVisibility() {
    if (!hasPets || !petDetailsGroup || !petType) return;

    const visible = hasPets.value === 'Yes';
    petDetailsGroup.hidden = !visible;
    petDetailsGroup.style.display = visible ? 'flex' : 'none';
    petType.required = visible;

    if (!visible) {
      petType.value = '';
      if (petDetails) petDetails.value = '';
    }
  }

  function updateDepositVisibility() {
    if (!wantDeposit || !depositAmountGroup || !depositAmount) return;

    const visible = wantDeposit.value === 'Yes';
    depositAmountGroup.hidden = !visible;
    depositAmountGroup.style.display = visible ? 'flex' : 'none';
    depositAmount.required = visible;

    if (!visible) {
      depositAmount.value = '';
      clearInvalid(depositAmount, depositAmountHint);
    }
  }

  /* ------------------------------------------------------------
     File labels + upload validation
     ------------------------------------------------------------ */
  function validateFile(file, label) {
    if (!file) return true;

    if (file.size > MAX_FILE_SIZE) {
      showSubmitError(`${label} is too large. The total FormSubmit upload limit is 10 MB.`);
      return false;
    }

    const allowed = [
      'image/jpeg',
      'image/png',
      'image/webp',
      'image/gif',
      'application/pdf'
    ];

    if (!allowed.includes(file.type)) {
      showSubmitError(`${label} must be an image or PDF file.`);
      return false;
    }

    return true;
  }

  if (idFront) {
    idFront.addEventListener('change', function () {
      const file = this.files && this.files[0];

      if (file) {
        if (!validateFile(file, 'Front ID')) {
          this.value = '';
          return;
        }

        if (idFrontText) idFrontText.textContent = file.name;
        const drop = this.closest('.field')?.querySelector('.file-drop');
        if (drop) drop.classList.add('has-file');
      } else if (idFrontText) {
        idFrontText.textContent = 'Click to upload front';
      }
    });
  }

  if (idBack) {
    idBack.addEventListener('change', function () {
      const file = this.files && this.files[0];

      if (file) {
        if (!validateFile(file, 'Back ID')) {
          this.value = '';
          return;
        }

        if (idBackText) idBackText.textContent = file.name;
        const drop = this.closest('.field')?.querySelector('.file-drop');
        if (drop) drop.classList.add('has-file');
      } else if (idBackText) {
        idBackText.textContent = 'Click to upload back';
      }
    });
  }

  /* ------------------------------------------------------------
     Validation
     ------------------------------------------------------------ */
  function validateFullname() {
    const valid = fullname.value.trim().length >= 2;
    markInvalid(fullname, fullnameHint, !valid);
    return valid;
  }

  function validateEmail() {
    const valid = EMAIL_REGEX.test(email.value.trim());
    markInvalid(email, emailHint, !valid);
    return valid;
  }

  function validatePhone() {
    const valid = PHONE_REGEX.test(phone.value.trim());
    markInvalid(phone, phoneHint, !valid);
    return valid;
  }

  function validatePropertyAddress() {
    const valid = propertyAddr.value.trim().length >= 4;
    markInvalid(propertyAddr, propertyAddrHint, !valid);
    return valid;
  }

  function validateOccupants() {
    const n = parseInt(numOccupants.value, 10);
    const valid = !Number.isNaN(n) && n >= 1 && n <= MAX_OCCUPANTS;
    markInvalid(numOccupants, numOccupantsHint, !valid);
    return valid;
  }

  function validateDepositAmount() {
    if (wantDeposit.value !== 'Yes') {
      clearInvalid(depositAmount, depositAmountHint);
      return true;
    }

    const value = parseFloat(depositAmount.value);
    const valid = !Number.isNaN(value) && value > 0;
    markInvalid(depositAmount, depositAmountHint, !valid);
    return valid;
  }

  function validateSignature() {
    const valid = hasSignature;
    const group = getFieldGroup(signaturePad);

    if (group) {
      group.classList.toggle('is-invalid', !valid);
      group.classList.toggle('invalid', !valid);
    }

    if (signatureHint) signatureHint.style.display = valid ? 'none' : 'block';
    return valid;
  }

  function validateSelect(select) {
    const valid = !!select && select.value !== '';
    const group = getFieldGroup(select);

    if (group) {
      group.classList.toggle('is-invalid', !valid);
      group.classList.toggle('invalid', !valid);
    }

    return valid;
  }

  function validateAll() {
    return {
      fullname: validateFullname(),
      email: validateEmail(),
      phone: validatePhone(),
      property: validatePropertyAddress(),
      marital: validateSelect(maritalStatus),
      occupants: validateOccupants(),
      smoking: validateSelect(smoking),
      pets: validateSelect(hasPets),
      depositChoice: validateSelect(wantDeposit),
      depositAmount: validateDepositAmount(),
      payment: validateSelect(paymentMethod),
      signature: validateSignature()
    };
  }

  function isValidResult(result) {
    return Object.values(result).every(Boolean);
  }

  function focusFirstInvalid(result) {
    const first = !result.fullname ? fullname
      : !result.email ? email
      : !result.phone ? phone
      : !result.property ? propertyAddr
      : !result.marital ? maritalStatus
      : !result.occupants ? numOccupants
      : !result.smoking ? smoking
      : !result.pets ? hasPets
      : !result.depositChoice ? wantDeposit
      : !result.depositAmount ? depositAmount
      : !result.payment ? paymentMethod
      : !result.signature ? signaturePad
      : null;

    if (first) {
      try {
        first.focus();
        first.scrollIntoView({ behavior: 'smooth', block: 'center' });
      } catch (_) {}
    }
  }

  function liveValidate(fn) {
    return function () {
      if (hasAttemptedSubmit) {
        fn();
      } else {
        clearInvalid(this);
      }
    };
  }

  /* ------------------------------------------------------------
     Events
     ------------------------------------------------------------ */
  fullname.addEventListener('blur', liveValidate(validateFullname));
  email.addEventListener('blur', liveValidate(validateEmail));
  phone.addEventListener('blur', liveValidate(validatePhone));
  propertyAddr.addEventListener('blur', liveValidate(validatePropertyAddress));

  fullname.addEventListener('input', liveValidate(validateFullname));
  email.addEventListener('input', liveValidate(validateEmail));
  phone.addEventListener('input', liveValidate(validatePhone));
  propertyAddr.addEventListener('input', liveValidate(validatePropertyAddress));

  numOccupants.addEventListener('input', function () {
    this.value = this.value.replace(/[^\d]/g, '').slice(0, 2);
    if (hasAttemptedSubmit) validateOccupants();
    updateFee();
  });

  numOccupants.addEventListener('blur', function () {
    if (hasAttemptedSubmit) validateOccupants();
  });

  numKids.addEventListener('input', function () {
    this.value = this.value.replace(/[^\d]/g, '').slice(0, 2);
  });

  numKids.addEventListener('blur', function () {
    this.value = clampValue(this.value || 0, 0, MAX_KIDS);
  });

  idType.addEventListener('change', function () {
    updateIdUploadVisibility();
    if (hasAttemptedSubmit) validateSelect(idType);
  });

  maritalStatus.addEventListener('change', function () {
    if (hasAttemptedSubmit) validateSelect(maritalStatus);
  });

  smoking.addEventListener('change', function () {
    if (hasAttemptedSubmit) validateSelect(smoking);
  });

  hasPets.addEventListener('change', function () {
    updatePetDetailsVisibility();
    if (hasAttemptedSubmit) validateSelect(hasPets);
  });

  wantDeposit.addEventListener('change', function () {
    updateDepositVisibility();
    if (hasAttemptedSubmit) validateSelect(wantDeposit);
  });

  paymentMethod.addEventListener('change', function () {
    if (hasAttemptedSubmit) validateSelect(paymentMethod);
  });

  depositAmount.addEventListener('input', function () {
    if (hasAttemptedSubmit) validateDepositAmount();
  });

  depositAmount.addEventListener('blur', function () {
    if (hasAttemptedSubmit) validateDepositAmount();
  });

  /* ------------------------------------------------------------
     Submission
     ------------------------------------------------------------ */
  function showThankYou() {
    if (tyName) tyName.textContent = fullname.value.trim() || 'Applicant';

    form.style.display = 'none';

    if (thankYouPanel) {
      thankYouPanel.hidden = false;
      thankYouPanel.classList.add('is-visible');

      try {
        thankYouPanel.scrollIntoView({
          behavior: 'smooth',
          block: 'start'
        });
      } catch (_) {}
    }

    const title = document.querySelector('.form-header__title');
    if (title) title.textContent = '✅ Application Submitted';

    const subtitle = document.querySelector('.form-header__subtitle');
    if (subtitle) subtitle.textContent = 'Thank you for your submission.';
  }

  function restoreSubmitButton() {
    isSubmitting = false;

    if (!submitBtn) return;

    submitBtn.disabled = false;
    submitBtn.innerHTML =
      '<span class="btn-submit__icon">📨</span>' +
      '<span class="btn-submit__text">Submit application</span>';
  }

  function prepareFormForSubmit() {
    // Keep FormSubmit's Reply-To tied to the applicant.
    const replyTo = document.getElementById('_replyto');
    if (replyTo) replyTo.value = email.value.trim();

    // Give FormSubmit the exact current page URL.
    const urlField = document.getElementById('_formUrl');
    if (urlField) urlField.value = window.location.href;

    // Make sure dynamic fee information is current.
    updateFee();

    // Capture signature.
    if (!attachSignatureToForm()) {
      return false;
    }

    // Make sure the browser has a complete multipart form.
    return true;
  }

  form.addEventListener('submit', function (event) {
    if (isSubmitting) {
      event.preventDefault();
      return;
    }

    hasAttemptedSubmit = true;

    const result = validateAll();

    if (!isValidResult(result)) {
      event.preventDefault();
      focusFirstInvalid(result);
      showSubmitError('Please complete the highlighted fields before submitting.');
      return;
    }

    // Check optional uploads before the request leaves the browser.
    if (idFront?.files?.[0] && !validateFile(idFront.files[0], 'Front ID')) {
      event.preventDefault();
      return;
    }

    if (idBack?.files?.[0] && !validateFile(idBack.files[0], 'Back ID')) {
      event.preventDefault();
      return;
    }

    const totalUploadSize =
      (idFront?.files?.[0]?.size || 0) +
      (idBack?.files?.[0]?.size || 0);

    // Signature is normally very small, but include it in the check.
    const signatureFile = signatureToFile();
    const totalWithSignature = totalUploadSize + (signatureFile?.size || 0);

    if (totalWithSignature > MAX_FILE_SIZE) {
      event.preventDefault();
      showSubmitError('The selected files are larger than FormSubmit’s 10 MB total upload limit.');
      return;
    }

    if (!prepareFormForSubmit()) {
      event.preventDefault();
      showSubmitError('Your signature could not be prepared. Please clear it and sign again.');
      return;
    }

    const occupants = clampValue(numOccupants.value, 1, MAX_OCCUPANTS);
    const kids = clampValue(numKids.value || 0, 0, MAX_KIDS);
    const amount = occupants * FEE_PER_OCCUPANT;

    const confirmed = window.confirm(
      'You are about to submit your application.\n\n' +
      `Adults: ${occupants}\n` +
      `Kids: ${kids}\n` +
      `Application fee: $${amount}\n` +
      `Payment method: ${paymentMethod.value}\n\n` +
      'Click OK to submit the application.'
    );

    if (!confirmed) {
      event.preventDefault();
      return;
    }

    /*
      IMPORTANT:
      Do NOT call preventDefault() here.

      The browser now performs the documented native POST to:
      https://formsubmit.co/Cjsind90@gmail.com

      Because target="hiddenFrame" is present, the FormSubmit response
      is loaded into the hidden iframe instead of navigating this page.
    */
    isSubmitting = true;

    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.innerHTML =
        '<span class="btn-submit__icon">⏳</span>' +
        '<span class="btn-submit__text">Submitting…</span>';
    }

    /*
      FormSubmit's native form submission is asynchronous from the page's
      point of view. We don't use the iframe's first load event as proof of
      success because the iframe may already have loaded before submission.

      The POST itself is allowed to leave the page. After a short delay,
      display the confirmation UI. The actual email delivery is handled by
      FormSubmit.
    */
    setTimeout(function () {
      if (!isSubmitting) return;

      submissionSent = true;
      showThankYou();
    }, 1800);
  });

  /* ------------------------------------------------------------
     Initialization
     ------------------------------------------------------------ */
  if (numKids && !numKids.value) numKids.value = '0';

  updateFee();
  updateIdUploadVisibility();
  updatePetDetailsVisibility();
  updateDepositVisibility();

  console.log(
    'Application Form ready. FormSubmit endpoint:',
    'https://formsubmit.co/Cjsind90@gmail.com'
  );
})();

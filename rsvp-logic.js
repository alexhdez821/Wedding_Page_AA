function normalizeName(value) {
  return value
    .trim()
    .replace(/\s+/g, " ")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function normalizePhone(value) {
  return value.replace(/\D/g, "").trim();
}

function formatPhoneInputValue(value) {
  const digits = normalizePhone(value).slice(0, 10);
  if (!digits) return "";
  if (digits.length < 3) return `(${digits}`;
  if (digits.length === 3) return `(${digits})`;
  if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

function attachPhoneInputFormatter(phoneInput) {
  if (!phoneInput) return;
  let shouldDeleteAreaCodeDigit = false;

  phoneInput.addEventListener("keydown", (event) => {
    if (event.key !== "Backspace") {
      shouldDeleteAreaCodeDigit = false;
      return;
    }

    const selectionStart = phoneInput.selectionStart ?? 0;
    const selectionEnd = phoneInput.selectionEnd ?? 0;
    const isCaretSelection = selectionStart === selectionEnd;
    const charBeforeCursor = phoneInput.value.charAt(selectionStart - 1);

    shouldDeleteAreaCodeDigit = isCaretSelection && charBeforeCursor === ")";
  });

  phoneInput.addEventListener("input", () => {
    const digits = normalizePhone(phoneInput.value);

    if (shouldDeleteAreaCodeDigit && digits.length === 3) {
      phoneInput.value = formatPhoneInputValue(digits.slice(0, 2));
      shouldDeleteAreaCodeDigit = false;
      return;
    }

    phoneInput.value = formatPhoneInputValue(phoneInput.value);
    shouldDeleteAreaCodeDigit = false;
  });
}

function normalizePhoneForComparison(value) {
  const digits = normalizePhone(value);
  if (!digits) return "";

  if (digits.length > 10) {
    if (digits.startsWith("52")) return digits.slice(2);
    if (digits.startsWith("1")) return digits.slice(1);
  }

  return digits;
}

function normalizePhoneByCountry(rawPhone, countryCode) {
  const digits = normalizePhone(rawPhone);
  const country = countryCode === "mx" ? "mx" : "us";
  const trimmedRawPhone = (rawPhone || "").trim();
  const invalidResult = {
    phoneRaw: trimmedRawPhone,
    phoneE164: "",
    phoneCountry: country,
    isValid: false
  };

  if (!digits) return invalidResult;

  let nationalDigits = "";
  if (country === "us") {
    if (digits.length === 10) nationalDigits = digits;
    else if (digits.length === 11 && digits.startsWith("1")) nationalDigits = digits.slice(1);
  } else if (country === "mx") {
    if (digits.length === 10) nationalDigits = digits;
    else if (digits.length === 12 && digits.startsWith("52")) nationalDigits = digits.slice(2);
  }

  if (nationalDigits.length !== 10) return invalidResult;

  return {
    phoneRaw: trimmedRawPhone,
    phoneE164: `+${country === "mx" ? "52" : "1"}${nationalDigits}`,
    phoneCountry: country,
    isValid: true
  };
}

function getResponseGroupKey(guest) {
  const pairId = (guest?.rsvp_pair_id || "").trim();
  if (pairId) return `pair:${pairId}`;
  return `guest:${guest.id}`;
}

function getGuestDisplayName(guest) {
  return `${guest?.first_name || ""} ${guest?.last_name || ""}`.trim();
}

function setLookupNotFound(resultContainer) {
  resultContainer.innerHTML = `
    <div class="result-card error" role="status" aria-live="polite">
      <h3>No pudimos encontrar tu invitación.</h3>
      <p>Por favor revisa la ortografía e inténtalo de nuevo.</p>
    </div>
  `;
}

function getFriendlyLookupError(error) {
  const status = error?.status ?? error?.code;

  if (status === 401 || status === 403) {
    return "La búsqueda de RSVP no está disponible temporalmente. Inténtalo más tarde.";
  }

  return "No se pudo buscar tu invitación en este momento.";
}

function isRsvpLookupPermissionIssue(error) {
  const code = String(error?.code ?? "").toUpperCase();
  const message = String(error?.message ?? "").toLowerCase();
  const details = String(error?.details ?? "").toLowerCase();
  const hint = String(error?.hint ?? "").toLowerCase();
  const status = Number(error?.status);

  return (
    status === 401 ||
    status === 403 ||
    code === "42501" ||
    message.includes("permission") ||
    details.includes("permission") ||
    hint.includes("policy")
  );
}

function getFriendlyRsvpInsertError(error) {
  const code = String(error?.code ?? "").toUpperCase();
  const message = String(error?.message ?? "").toLowerCase();
  const details = String(error?.details ?? "").toLowerCase();
  const combined = `${message} ${details}`;

  if (code === "23505" || combined.includes("duplicate key")) {
    return "Parece que tu RSVP ya había sido registrado. Recarga la página para validar tu teléfono y ver los detalles.";
  }

  if (code === "42703" || combined.includes("column") || combined.includes("does not exist")) {
    if (combined.includes("phone")) {
      return "Tu RSVP no se pudo guardar porque falta configurar la columna de teléfono en la base de datos. Por favor avísanos para corregirlo.";
    }
    if (combined.includes("additional_guest_names")) {
      return "Tu RSVP no se pudo guardar porque falta configurar invitados adicionales en la base de datos. Por favor avísanos para corregirlo.";
    }
    if (combined.includes("response_group")) {
      return "Tu RSVP no se pudo guardar porque falta configurar grupos de respuesta en la base de datos. Por favor avísanos para corregirlo.";
    }
  }

  return "No pudimos guardar tu RSVP en este momento. Inténtalo de nuevo.";
}

function isMissingColumnError(error, columnName) {
  const code = String(error?.code ?? "").toUpperCase();
  const message = String(error?.message ?? "").toLowerCase();
  const details = String(error?.details ?? "").toLowerCase();
  const hint = String(error?.hint ?? "").toLowerCase();
  const normalizedColumn = String(columnName ?? "").toLowerCase();
  const combined = `${message} ${details} ${hint}`;

  if (!normalizedColumn) return false;

  const hasMissingColumnSignal =
    code === "42703" ||
    code === "PGRST204" ||
    combined.includes("does not exist") ||
    combined.includes("could not find the") ||
    combined.includes("missing") ||
    combined.includes("column");

  return hasMissingColumnSignal && combined.includes(normalizedColumn);
}

async function insertRsvpWithSchemaFallback(supabase, payload) {
  const { error } = await supabase.from("rsvp_responses").insert([payload]);
  if (!error) return { error: null };

  for (const fallbackColumn of ["named_guest_responses", "additional_guest_names"]) {
    if (isMissingColumnError(error, fallbackColumn)) {
      const fallbackPayload = { ...payload };
      delete fallbackPayload[fallbackColumn];
      const fallbackResult = await supabase.from("rsvp_responses").insert([fallbackPayload]);
      if (!fallbackResult.error) {
        console.warn(
          `Inserted RSVP without ${fallbackColumn} because the column is missing in the database schema.`
        );
      }
      return fallbackResult;
    }
  }

  return { error };
}

function clearLookupFields(lookupForm) {
  lookupForm.reset();
  lookupForm.hidden = true;
}

function focusLookupSuccessMessage(resultContainer) {
  if (!resultContainer) return;

  const successCard = resultContainer.querySelector(".result-card.success");
  const target = successCard || resultContainer;

  target.scrollIntoView({ behavior: "smooth", block: "start" });
}

function focusLookupNotFoundMessage(resultContainer) {
  if (!resultContainer) return;

  const notFoundCard = resultContainer.querySelector(".result-card.error");
  const target = notFoundCard || resultContainer;

  target.scrollIntoView({ behavior: "smooth", block: "start" });
}

function isPhoneViewport() {
  return window.matchMedia("(max-width: 768px)").matches;
}

function focusRevealedQuestion(container, preferredInput) {
  if (!container || container.hidden || !isPhoneViewport()) return;

  container.scrollIntoView({ behavior: "smooth", block: "start" });

  const targetInput = preferredInput || container.querySelector("input, select, textarea, button");
  if (!targetInput) return;

  requestAnimationFrame(() => {
    targetInput.focus({ preventScroll: true });
  });
}

function hideDeadlineNote() {
  const deadlineNote = document.getElementById("rsvpDeadlineNote");
  if (deadlineNote) deadlineNote.hidden = true;
}

function getDetailsButtonsMarkup() {
  return `
    <div class="details-actions">
      <a class="btn details-action-btn" href="detalles-es.html">Ver detalles</a>
      <a class="btn details-action-btn" href="detalles-en.html">See details</a>
    </div>
  `;
}

function renderVerifiedDetailsCard(resultContainer) {
  resultContainer.innerHTML += `
    <div class="result-card success" role="status" aria-live="polite">
      <h3>✅ Teléfono verificado</h3>
      <p>Elige tu idioma para abrir los detalles de la boda.<br>Choose your language to open the wedding details.</p>
      ${getDetailsButtonsMarkup()}
    </div>
  `;
}

function renderAlreadySubmittedMessage(resultContainer, guest, responseRecord, supabase) {
  const savedPhone = responseRecord?.phone_e164 || responseRecord?.phone || "";
  const hasPhoneOnRecord = Boolean(savedPhone);
  resultContainer.innerHTML = `
    <div class="result-card warning" role="status" aria-live="polite">
      <p>Tu RSVP ya fue recibido. Si deseas ver los detalles, ingresa tu teléfono.</p>
    </div>

    <form id="phoneVerificationForm" class="rsvp-form" novalidate>
      <div>
        <label for="verificationPhone">Número de teléfono</label>
        <div class="phone-inline-row">
          <select id="verificationPhoneCountry" name="verificationPhoneCountry" aria-label="Código de país">
            <option value="us">🇺🇸 +1</option>
            <option value="mx">🇲🇽 +52</option>
          </select>
          <input id="verificationPhone" name="verificationPhone" type="tel" autocomplete="tel" inputmode="tel" required placeholder="(555) 123-4567" />
        </div>
      </div>
      <button class="btn btn-primary" type="submit">Validar teléfono y mostrar detalles</button>
      <p id="verificationError" class="form-error" aria-live="polite"></p>
    </form>
  `;

  const verificationForm = document.getElementById("phoneVerificationForm");
  const verificationError = document.getElementById("verificationError");
  const verificationPhoneInput = document.getElementById("verificationPhone");

  if (!verificationForm || !verificationError) return;
  attachPhoneInputFormatter(verificationPhoneInput);

  verificationForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    verificationError.textContent = "";

    const phoneInput = document.getElementById("verificationPhone");
    const phoneCountryInput = document.getElementById("verificationPhoneCountry");
    const rawPhone = phoneInput?.value ?? "";
    const { phoneRaw, phoneE164, phoneCountry, isValid } = normalizePhoneByCountry(rawPhone, phoneCountryInput?.value);

    if (!isValid) {
      verificationError.textContent = "Por favor ingresa un número de teléfono válido.";
      return;
    }

    // If the RSVP was created before we started collecting phone numbers, let the guest register it once.
    if (!hasPhoneOnRecord) {
      const { error: updateError } = await supabase
        .from("rsvp_responses")
        .update({
          phone: phoneE164,
          phone_raw: phoneRaw,
          phone_e164: phoneE164,
          phone_country: phoneCountry,
          phone_verified: true,
          updated_at: new Date().toISOString()
        })
        .eq("id", responseRecord.id);

      if (updateError) {
        console.error("Phone registration for existing RSVP failed", updateError);
        verificationError.textContent = "No se pudo registrar tu teléfono en este momento. Inténtalo de nuevo.";
        return;
      }

      renderVerifiedDetailsCard(resultContainer);
      verificationForm.remove();
      return;
    }

    if (normalizePhoneForComparison(savedPhone) !== normalizePhoneForComparison(phoneE164)) {
      verificationError.textContent = "Ese teléfono no coincide con el que usamos en tu RSVP.";
      return;
    }

    const { error: verificationUpdateError } = await supabase
      .from("rsvp_responses")
      .update({
        phone_verified: true,
        updated_at: new Date().toISOString()
      })
      .eq("id", responseRecord.id);
    if (verificationUpdateError) {
      console.warn("Phone verification flag update failed", verificationUpdateError);
    }

    renderVerifiedDetailsCard(resultContainer);
    verificationForm.remove();
  });
}

export function initRsvpFlow() {
  const supabase = window.supabaseClient;

  const lookupForm = document.getElementById("lookupForm");
  const resultContainer = document.getElementById("rsvpResult");
  const lookupError = document.getElementById("lookupError");

  if (!lookupForm || !resultContainer || !lookupError) return;

  if (!supabase) {
    lookupError.textContent = "El servicio de RSVP no está disponible en este momento. Inténtalo más tarde.";
    return;
  }

  lookupForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    lookupError.textContent = "";
    resultContainer.innerHTML = "";

    const firstNameInput = document.getElementById("lookupFirstName");
    const lastNameInput = document.getElementById("lookupLastName");

    const firstName = firstNameInput?.value?.trim() ?? "";
    const lastName = lastNameInput?.value?.trim() ?? "";

    if (!firstName || !lastName) {
      lookupError.textContent = "Por favor ingresa nombre y apellido.";
      return;
    }

    const normalizedFirstName = normalizeName(firstName);
    const normalizedLastName = normalizeName(lastName);

    try {
      const { data: possibleGuests, error: guestError } = await supabase
        .from("guest_list")
        .select("id, first_name, last_name, allowed_plus_one, max_guests, rsvp_pair_id")
        .eq("invited", true)
        .limit(1000);

      if (guestError) {
        console.error("Guest lookup failed", guestError);
        lookupError.textContent = getFriendlyLookupError(guestError);
        return;
      }

      const guest = (possibleGuests || []).find(
        (entry) =>
          normalizeName(entry.first_name || "") === normalizedFirstName &&
          normalizeName(entry.last_name || "") === normalizedLastName
      );

      if (!guest) {
        setLookupNotFound(resultContainer);
        focusLookupNotFoundMessage(resultContainer);
        return;
      }

      let invitedParty = [guest];
      const pairId = (guest.rsvp_pair_id || "").trim();
      if (pairId) {
        const { data: pairedGuests, error: pairedGuestsError } = await supabase
          .from("guest_list")
          .select("id, first_name, last_name, allowed_plus_one, max_guests, rsvp_pair_id")
          .eq("invited", true)
          .eq("rsvp_pair_id", pairId)
          .order("first_name", { ascending: true });

        if (pairedGuestsError) {
          console.error("Paired guest lookup failed", pairedGuestsError);
          lookupError.textContent = getFriendlyLookupError(pairedGuestsError);
          return;
        }

        invitedParty = (pairedGuests || []).length ? pairedGuests : [guest];
      }

      const groupedGuests = invitedParty.filter((entry) => (entry?.rsvp_pair_id || "").trim() === pairId);
      const invitedGuests = pairId ? groupedGuests : [guest];
      const isGroupInvite = invitedGuests.length > 1;
      const declaredMaxGuests = invitedGuests.reduce((max, entry) => {
        const parsed = Number(entry?.max_guests);
        return Number.isFinite(parsed) && parsed > max ? parsed : max;
      }, 0);
      const maxGuests = Math.max(declaredMaxGuests, invitedGuests.length);
      const additionalGuestSlots = Math.max(0, maxGuests - invitedGuests.length);
      const isSingleGuestWithOnePlusOne = invitedGuests.length === 1 && additionalGuestSlots === 1;
      const shouldAskNeedPlusOneFirst = isSingleGuestWithOnePlusOne;
      const shouldAutoAskAdditionalGuestNames = additionalGuestSlots > 0 && !shouldAskNeedPlusOneFirst;
      const responseGroup = getResponseGroupKey(guest);

      const { data: existingResponse, error: responseError } = await supabase
        .from("rsvp_responses")
        .select("id, guest_id, phone, phone_e164, phone_raw, phone_country, sms_opt_in, phone_verified")
        .eq("response_group", responseGroup)
        .maybeSingle();

      if (responseError) {
        console.error("Existing RSVP lookup failed", responseError);
        if (isRsvpLookupPermissionIssue(responseError)) {
          console.warn(
            "RSVP duplicate check could not read rsvp_responses. Verify an RLS SELECT policy exists for this query.",
            responseError
          );
        }
        lookupError.textContent = "No se pudo verificar el estado de tu RSVP en este momento.";
        return;
      }

      if (existingResponse) {
        hideDeadlineNote();
        clearLookupFields(lookupForm);
        renderAlreadySubmittedMessage(resultContainer, guest, existingResponse, supabase);
        return;
      }

      const groupInviteHeading = isGroupInvite
        ? `Encontramos la invitación para ${invitedGuests.map(getGuestDisplayName).join(", ")} ✨`
        : "Encontramos tu invitación ✨";
      const groupAttendanceFields = isGroupInvite
        ? invitedGuests
            .map(
              (entry, index) => `
                <div class="person-row">
                  <div class="person-label">¿Asistirá ${getGuestDisplayName(entry)}?</div>
                  <div class="person-options" role="radiogroup" aria-label="Asistencia de ${getGuestDisplayName(entry)}">
                    <label><input type="radio" name="pairAttending${index}" value="true" required> Sí</label>
                    <label><input type="radio" name="pairAttending${index}" value="false" required> No</label>
                  </div>
                </div>
              `
            )
            .join("")
        : `
            <div class="person-row">
              <div class="person-label">¿Asistirás?</div>
              <div class="person-options" role="radiogroup" aria-label="Asistencia">
                <label><input type="radio" name="attending" value="true" required> Asistiré</label>
                <label><input type="radio" name="attending" value="false" required> No asistiré</label>
              </div>
            </div>
          `;

      resultContainer.innerHTML = `
        <div class="result-card success">
          <h3>${groupInviteHeading}</h3>
          <p>${isGroupInvite ? invitedGuests.map(getGuestDisplayName).join(" & ") : getGuestDisplayName(guest)}</p>
        </div>

        <form id="responseForm" class="rsvp-form" novalidate>
          ${groupAttendanceFields}

          <div id="plusOneDecisionWrap" ${shouldAskNeedPlusOneFirst ? "hidden" : "hidden"}>
            <div class="person-row">
              <div class="person-label">¿Necesitas tu +1?</div>
              <div class="person-options" role="radiogroup" aria-label="Confirmar plus one">
                <label><input type="radio" name="needsPlusOne" value="true"> Sí</label>
                <label><input type="radio" name="needsPlusOne" value="false"> No</label>
              </div>
            </div>
          </div>

          <div id="additionalGuestsWrap" ${additionalGuestSlots > 0 ? "hidden" : "hidden"}>
            <p class="person-label">¿Traerás invitados adicionales?</p>
            <p>Si usarás espacios adicionales, escribe sus nombres aquí. Si no, déjalos en blanco.</p>
            ${Array.from({ length: additionalGuestSlots })
              .map(
                (_, index) => `
                  <div>
                    <label for="additionalGuest${index}">Invitado ${index + 1}</label>
                    <input id="additionalGuest${index}" name="additionalGuest${index}" type="text" placeholder="Nombre completo" />
                  </div>
                `
              )
              .join("")}
          </div>

          <div id="rsvpPhoneWrap" hidden>
            <label for="rsvpPhone">Teléfono para validar tu RSVP más adelante</label>
            <div class="phone-inline-row">
              <select id="rsvpPhoneCountry" name="rsvpPhoneCountry" aria-label="Código de país">
                <option value="us">🇺🇸 +1</option>
                <option value="mx">🇲🇽 +52</option>
              </select>
              <input id="rsvpPhone" name="rsvpPhone" type="tel" autocomplete="tel" inputmode="tel" placeholder="(555) 123-4567" />
            </div>
            <div class="sms-consent-row">
              <input id="smsOptIn" name="smsOptIn" type="checkbox" checked />
              <label for="smsOptIn">Acepto recibir mensajes relacionados con la boda, como recordatorios, cambios importantes y detalles del evento.</label>
            </div>
          </div>

          <button class="btn btn-primary" type="submit">Enviar RSVP</button>
          <p id="submitError" class="form-error" aria-live="polite"></p>
        </form>
      `;

      focusLookupSuccessMessage(resultContainer);

      const responseForm = document.getElementById("responseForm");
      const submitError = document.getElementById("submitError");
      const plusOneDecisionWrap = document.getElementById("plusOneDecisionWrap");
      const additionalGuestsWrap = document.getElementById("additionalGuestsWrap");
      const additionalGuestInputs = Array.from(responseForm?.querySelectorAll('input[name^="additionalGuest"]') || []);
      const needsPlusOneInputs = responseForm?.querySelectorAll('input[name="needsPlusOne"]');
      const submitButton = responseForm?.querySelector('button[type="submit"]');
      const rsvpPhoneWrap = document.getElementById("rsvpPhoneWrap");
      const rsvpPhoneInput = document.getElementById("rsvpPhone");
      const rsvpPhoneCountryInput = document.getElementById("rsvpPhoneCountry");
      const attendanceInputs = responseForm?.querySelectorAll('input[name="attending"]');
      const groupAttendanceInputSets = invitedGuests.map((_, index) =>
        responseForm?.querySelectorAll(`input[name="pairAttending${index}"]`)
      );

      if (!responseForm || !submitError || !rsvpPhoneInput || !submitButton) {
        lookupError.textContent = "El formulario de RSVP no está disponible temporalmente. Recarga la página e inténtalo de nuevo.";
        return;
      }
      attachPhoneInputFormatter(rsvpPhoneInput);

      const updateConditionalFields = () => {
        const wasPhoneHidden = rsvpPhoneWrap?.hidden;
        const wasAdditionalGuestsHidden = additionalGuestsWrap?.hidden;
        const wasPlusOneDecisionHidden = plusOneDecisionWrap?.hidden;
        const activeElement = document.activeElement;
        const isTypingAdditionalGuestName = additionalGuestInputs.some((input) => input === activeElement);

        let isAttending = false;
        let shouldShowPhone = false;
        let shouldShowSubmit = false;

        if (isGroupInvite) {
          const allGroupAttendanceAnswered = invitedGuests.every(
            (_, index) => responseForm.querySelector(`input[name="pairAttending${index}"]:checked`)
          );
          const attendingCount = invitedGuests.filter(
            (_, index) => responseForm.querySelector(`input[name="pairAttending${index}"]:checked`)?.value === "true"
          ).length;
          const shouldShowGroupAdditionalGuests =
            allGroupAttendanceAnswered && attendingCount > 0 && additionalGuestSlots > 0;

          isAttending = attendingCount > 0;
          if (additionalGuestsWrap) {
            additionalGuestsWrap.hidden = !shouldShowGroupAdditionalGuests;
          }
          additionalGuestInputs.forEach((input) => {
            input.required = false;
            if (!shouldShowGroupAdditionalGuests) input.value = "";
          });

          shouldShowPhone = allGroupAttendanceAnswered && isAttending;
          shouldShowSubmit = allGroupAttendanceAnswered && (!isAttending || shouldShowPhone);

          if (plusOneDecisionWrap) plusOneDecisionWrap.hidden = true;
        } else {
          const attendanceSelection = responseForm.querySelector('input[name="attending"]:checked');
          const attendanceAnswered = Boolean(attendanceSelection);
          isAttending = attendanceSelection?.value === "true";

          const needsPlusOneSelected = responseForm.querySelector('input[name="needsPlusOne"]:checked')?.value;
          const needsPlusOneAnswered = needsPlusOneSelected === "true" || needsPlusOneSelected === "false";
          const shouldShowPlusOneDecision = attendanceAnswered && isAttending && shouldAskNeedPlusOneFirst;

          if (plusOneDecisionWrap) {
            plusOneDecisionWrap.hidden = !shouldShowPlusOneDecision;
          }

          if (!shouldShowPlusOneDecision) {
            needsPlusOneInputs?.forEach((input) => {
              input.checked = false;
            });
          }

          const shouldShowAdditionalGuests =
            attendanceAnswered &&
            isAttending &&
            additionalGuestSlots > 0 &&
            (shouldAutoAskAdditionalGuestNames || (shouldShowPlusOneDecision && needsPlusOneSelected === "true"));

          if (additionalGuestsWrap) {
            additionalGuestsWrap.hidden = !shouldShowAdditionalGuests;
          }

          additionalGuestInputs.forEach((input) => {
            input.required = false;
            if (!shouldShowAdditionalGuests) input.value = "";
          });

          const additionalGuestNamesComplete =
            !shouldShowAdditionalGuests ||
            additionalGuestInputs.every((input) => (input.value || "").trim().length > 0);

          shouldShowPhone =
            attendanceAnswered &&
            isAttending &&
            (!shouldAskNeedPlusOneFirst || (needsPlusOneAnswered && additionalGuestNamesComplete));

          shouldShowSubmit = attendanceAnswered && (!isAttending || shouldShowPhone);
        }

        if (rsvpPhoneWrap && rsvpPhoneInput) {
          rsvpPhoneWrap.hidden = !shouldShowPhone;
          rsvpPhoneInput.required = shouldShowPhone;

          if (!shouldShowPhone) {
            rsvpPhoneInput.value = "";
          }
        }

        submitButton.hidden = !shouldShowSubmit;

        if (wasPlusOneDecisionHidden && plusOneDecisionWrap && !plusOneDecisionWrap.hidden) {
          focusRevealedQuestion(plusOneDecisionWrap, needsPlusOneInputs?.[0]);
        }

        const didRevealAdditionalGuests =
          wasAdditionalGuestsHidden && additionalGuestsWrap && !additionalGuestsWrap.hidden;

        if (didRevealAdditionalGuests) {
          focusRevealedQuestion(additionalGuestsWrap, additionalGuestInputs[0]);
        }

        if (
          !didRevealAdditionalGuests &&
          wasPhoneHidden &&
          rsvpPhoneWrap &&
          !rsvpPhoneWrap.hidden &&
          !isTypingAdditionalGuestName
        ) {
          focusRevealedQuestion(rsvpPhoneWrap, rsvpPhoneInput);
        }
      };

      attendanceInputs?.forEach((input) => input.addEventListener("change", updateConditionalFields));
      groupAttendanceInputSets.forEach((inputs) =>
        inputs?.forEach((input) => input.addEventListener("change", updateConditionalFields))
      );
      needsPlusOneInputs?.forEach((input) => input.addEventListener("change", updateConditionalFields));
      additionalGuestInputs.forEach((input) => {
        input.addEventListener("input", updateConditionalFields);
      });
      submitButton.hidden = true;
      updateConditionalFields();

      responseForm.addEventListener("submit", async (submitEvent) => {
        submitEvent.preventDefault();
        submitError.textContent = "";

        const submitButton = responseForm.querySelector('button[type="submit"]');

        const attendingValue = responseForm.querySelector('input[name="attending"]:checked')?.value;
        let guestCount = attendingValue === "true" ? 1 : 0;
        let normalizedAttending = guestCount > 0;
        const { phoneRaw, phoneE164, phoneCountry, isValid: isPhoneValid } = normalizePhoneByCountry(
          rsvpPhoneInput.value || "",
          rsvpPhoneCountryInput?.value
        );
        const smsOptInInput = document.getElementById("smsOptIn");
        const smsOptIn = Boolean(smsOptInInput?.checked);

        if (isGroupInvite) {
          const groupSelections = invitedGuests.map((_, index) =>
            responseForm.querySelector(`input[name="pairAttending${index}"]:checked`)?.value
          );
          if (groupSelections.some((entry) => entry === undefined)) {
            submitError.textContent = "Por favor indícanos la asistencia de cada persona.";
            return;
          }

          guestCount = groupSelections.filter((entry) => entry === "true").length;
          normalizedAttending = guestCount > 0;
        } else {
          if (attendingValue === undefined) {
            submitError.textContent = "Por favor selecciona si asistirás.";
            return;
          }
        }

        const namedGuestResponses = invitedGuests.map((invitedGuest, index) => ({
          guest_id: invitedGuest.id,
          name: getGuestDisplayName(invitedGuest),
          attending: isGroupInvite
            ? responseForm.querySelector(`input[name="pairAttending${index}"]:checked`)?.value === "true"
            : normalizedAttending
        }));

        const additionalGuestNames = additionalGuestInputs
          .map((input) => input.value.trim())
          .filter(Boolean);

        const needsPlusOneValue = responseForm.querySelector('input[name="needsPlusOne"]:checked')?.value;
        if (shouldAskNeedPlusOneFirst && normalizedAttending && needsPlusOneValue === undefined) {
          submitError.textContent = "Por favor indícanos si utilizarás tu +1.";
          return;
        }

        if (shouldAskNeedPlusOneFirst && normalizedAttending && needsPlusOneValue === "true" && additionalGuestNames.length !== 1) {
          submitError.textContent = "Por favor comparte el nombre de tu invitado +1.";
          return;
        }

        if (shouldAskNeedPlusOneFirst && normalizedAttending && needsPlusOneValue === "false" && additionalGuestNames.length > 0) {
          submitError.textContent = "Solo agrega un invitado si seleccionaste que sí usarás tu +1.";
          return;
        }

        if (additionalGuestNames.length > additionalGuestSlots) {
          submitError.textContent = "Solo puedes agregar el número de invitados permitidos en tu invitación.";
          return;
        }

        guestCount += additionalGuestNames.length;

        if (!isPhoneValid && normalizedAttending) {
          submitError.textContent = "Por favor ingresa un número de teléfono válido.";
          return;
        }

        const { data: duplicateResponse, error: duplicateLookupError } = await supabase
          .from("rsvp_responses")
          .select("id, guest_id, phone, phone_e164, phone_raw, phone_country, sms_opt_in, phone_verified")
          .eq("response_group", responseGroup)
          .maybeSingle();

        if (duplicateLookupError) {
          console.error("Duplicate RSVP lookup failed", duplicateLookupError);
          if (isRsvpLookupPermissionIssue(duplicateLookupError)) {
            console.warn(
              "RSVP duplicate check could not read rsvp_responses. Verify an RLS SELECT policy exists for this query.",
              duplicateLookupError
            );
          }
          submitError.textContent = "No se pudo verificar el estado de tu RSVP en este momento. Inténtalo de nuevo.";
          return;
        }

        if (duplicateResponse) {
          hideDeadlineNote();
          clearLookupFields(lookupForm);
          renderAlreadySubmittedMessage(resultContainer, guest, duplicateResponse, supabase);
          return;
        }

        if (submitButton) submitButton.disabled = true;

        const isSinglePlusOneResponse = shouldAskNeedPlusOneFirst && additionalGuestNames.length === 1;
        const insertPayload = {
          guest_id: guest.id,
          response_group: responseGroup,
          attending: normalizedAttending,
          named_guest_responses: namedGuestResponses,
          guest_count: guestCount,
          plus_one_name: isSinglePlusOneResponse ? additionalGuestNames[0] : null,
          phone: normalizedAttending ? phoneE164 : null,
          phone_raw: normalizedAttending ? phoneRaw : null,
          phone_e164: normalizedAttending ? phoneE164 : null,
          phone_country: normalizedAttending ? phoneCountry : null,
          sms_opt_in: normalizedAttending ? smsOptIn : false,
          phone_verified: false,
          submitted_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        };
        if (additionalGuestNames.length > 0 && !isSinglePlusOneResponse) {
          insertPayload.additional_guest_names = additionalGuestNames;
        }
        const { error: insertError } = await insertRsvpWithSchemaFallback(supabase, insertPayload);

        if (insertError) {
          console.error("RSVP insert failed", insertError);
          submitError.textContent = getFriendlyRsvpInsertError(insertError);
          if (submitButton) submitButton.disabled = false;
          return;
        }

        const responseHeading = normalizedAttending
          ? "¡Gracias! Tu RSVP ha sido guardado."
          : "Gracias por avisarnos 💛";
        const responseCopy = normalizedAttending
          ? "Recibimos tu respuesta y usamos tu teléfono para validar el acceso a los detalles."
          : "Te vamos a extrañar en nuestro gran día, pero agradecemos mucho tu cariño y buenos deseos.";
        const confirmedGuestLabel = guestCount === 1 ? "persona" : "personas";
        const confirmedGuestMessage = normalizedAttending
          ? `Se confirmaron <strong>${guestCount} ${confirmedGuestLabel}</strong>.`
          : `Quedó registrado tu RSVP con <strong>${guestCount} ${confirmedGuestLabel}</strong> asistiendo.`;

        const detailsButtons = normalizedAttending
          ? `
            <div class="result-card success" role="status" aria-live="polite">
              <h3>Detalles de la boda</h3>
              <p>Elige tu idioma para abrir los detalles de la boda.<br>Choose your language to open the wedding details.</p>
              ${getDetailsButtonsMarkup()}
            </div>
          `
          : "";

        resultContainer.innerHTML = `
          <div class="result-card success" role="status" aria-live="polite">
            <h3>${responseHeading}</h3>
            <p>${responseCopy}</p>
            <p class="invite-confirmation">${confirmedGuestMessage}</p>
          </div>
          ${detailsButtons}
        `;
        hideDeadlineNote();
        clearLookupFields(lookupForm);
      });
    } catch {
      lookupError.textContent = "No pudimos conectarnos al servicio de RSVP en este momento. Inténtalo de nuevo en un momento.";
    }
  });
}

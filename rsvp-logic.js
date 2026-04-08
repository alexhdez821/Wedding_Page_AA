const WEDDING_DETAILS_IMAGE_URL_ES = "https://images.unsplash.com/photo-1522673607200-164d1b6ce486?auto=format&fit=crop&w=1400&q=80";
const WEDDING_DETAILS_IMAGE_URL_EN = "https://images.unsplash.com/photo-1519225421980-715cb0215aed?auto=format&fit=crop&w=1400&q=80";

function normalizeName(value) {
  return value
    .trim()
    .replace(/\s+/g, " ")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function normalizeEmail(value) {
  return value.trim().toLowerCase();
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
    return "Parece que tu RSVP ya había sido registrado. Recarga la página para validar tu correo y ver los detalles.";
  }

  if (code === "42703" || combined.includes("column") || combined.includes("does not exist")) {
    if (combined.includes("email")) {
      return "Tu RSVP no se pudo guardar porque falta configurar la columna de correo en la base de datos. Por favor avísanos para corregirlo.";
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
  const normalizedColumn = String(columnName ?? "").toLowerCase();

  if (!normalizedColumn) return false;

  return (
    code === "42703" &&
    (message.includes(normalizedColumn) ||
      details.includes(normalizedColumn) ||
      message.includes("column") ||
      details.includes("column"))
  );
}

async function insertRsvpWithSchemaFallback(supabase, payload) {
  const { error } = await supabase.from("rsvp_responses").insert([payload]);
  if (!error) return { error: null };

  if (isMissingColumnError(error, "additional_guest_names")) {
    const fallbackPayload = { ...payload };
    delete fallbackPayload.additional_guest_names;
    const fallbackResult = await supabase.from("rsvp_responses").insert([fallbackPayload]);
    if (!fallbackResult.error) {
      console.warn(
        "Inserted RSVP without additional_guest_names because the column is missing in the database schema."
      );
    }
    return fallbackResult;
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
      <a class="btn btn-primary" href="${WEDDING_DETAILS_IMAGE_URL_ES}" target="_blank" rel="noopener noreferrer" download="detalles-boda-es.jpg">Ver detalles</a>
      <a class="btn btn-secondary" href="${WEDDING_DETAILS_IMAGE_URL_EN}" target="_blank" rel="noopener noreferrer" download="wedding-details-en.jpg">See details</a>
    </div>
    <p class="details-help">Se abrirá la imagen para que puedas guardarla en tu librería de fotos (you can save it to your photo library).</p>
  `;
}

function renderVerifiedDetailsCard(resultContainer) {
  resultContainer.innerHTML += `
    <div class="result-card success" role="status" aria-live="polite">
      <h3>✅ Correo verificado</h3>
      <p>Ya puedes abrir los detalles en español o en inglés.</p>
      ${getDetailsButtonsMarkup()}
    </div>
  `;
}

function renderAlreadySubmittedMessage(resultContainer, guest, responseRecord, supabase) {
  const hasEmailOnRecord = Boolean(responseRecord?.email);
  resultContainer.innerHTML = `
    <div class="result-card warning" role="status" aria-live="polite">
      <p>Tu RSVP ya fue recibido. Si deseas ver los detalles, ingresa tu correo.</p>
    </div>

    <form id="emailVerificationForm" class="rsvp-form" novalidate>
      <div>
        <label for="verificationEmail">Correo electrónico</label>
        <input id="verificationEmail" name="verificationEmail" type="email" autocomplete="email" required placeholder="tu-correo@ejemplo.com" />
      </div>
      <button class="btn btn-primary" type="submit">Validar correo y mostrar detalles</button>
      <p id="verificationError" class="form-error" aria-live="polite"></p>
    </form>
  `;

  const verificationForm = document.getElementById("emailVerificationForm");
  const verificationError = document.getElementById("verificationError");

  if (!verificationForm || !verificationError) return;

  verificationForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    verificationError.textContent = "";

    const emailInput = document.getElementById("verificationEmail");
    const rawEmail = emailInput?.value ?? "";
    const email = normalizeEmail(rawEmail);

    if (!email || !email.includes("@")) {
      verificationError.textContent = "Por favor ingresa un correo válido.";
      return;
    }

    // If the RSVP was created before we started collecting emails, let the guest register it once.
    if (!hasEmailOnRecord) {
      const { error: updateError } = await supabase
        .from("rsvp_responses")
        .update({ email })
        .eq("id", responseRecord.id);

      if (updateError) {
        console.error("Email registration for existing RSVP failed", updateError);
        verificationError.textContent = "No se pudo registrar tu correo en este momento. Inténtalo de nuevo.";
        return;
      }

      renderVerifiedDetailsCard(resultContainer);
      verificationForm.remove();
      return;
    }

    if (normalizeEmail(responseRecord.email) !== email) {
      verificationError.textContent = "Ese correo no coincide con el que usamos en tu RSVP.";
      return;
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
        .ilike("first_name", firstName)
        .ilike("last_name", lastName)
        .limit(10);

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
      const responseGroup = getResponseGroupKey(guest);

      const { data: existingResponse, error: responseError } = await supabase
        .from("rsvp_responses")
        .select("id, guest_id, email")
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

          <div id="additionalGuestsWrap" ${additionalGuestSlots > 0 ? "hidden" : "hidden"}>
            <p class="person-label">Nombres de invitados adicionales</p>
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

          <div id="rsvpEmailWrap" hidden>
            <label for="rsvpEmail">Correo para validar tu RSVP más adelante</label>
            <input id="rsvpEmail" name="rsvpEmail" type="email" autocomplete="email" placeholder="tu-correo@ejemplo.com" />
          </div>

          <button class="btn btn-primary" type="submit">Enviar RSVP</button>
          <p id="submitError" class="form-error" aria-live="polite"></p>
        </form>
      `;

      focusLookupSuccessMessage(resultContainer);

      const responseForm = document.getElementById("responseForm");
      const submitError = document.getElementById("submitError");
      const additionalGuestsWrap = document.getElementById("additionalGuestsWrap");
      const additionalGuestInputs = Array.from(responseForm?.querySelectorAll('input[name^="additionalGuest"]') || []);
      const rsvpEmailWrap = document.getElementById("rsvpEmailWrap");
      const rsvpEmailInput = document.getElementById("rsvpEmail");
      const attendanceInputs = responseForm?.querySelectorAll('input[name="attending"]');
      const groupAttendanceInputSets = invitedGuests.map((_, index) =>
        responseForm?.querySelectorAll(`input[name="pairAttending${index}"]`)
      );

      if (!responseForm || !submitError || !rsvpEmailInput) {
        lookupError.textContent = "El formulario de RSVP no está disponible temporalmente. Recarga la página e inténtalo de nuevo.";
        return;
      }

      const updateConditionalFields = () => {
        const attendingCount = isGroupInvite
          ? invitedGuests.filter(
              (_, index) => responseForm.querySelector(`input[name="pairAttending${index}"]:checked`)?.value === "true"
            ).length
          : responseForm.querySelector('input[name="attending"]:checked')?.value === "true"
            ? 1
            : 0;
        const isAttending = attendingCount > 0;
        const wasEmailHidden = rsvpEmailWrap?.hidden;
        const wasAdditionalGuestsHidden = additionalGuestsWrap?.hidden;

        if (rsvpEmailWrap && rsvpEmailInput) {
          rsvpEmailWrap.hidden = !isAttending;
          rsvpEmailInput.required = isAttending;

          if (!isAttending) {
            rsvpEmailInput.value = "";
          }

          if (wasEmailHidden && !rsvpEmailWrap.hidden) {
            focusRevealedQuestion(rsvpEmailWrap, rsvpEmailInput);
          }
        }

        if (additionalGuestsWrap) {
          const showAdditionalGuests = isAttending && additionalGuestSlots > 0;
          additionalGuestsWrap.hidden = !showAdditionalGuests;
          additionalGuestInputs.forEach((input) => {
            input.required = false;
            if (!showAdditionalGuests) input.value = "";
          });

          if (wasAdditionalGuestsHidden && !additionalGuestsWrap.hidden) {
            focusRevealedQuestion(additionalGuestsWrap, additionalGuestInputs[0]);
          }
        }
      };

      attendanceInputs?.forEach((input) => input.addEventListener("change", updateConditionalFields));
      groupAttendanceInputSets.forEach((inputs) =>
        inputs?.forEach((input) => input.addEventListener("change", updateConditionalFields))
      );
      updateConditionalFields();

      responseForm.addEventListener("submit", async (submitEvent) => {
        submitEvent.preventDefault();
        submitError.textContent = "";

        const submitButton = responseForm.querySelector('button[type="submit"]');

        const attendingValue = responseForm.querySelector('input[name="attending"]:checked')?.value;
        let guestCount = attendingValue === "true" ? 1 : 0;
        let normalizedAttending = guestCount > 0;
        const rsvpEmail = normalizeEmail(rsvpEmailInput.value || "");

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

        const additionalGuestNames = additionalGuestInputs
          .map((input) => input.value.trim())
          .filter(Boolean);
        if (additionalGuestNames.length > additionalGuestSlots) {
          submitError.textContent = "Solo puedes agregar el número de invitados permitidos en tu invitación.";
          return;
        }

        guestCount += additionalGuestNames.length;

        if ((!rsvpEmail || !rsvpEmail.includes("@")) && normalizedAttending) {
          submitError.textContent = "Por favor ingresa un correo válido.";
          return;
        }

        const { data: duplicateResponse, error: duplicateLookupError } = await supabase
          .from("rsvp_responses")
          .select("id, guest_id, email")
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

        const insertPayload = {
          guest_id: guest.id,
          response_group: responseGroup,
          attending: normalizedAttending,
          guest_count: guestCount,
          plus_one_name: additionalGuestNames.length === 1 ? additionalGuestNames[0] : null,
          email: normalizedAttending ? rsvpEmail : null,
          submitted_at: new Date().toISOString()
        };
        if (additionalGuestNames.length > 0) {
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
          ? "Recibimos tu respuesta y usamos tu correo para validar el acceso a los detalles."
          : "Te vamos a extrañar en nuestro gran día, pero agradecemos mucho tu cariño y buenos deseos.";

        const detailsButtons = normalizedAttending
          ? `
            <div class="result-card success" role="status" aria-live="polite">
              <h3>Detalles de la boda</h3>
              <p>Elige tu idioma para abrir la imagen y guardarla en tu librería de fotos.</p>
              ${getDetailsButtonsMarkup()}
            </div>
          `
          : "";

        resultContainer.innerHTML = `
          <div class="result-card success" role="status" aria-live="polite">
            <h3>${responseHeading}</h3>
            <p>${responseCopy}</p>
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

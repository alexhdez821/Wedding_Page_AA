function normalizeName(value) {
  return value
    .trim()
    .replace(/\s+/g, " ")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
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

function renderAlreadySubmittedMessage(resultContainer) {
  resultContainer.innerHTML = `
    <div class="result-card warning" role="status" aria-live="polite">
      <p>Tu RSVP ya fue recibido. Si necesitas hacer cambios, por favor contáctanos.</p>
    </div>
  `;
}

function clearLookupFields(lookupForm) {
  lookupForm.reset();
  lookupForm.hidden = true;
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
        .select("id, first_name, last_name, allowed_plus_one, max_guests")
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
        return;
      }

      // NOTE: Duplicate RSVP detection relies on SELECT access to rsvp_responses under RLS.
      const { data: existingResponse, error: responseError } = await supabase
        .from("rsvp_responses")
        .select("id")
        .eq("guest_id", guest.id)
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
        clearLookupFields(lookupForm);
        renderAlreadySubmittedMessage(resultContainer);
        return;
      }

      const plusOneField = guest.allowed_plus_one
        ? `
          <div id="plusOneQuestionWrap" class="plus-one-block" hidden>
            <div>
              <div class="person-label">¿Desea incluir un acompañante?</div>
              <div class="person-options" role="radiogroup" aria-label="Necesita acompañante">
                <label><input type="radio" name="needsPlusOne" value="true"> Sí</label>
                <label><input type="radio" name="needsPlusOne" value="false"> No</label>
              </div>
            </div>
          </div>
          <div id="plusOneWrap" class="plus-one-block" hidden>
            <div>
              <label for="plusOneName">Nombre de tu acompañante</label>
              <input id="plusOneName" name="plusOneName" type="text" placeholder="Nombre completo" />
            </div>
          </div>
        `
        : "";

      resultContainer.innerHTML = `
        <div class="result-card success">
          <h3>Encontramos tu invitación ✨</h3>
          <p>${guest.first_name} ${guest.last_name}</p>
        </div>

        <form id="responseForm" class="rsvp-form" novalidate>
          <div class="person-row">
            <div class="person-label">¿Asistirás?</div>
            <div class="person-options" role="radiogroup" aria-label="Asistencia">
              <label><input type="radio" name="attending" value="true" required> Asistiré</label>
              <label><input type="radio" name="attending" value="false" required> No asistiré</label>
            </div>
          </div>

          ${plusOneField}

          <button class="btn btn-primary" type="submit">Enviar RSVP</button>
          <p id="submitError" class="form-error" aria-live="polite"></p>
        </form>
      `;

      const responseForm = document.getElementById("responseForm");
      const submitError = document.getElementById("submitError");
      const plusOneQuestionWrap = document.getElementById("plusOneQuestionWrap");
      const plusOneWrap = document.getElementById("plusOneWrap");
      const plusOneNameInput = document.getElementById("plusOneName");
      const attendanceInputs = responseForm?.querySelectorAll('input[name="attending"]');

      if (!responseForm || !submitError) {
        lookupError.textContent = "El formulario de RSVP no está disponible temporalmente. Recarga la página e inténtalo de nuevo.";
        return;
      }

      const updateConditionalFields = () => {
        const attendingValue = responseForm.querySelector('input[name="attending"]:checked')?.value;
        const isAttending = attendingValue === "true";

        if (plusOneQuestionWrap) {
          plusOneQuestionWrap.hidden = !isAttending;
        }

        if (plusOneWrap) {
          const plusOneSelectedValue = responseForm.querySelector('input[name="needsPlusOne"]:checked')?.value;
          const showPlusOneName = isAttending && plusOneSelectedValue === "true";

          plusOneWrap.hidden = !showPlusOneName;

          if (plusOneNameInput) {
            plusOneNameInput.required = showPlusOneName;
            if (!showPlusOneName) plusOneNameInput.value = "";
          }
        }
      };

      attendanceInputs?.forEach((input) => input.addEventListener("change", updateConditionalFields));
      responseForm
        .querySelectorAll('input[name="needsPlusOne"]')
        .forEach((input) => input.addEventListener("change", updateConditionalFields));
      updateConditionalFields();

      responseForm.addEventListener("submit", async (submitEvent) => {
        submitEvent.preventDefault();
        submitError.textContent = "";

        const submitButton = responseForm.querySelector('button[type="submit"]');

        const attendingValue = responseForm.querySelector('input[name="attending"]:checked')?.value;
        const isAttending = attendingValue === "true";
        const needsPlusOneValue = responseForm.querySelector('input[name="needsPlusOne"]:checked')?.value;
        const needsPlusOne = needsPlusOneValue === "true";
        const plusOneName = plusOneNameInput?.value?.trim() || null;
        const guestCount = isAttending ? (guest.allowed_plus_one && needsPlusOne ? 2 : 1) : 0;

        if (attendingValue === undefined) {
          submitError.textContent = "Por favor selecciona si asistirás.";
          return;
        }

        if (guest.allowed_plus_one && isAttending && needsPlusOneValue === undefined) {
          submitError.textContent = "Por favor indícanos si necesitas acompañante.";
          return;
        }

        if (guest.allowed_plus_one && isAttending && needsPlusOne && !plusOneName) {
          submitError.textContent = "Por favor ingresa el nombre de tu acompañante.";
          return;
        }

        const { data: duplicateResponse, error: duplicateLookupError } = await supabase
          .from("rsvp_responses")
          .select("id")
          .eq("guest_id", guest.id)
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
          clearLookupFields(lookupForm);
          renderAlreadySubmittedMessage(resultContainer);
          return;
        }

        if (submitButton) submitButton.disabled = true;

        const { error: insertError } = await supabase.from("rsvp_responses").insert([
          {
            guest_id: guest.id,
            attending: isAttending,
            guest_count: guestCount,
            plus_one_name: guest.allowed_plus_one && isAttending && needsPlusOne ? plusOneName : null,
            submitted_at: new Date().toISOString()
          }
        ]);

        if (insertError) {
          console.error("RSVP insert failed", insertError);
          submitError.textContent = "No pudimos guardar tu RSVP en este momento. Inténtalo de nuevo.";
          if (submitButton) submitButton.disabled = false;
          return;
        }

        const responseHeading = isAttending
          ? "¡Gracias! Tu RSVP ha sido guardado."
          : "Gracias por avisarnos 💛";
        const responseCopy = isAttending
          ? "Recibimos tu respuesta y esperamos celebrar contigo."
          : "Te vamos a extrañar en nuestro gran día, pero agradecemos mucho tu cariño y buenos deseos.";

        resultContainer.innerHTML = `
          <div class="result-card success" role="status" aria-live="polite">
            <h3>${responseHeading}</h3>
            <p>${responseCopy}</p>
          </div>
        `;
        clearLookupFields(lookupForm);
      });
    } catch {
      lookupError.textContent = "No pudimos conectarnos al servicio de RSVP en este momento. Inténtalo de nuevo en un momento.";
    }
  });
}

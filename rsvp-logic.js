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
      <h3>We could not find your invitation.</h3>
      <p>Please check the spelling and try again.</p>
    </div>
  `;
}

function getFriendlyLookupError(error) {
  const status = error?.status ?? error?.code;

  if (status === 401 || status === 403) {
    return "RSVP lookup is temporarily unavailable. Please try again later.";
  }

  return "Could not search for your invitation right now.";
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
      <p>RSVP already received. If you need to make changes please contact us.</p>
    </div>
  `;
}

export function initRsvpFlow() {
  const supabase = window.supabaseClient;

  const lookupForm = document.getElementById("lookupForm");
  const resultContainer = document.getElementById("rsvpResult");
  const lookupError = document.getElementById("lookupError");

  if (!lookupForm || !resultContainer || !lookupError) return;

  if (!supabase) {
    lookupError.textContent = "RSVP service is not available right now. Please try again later.";
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
      lookupError.textContent = "Please enter both first and last name.";
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
        lookupError.textContent = "Could not verify RSVP status right now.";
        return;
      }

      if (existingResponse) {
        renderAlreadySubmittedMessage(resultContainer);
        return;
      }

      const maxGuests = Math.max(1, Number(guest.max_guests) || 1);
      const maxGuestCount = guest.allowed_plus_one ? maxGuests : 1;

      const plusOneField = guest.allowed_plus_one
        ? `
          <div id="plusOneWrap" class="plus-one-block" hidden>
            <div>
              <label for="plusOneName">Plus one name</label>
              <input id="plusOneName" name="plusOneName" type="text" placeholder="Full name" />
            </div>
          </div>
        `
        : "";

      resultContainer.innerHTML = `
        <div class="result-card success">
          <h3>We found your invitation ✨</h3>
          <p>${guest.first_name} ${guest.last_name}</p>
        </div>

        <form id="responseForm" class="rsvp-form" novalidate>
          <div class="person-row">
            <div class="person-label">Will you be attending?</div>
            <div class="person-options" role="radiogroup" aria-label="Attendance">
              <label><input type="radio" name="attending" value="true" required> Attending</label>
              <label><input type="radio" name="attending" value="false" required> Not attending</label>
            </div>
          </div>

          <div>
            <label for="guestCount">Number of guests</label>
            <input
              id="guestCount"
              name="guestCount"
              type="number"
              min="1"
              max="${maxGuestCount}"
              value="1"
              required
            />
          </div>

          ${plusOneField}

          <button class="btn btn-primary" type="submit">Submit RSVP</button>
          <p id="submitError" class="form-error" aria-live="polite"></p>
        </form>
      `;

      const responseForm = document.getElementById("responseForm");
      const submitError = document.getElementById("submitError");
      const guestCountInput = document.getElementById("guestCount");
      const plusOneWrap = document.getElementById("plusOneWrap");

      if (!responseForm || !submitError || !guestCountInput) {
        lookupError.textContent = "RSVP form is temporarily unavailable. Please refresh and try again.";
        return;
      }

      const updatePlusOneVisibility = () => {
        if (!plusOneWrap) return;
        const currentGuestCount = Number(guestCountInput.value) || 1;
        plusOneWrap.hidden = currentGuestCount !== 2;
      };

      guestCountInput.addEventListener("input", updatePlusOneVisibility);
      updatePlusOneVisibility();

      responseForm.addEventListener("submit", async (submitEvent) => {
        submitEvent.preventDefault();
        submitError.textContent = "";

        const submitButton = responseForm.querySelector('button[type="submit"]');

        const attendingValue = responseForm.querySelector('input[name="attending"]:checked')?.value;
        const guestCount = Number(guestCountInput.value || 1);
        const plusOneNameInput = document.getElementById("plusOneName");
        const plusOneName = plusOneNameInput?.value?.trim() || null;

        if (attendingValue === undefined) {
          submitError.textContent = "Please select whether you will attend.";
          return;
        }

        if (!Number.isInteger(guestCount) || guestCount < 1 || guestCount > maxGuestCount) {
          submitError.textContent = `Guest count must be between 1 and ${maxGuestCount}.`;
          return;
        }

        if (!guest.allowed_plus_one && guestCount > 1) {
          submitError.textContent = "This invitation does not allow a plus one.";
          return;
        }

        if (guest.allowed_plus_one && guestCount === 2 && !plusOneName) {
          submitError.textContent = "Please enter your plus one's name.";
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
          submitError.textContent = "Could not verify RSVP status right now. Please try again.";
          return;
        }

        if (duplicateResponse) {
          renderAlreadySubmittedMessage(resultContainer);
          return;
        }

        if (submitButton) submitButton.disabled = true;

        const { error: insertError } = await supabase.from("rsvp_responses").insert([
          {
            guest_id: guest.id,
            attending: attendingValue === "true",
            guest_count: guestCount,
            plus_one_name: guest.allowed_plus_one && guestCount === 2 ? plusOneName : null,
            submitted_at: new Date().toISOString()
          }
        ]);

        if (insertError) {
          console.error("RSVP insert failed", insertError);
          submitError.textContent = "We could not save your RSVP right now. Please try again.";
          if (submitButton) submitButton.disabled = false;
          return;
        }

        resultContainer.innerHTML = `
          <div class="result-card success" role="status" aria-live="polite">
            <h3>Thank you! Your RSVP has been saved.</h3>
            <p>We received your response and look forward to celebrating with you.</p>
          </div>
        `;
      });
    } catch {
      lookupError.textContent = "We could not connect to the RSVP service right now. Please try again in a moment.";
    }
  });
}

export function initRsvpFlow() {
  const supabase = window.supabaseClient;

  const lookupForm = document.getElementById("lookupForm");
  const resultContainer = document.getElementById("rsvpResult");
  const lookupError = document.getElementById("lookupError");

  if (!lookupForm || !resultContainer || !lookupError) return;

  lookupForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    lookupError.textContent = "";
    resultContainer.innerHTML = "";

    const firstName = document.getElementById("lookupFirstName")?.value.trim();
    const lastName = document.getElementById("lookupLastName")?.value.trim();

    if (!firstName || !lastName) {
      lookupError.textContent = "Please enter both first and last name.";
      return;
    }

    try {
      const { data: guest, error: guestError } = await supabase
        .from("guest_list")
        .select("*")
        .ilike("first_name", firstName)
        .ilike("last_name", lastName)
        .eq("invited", true)
        .maybeSingle();

      if (guestError) {
        lookupError.textContent = "Could not search for your invitation right now.";
        return;
      }

      if (!guest) {
        resultContainer.innerHTML = `
          <div class="result-card error" role="status" aria-live="polite">
            <h3>We could not find your invitation.</h3>
            <p>Please check the spelling and try again.</p>
          </div>
        `;
        return;
      }

      const { data: existingResponse, error: responseError } = await supabase
        .from("rsvp_responses")
        .select("id")
        .eq("guest_id", guest.id)
        .maybeSingle();

      if (responseError) {
        lookupError.textContent = "Could not verify RSVP status right now.";
        return;
      }

      if (existingResponse) {
        resultContainer.innerHTML = `
          <div class="result-card warning" role="status" aria-live="polite">
            <h3>RSVP already received</h3>
            <p>We already have a response for this invitation. Please contact us if you need to make changes.</p>
          </div>
        `;
        return;
      }

      const plusOneField = guest.allowed_plus_one
        ? `
          <div class="plus-one-block">
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
              max="${guest.max_guests || 1}"
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

      if (!responseForm || !submitError) return;

      responseForm.addEventListener("submit", async (submitEvent) => {
        submitEvent.preventDefault();
        submitError.textContent = "";

        const attendingValue = responseForm.querySelector('input[name="attending"]:checked')?.value;
        const guestCount = Number(document.getElementById("guestCount")?.value || 1);
        const plusOneName = document.getElementById("plusOneName")?.value.trim() || null;

        if (attendingValue === undefined) {
          submitError.textContent = "Please select whether you will attend.";
          return;
        }

        if (guestCount < 1 || guestCount > (guest.max_guests || 1)) {
          submitError.textContent = `Guest count must be between 1 and ${guest.max_guests || 1}.`;
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

        const { error: insertError } = await supabase
          .from("rsvp_responses")
          .insert([
            {
              guest_id: guest.id,
              attending: attendingValue === "true",
              guest_count: guestCount,
              plus_one_name: plusOneName,
              submitted_at: new Date().toISOString()
            }
          ]);

        if (insertError) {
          submitError.textContent = "We could not save your RSVP right now. Please try again.";
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

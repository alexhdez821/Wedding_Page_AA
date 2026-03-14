import { guestList, RSVP_STATUS } from "./rsvp-data.js";

const rsvpStorage = {
  key: "wedding-rsvp-responses",
  save(response) {
    const current = this.getAll();
    current[response.partyId] = response;
    localStorage.setItem(this.key, JSON.stringify(current));
  },
  getAll() {
    try {
      return JSON.parse(localStorage.getItem(this.key)) || {};
    } catch {
      return {};
    }
  },
  exists(partyId) {
    return Boolean(this.getAll()[partyId]);
  }
};

function normalizeName(value) {
  return value.trim().toLowerCase();
}

// Lookup by guest first + last name and return complete party record.
export function findGuestParty(firstName, lastName) {
  const cleanFirst = normalizeName(firstName);
  const cleanLast = normalizeName(lastName);

  return guestList.find((guest) => {
    const recordFirst = normalizeName(guest.firstName);
    const recordLast = normalizeName(guest.lastName);
    return cleanFirst === recordFirst && cleanLast === recordLast;
  }) || null;
}

function getOverallStatus(invitedGuests) {
  const hasAttending = invitedGuests.some((g) => g.rsvpStatus === RSVP_STATUS.ATTENDING);
  return hasAttending ? RSVP_STATUS.ATTENDING : RSVP_STATUS.NOT_ATTENDING;
}

function createPartyMemberRow(member, index) {
  return `
    <div class="person-row">
      <label class="person-label">${member.firstName} ${member.lastName}</label>
      <div class="person-options" role="radiogroup" aria-label="Attendance for ${member.firstName} ${member.lastName}">
        <label><input type="radio" name="member-${index}" value="${RSVP_STATUS.ATTENDING}" required> Attending</label>
        <label><input type="radio" name="member-${index}" value="${RSVP_STATUS.NOT_ATTENDING}" required> Not attending</label>
      </div>
    </div>
  `;
}

function renderFoundParty(guest) {
  const partyNames = guest.invitedGuests
    .map((person, idx) => createPartyMemberRow(person, idx))
    .join("");

  const plusOneField = guest.canBringPlusOne
    ? `
      <div class="plus-one-block">
        <h4>Your plus one</h4>
        <p class="inline-note">You may include one additional guest.</p>
        <div class="form-grid">
          <div>
            <label for="plusOneFirstName">Plus one first name</label>
            <input id="plusOneFirstName" name="plusOneFirstName" type="text" placeholder="First name" />
          </div>
          <div>
            <label for="plusOneLastName">Plus one last name</label>
            <input id="plusOneLastName" name="plusOneLastName" type="text" placeholder="Last name" />
          </div>
        </div>
        <div class="person-options" role="radiogroup" aria-label="Attendance for plus one">
          <label><input type="radio" name="plusOneStatus" value="${RSVP_STATUS.ATTENDING}"> Attending</label>
          <label><input type="radio" name="plusOneStatus" value="${RSVP_STATUS.NOT_ATTENDING}"> Not attending</label>
        </div>
      </div>
    `
    : "";

  return `
    <div class="result-card success">
      <h3>We found your invitation ✨</h3>
      <p>We are excited to celebrate with your party. Please confirm each invited guest below.</p>
      <ul class="invited-list">
        ${guest.invitedGuests.map((p) => `<li>${p.firstName} ${p.lastName}</li>`).join("")}
      </ul>
    </div>
    <form id="partyRsvpForm" class="rsvp-form" novalidate>
      <h4>Attendance by person</h4>
      ${partyNames}
      ${plusOneField}
      <div class="form-grid">
        <div>
          <label for="dietaryRestrictions">Dietary restrictions (optional)</label>
          <input id="dietaryRestrictions" name="dietaryRestrictions" type="text" placeholder="Vegetarian, allergies, etc." />
        </div>
        <div>
          <label for="guestMessage">Message for the couple (optional)</label>
          <input id="guestMessage" name="guestMessage" type="text" maxlength="160" placeholder="We can't wait to celebrate with you!" />
        </div>
      </div>
      <button class="btn btn-primary" type="submit">Submit RSVP</button>
      <p id="submitError" class="form-error" aria-live="polite"></p>
    </form>
  `;
}

function renderNotFound() {
  return `
    <div class="result-card error" role="status" aria-live="polite">
      <h3>We could not find your invitation.</h3>
      <p>Please contact us and we will happily help.</p>
    </div>
  `;
}

function getPartySubmission(guest, formData) {
  const invitedGuests = guest.invitedGuests.map((person, index) => ({
    ...person,
    rsvpStatus: formData.get(`member-${index}`)
  }));

  let plusOne = null;
  if (guest.canBringPlusOne) {
    const plusOneFirstName = formData.get("plusOneFirstName")?.trim() || "";
    const plusOneLastName = formData.get("plusOneLastName")?.trim() || "";
    const plusOneStatus = formData.get("plusOneStatus") || RSVP_STATUS.PENDING;

    // Only save plus one when one of the fields is completed.
    if (plusOneFirstName || plusOneLastName || plusOneStatus !== RSVP_STATUS.PENDING) {
      plusOne = {
        firstName: plusOneFirstName,
        lastName: plusOneLastName,
        rsvpStatus: plusOneStatus
      };
    }
  }

  return {
    id: guest.id,
    partyId: guest.partyId,
    submittedAt: new Date().toISOString(),
    invitedGuests,
    canBringPlusOne: guest.canBringPlusOne,
    plusOne,
    dietaryRestrictions: formData.get("dietaryRestrictions")?.trim() || "",
    guestMessage: formData.get("guestMessage")?.trim() || "",
    rsvpStatus: getOverallStatus(invitedGuests)
  };
}

function attachPartyFormHandler(guest, resultContainer) {
  const partyRsvpForm = document.getElementById("partyRsvpForm");
  if (!partyRsvpForm) return;

  partyRsvpForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const submitError = document.getElementById("submitError");

    if (rsvpStorage.exists(guest.partyId)) {
      submitError.textContent = "An RSVP was already submitted for this invitation. Please contact us if you need changes.";
      return;
    }

    const formData = new FormData(partyRsvpForm);
    const missingStatus = guest.invitedGuests.some((_, index) => !formData.get(`member-${index}`));

    if (missingStatus) {
      submitError.textContent = "Please select attendance for each invited guest.";
      return;
    }

    const submission = getPartySubmission(guest, formData);
    rsvpStorage.save(submission);

    resultContainer.innerHTML = `
      <div class="result-card success" role="status" aria-live="polite">
        <h3>Thank you! Your RSVP has been saved.</h3>
        <p>We received your response and look forward to celebrating with you.</p>
      </div>
    `;
  });
}

export function initRsvpFlow() {
  const lookupForm = document.getElementById("lookupForm");
  const resultContainer = document.getElementById("rsvpResult");

  if (!lookupForm || !resultContainer) return;

  lookupForm.addEventListener("submit", (event) => {
    event.preventDefault();

    const firstNameInput = document.getElementById("lookupFirstName");
    const lastNameInput = document.getElementById("lookupLastName");
    const lookupError = document.getElementById("lookupError");

    const firstName = firstNameInput.value.trim();
    const lastName = lastNameInput.value.trim();

    lookupError.textContent = "";
    resultContainer.innerHTML = "";

    if (!firstName || !lastName) {
      lookupError.textContent = "Please enter both first and last name.";
      return;
    }

    const guest = findGuestParty(firstName, lastName);

    if (!guest) {
      resultContainer.innerHTML = renderNotFound();
      return;
    }

    if (rsvpStorage.exists(guest.partyId)) {
      resultContainer.innerHTML = `
        <div class="result-card warning" role="status" aria-live="polite">
          <h3>RSVP already received</h3>
          <p>We already have a response for this invitation. Contact us if you need to make updates.</p>
        </div>
      `;
      return;
    }

    resultContainer.innerHTML = renderFoundParty(guest);
    attachPartyFormHandler(guest, resultContainer);
  });
}

// Backend integration path:
// 1) Replace findGuestParty with API call: GET /api/guest-lookup?firstName=...&lastName=...
// 2) Replace rsvpStorage.save with POST /api/rsvp
// 3) Keep this UI unchanged; only swap data access layer.

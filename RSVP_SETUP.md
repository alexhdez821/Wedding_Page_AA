# RSVP System Integration Notes

## File placement
This implementation is already wired for a simple static site setup:

- `index.html`
  - Contains the RSVP section markup and styling.
  - Loads RSVP logic via `<script type="module">`.
- `rsvp-data.js`
  - Mock guest list dataset.
  - Includes RSVP status constants.
- `rsvp-logic.js`
  - Guest lookup flow.
  - Party-based RSVP form rendering.
  - LocalStorage save logic (mock persistence).

## How the flow works
1. Guest clicks the `RSVP` link/button in navigation or hero and lands on `#rsvp`.
2. Guest enters first + last name in the lookup form.
3. `findGuestParty(firstName, lastName)` searches the mock dataset.
4. If found:
   - invited party members are displayed,
   - attendance choices are required per invited person,
   - plus-one fields appear when allowed,
   - optional dietary restrictions + message can be added.
5. If not found, a polite error message is shown.
6. Submission is saved in `localStorage` for now.
7. Duplicate submissions are blocked per `partyId`.

## Guest record shape
Each top-level guest object follows this shape:

```js
{
  id: "g-102",
  firstName: "Daniel",
  lastName: "Martinez",
  partyId: "p-200",
  invitedGuests: [
    { id: "p-200-1", firstName: "Daniel", lastName: "Martinez", rsvpStatus: "pending" }
  ],
  canBringPlusOne: true,
  plusOneName: "",
  rsvpStatus: "pending"
}
```

## Later: connect to backend / Google Sheets
You can keep the current UI and replace only data calls in `rsvp-logic.js`.

### Option A: API + database
- Replace `findGuestParty()` with a server request.
  - Example: `GET /api/guest-lookup?firstName=...&lastName=...`
- Replace `rsvpStorage.save()` with a server request.
  - Example: `POST /api/rsvp` with JSON payload.
- Enforce duplicate prevention server-side with unique constraint on `partyId`.

### Option B: Google Sheets
- Create a Google Apps Script web app endpoint.
- Use one sheet for guest list and one for RSVP responses.
- In frontend:
  - call Apps Script for lookup (GET),
  - call Apps Script for save (POST).
- Keep response payload format close to current `submission` object for easy migration.

## Quick customization tips
- Edit labels and messages in `rsvp-logic.js` for your tone.
- Update sample guest names in `rsvp-data.js`.
- Adjust colors and spacing for RSVP UI in `index.html` (styles under `.rsvp-*` selectors).

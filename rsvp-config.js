// RSVP backend configuration.
// Fill these values to enable Supabase-backed RSVP tracking.
export const RSVP_BACKEND = {
  provider: "supabase",
  supabaseUrl: "",
  supabaseAnonKey: "",
  tables: {
    guestParties: "guest_parties",
    responses: "rsvp_responses",
    weddingActions: "wedding_actions"
  }
};

export function isBackendConfigured() {
  return Boolean(RSVP_BACKEND.supabaseUrl && RSVP_BACKEND.supabaseAnonKey);
}

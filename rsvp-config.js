// RSVP backend configuration.
// Fill these values to enable Supabase-backed RSVP tracking.
export const RSVP_BACKEND = {
  provider: "supabase",
  supabaseUrl: "https://twlgumwcxaooekfspmjp.supabase.co",
  supabaseAnonKey: "sb_publishable_fhY_fL9EFhnY2R0ccRgrAw_fJnLKLO3",
  tables: {
    guestParties: "guest_parties",
    responses: "rsvp_responses",
    weddingActions: "wedding_actions"
  }
};

export function isBackendConfigured() {
  return Boolean(RSVP_BACKEND.supabaseUrl && RSVP_BACKEND.supabaseAnonKey);
}

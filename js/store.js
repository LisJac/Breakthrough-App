/* Pick the data layer: the shared Supabase one on the real site, the
 * browser-only one inside the claude.ai preview (which can't reach Supabase). */
window.Store = (!window.claude && window.SharedStore) || window.LocalStore;

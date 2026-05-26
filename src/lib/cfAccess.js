// Cloudflare Access identity helper.
//
// When the site is fronted by Cloudflare Access (Zero Trust), Cloudflare
// authenticates the user at the edge BEFORE the app loads. The app itself
// trusts that anyone reaching it is authenticated.
//
// `/cdn-cgi/access/get-identity` returns the JSON identity (email, name,
// groups) for display purposes only. It MUST NOT be used for authorization
// inside the SPA — real authorization happens at the edge.
//
// On local dev (no CF Access in front), the endpoint 404s. We gracefully
// fall back to a placeholder identity so the app still works.

const FALLBACK = { email: "local-dev@local", name: "本地开发", groups: [] };

let cached = null;

export async function getIdentity() {
  if (cached) return cached;
  try {
    const res = await fetch("/cdn-cgi/access/get-identity", {
      credentials: "include",
      cache: "no-store",
    });
    if (!res.ok) throw new Error("no CF Access in front");
    const data = await res.json();
    cached = {
      email: data.email || FALLBACK.email,
      name: data.name || (data.email ? data.email.split("@")[0] : FALLBACK.name),
      groups: data.groups || [],
    };
    return cached;
  } catch {
    cached = FALLBACK;
    return FALLBACK;
  }
}

export const LOGOUT_URL = "/cdn-cgi/access/logout";

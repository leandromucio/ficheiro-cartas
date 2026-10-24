// Same surface as @netlify/identity, backed by the app's own /api/auth endpoints (self-hosted build).
async function call(path, body) {
  const r = await fetch(path, { method: body ? 'POST' : 'GET', credentials: 'same-origin', headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || ('Erro ' + r.status));
  return j;
}
export async function getUser() { try { const j = await call('/api/auth/me'); return j.user || null; } catch { return null; } }
export async function login(email, password) { return (await call('/api/auth/login', { email, password })).user; }
export async function signup(email, password, data) { return (await call('/api/auth/signup', { email, password, invite: data && data.invite })).user; }
export async function logout() { await call('/api/auth/logout', {}); }
export async function handleAuthCallback() { return null; }
export async function refreshSession() { return null; }
export async function requestPasswordRecovery() { throw new Error('Para trocar a senha, peça ao administrador do Fichário.'); }
export async function updateUser(u) { return (await call('/api/auth/password', { password: u.password })).user; }

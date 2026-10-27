/** Contador anónimo de navegadores únicos para GitHub Pages. Cloudflare Worker + D1. */
const ALLOWED_ORIGIN = 'https://plataformas2307.github.io';
const CORS = {
  'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Cache-Control': 'no-store',
  'Content-Type': 'application/json; charset=utf-8'
};
export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, {status:204, headers:CORS});
    }
    if (request.method !== 'POST') return new Response(JSON.stringify({error:'Método no permitido'}), {status:405, headers:CORS});
    const origin = request.headers.get('Origin');
    if (origin !== ALLOWED_ORIGIN) return new Response(JSON.stringify({error:'Origen no permitido'}), {status:403, headers:CORS});
    try {
      const body = await request.json();
      const visitorId = body?.visitorId;
      if (typeof visitorId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(visitorId)) {
        return new Response(JSON.stringify({error:'ID inválido'}), {status:400, headers:CORS});
      }
      // Guardar solo hash del ID anónimo; no almacenar IP, nombres ni teléfono.
      const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(visitorId));
      const key = Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2,'0')).join('');
      await env.DB.prepare('INSERT OR IGNORE INTO visitors (visitor_hash) VALUES (?)').bind(key).run();
      const row = await env.DB.prepare('SELECT COUNT(*) AS count FROM visitors').first();
      return new Response(JSON.stringify({count:Number(row.count)}), {headers:CORS});
    } catch (e) {
      console.error(e);
      return new Response(JSON.stringify({error:'Error al consultar el contador'}), {status:500, headers:CORS});
    }
  }
};

/**
 * GET /api/hash?path=/editor/app.js
 *
 * Verificação de integridade da publicação (padrão da casa): baixa um arquivo
 * estático do próprio site (somente /editor/* e /core/*) e devolve tamanho e
 * SHA-256, para comparar com o repositório (`sha256sum packages/editor/app.js`).
 * Não recebe nem executa nada — só lê e resume.
 */
import { createHash } from 'node:crypto';

export default async function handler(req, res) {
  let path = req.query?.path ?? '';
  if (Array.isArray(path)) path = path[0];
  path = String(path).trim();
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  if (!/^\/(editor|core)\/[a-z0-9._/-]+$/.test(path) || path.includes('..')) {
    res.status(400).send(JSON.stringify({ error: 'Parâmetro "path" inválido (use /editor/arquivo ou /core/arquivo).' }));
    return;
  }
  const host = req.headers?.['x-forwarded-host'] ?? req.headers?.host;
  if (!host) {
    res.status(500).send(JSON.stringify({ error: 'Host desconhecido.' }));
    return;
  }
  // Na Vercel é sempre https; o dev-server informa http em x-forwarded-proto.
  const proto = req.headers?.['x-forwarded-proto'] ?? 'https';
  try {
    const r = await fetch(`${proto}://${host}${path}`, { signal: AbortSignal.timeout(20_000) });
    const buf = Buffer.from(await r.arrayBuffer());
    res.status(200).send(
      JSON.stringify({
        path,
        status: r.status,
        contentType: r.headers.get('content-type'),
        bytes: buf.length,
        sha256: createHash('sha256').update(buf).digest('hex'),
      }),
    );
  } catch (e) {
    res.status(502).send(JSON.stringify({ error: e.message }));
  }
}

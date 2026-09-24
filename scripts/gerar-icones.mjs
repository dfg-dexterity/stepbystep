// Gera packages/extensao/icones/{16,32,48,128}.png sem dependências: quadrado base #1B1B1B com um
// círculo cerceta #009994 e um ponto off-white #F7F3E7 (o "gravar" da Dexterity). Bordas suavizadas
// por superamostragem. Idempotente; os PNGs gerados são versionados. Uso: `node scripts/gerar-icones.mjs`.
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { codificarPng } from './png-minimo.mjs';

const RAIZ = fileURLToPath(new URL('..', import.meta.url));
const DESTINO = join(RAIZ, 'packages', 'extensao', 'icones');
export const TAMANHOS = [16, 32, 48, 128];

const BASE = [0x1b, 0x1b, 0x1b];
const CERCETA = [0x00, 0x99, 0x94];
const OFF = [0xf7, 0xf3, 0xe7];
const SUBAMOSTRAS = 4; // 4×4 amostras por pixel

/** @param {number} n lado do ícone @returns {Uint8Array} PNG RGBA */
export function desenharIcone(n) {
  const rgba = new Uint8Array(n * n * 4);
  const centro = n / 2;
  const raioCirculo = n * 0.36;
  const raioPonto = n * 0.12;
  const total = SUBAMOSTRAS * SUBAMOSTRAS;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      let noCirculo = 0;
      let noPonto = 0;
      for (let sy = 0; sy < SUBAMOSTRAS; sy++) {
        for (let sx = 0; sx < SUBAMOSTRAS; sx++) {
          const d = Math.hypot(x + (sx + 0.5) / SUBAMOSTRAS - centro, y + (sy + 0.5) / SUBAMOSTRAS - centro);
          if (d <= raioCirculo) noCirculo++;
          if (d <= raioPonto) noPonto++;
        }
      }
      const cobCirculo = noCirculo / total;
      const cobPonto = noPonto / total;
      // camadas: base → círculo cerceta → ponto off-white
      const o = (y * n + x) * 4;
      for (let c = 0; c < 3; c++) {
        const comCirculo = BASE[c] + (CERCETA[c] - BASE[c]) * cobCirculo;
        rgba[o + c] = Math.round(comCirculo + (OFF[c] - comCirculo) * cobPonto);
      }
      rgba[o + 3] = 255;
    }
  }
  return codificarPng({ largura: n, altura: n, rgba });
}

export async function gerarIcones(destino = DESTINO) {
  await mkdir(destino, { recursive: true });
  const saidas = [];
  for (const n of TAMANHOS) {
    const caminho = join(destino, `${n}.png`);
    await writeFile(caminho, desenharIcone(n));
    saidas.push(caminho);
  }
  return saidas;
}

const ehPrincipal = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (ehPrincipal) {
  const saidas = await gerarIcones();
  console.log(`Ícones gerados:\n${saidas.map((s) => `  ${s}`).join('\n')}`);
}

// Redução de imagem no navegador (OffscreenCanvas). Importável em Node; só falha ao chamar.

/**
 * @param {Blob} blob @param {{larguraMax:number, tipo?:'image/png'|'image/webp', qualidade?:number}} opcoes
 * @returns {Promise<Blob>}
 */
export async function reduzirImagem(blob, opcoes) {
  if (typeof OffscreenCanvas === 'undefined' || typeof createImageBitmap === 'undefined') {
    throw new Error('reduzirImagem exige OffscreenCanvas (só navegador)');
  }
  const larguraMax = opcoes?.larguraMax;
  const tipo = opcoes?.tipo ?? 'image/png';
  const bitmap = await createImageBitmap(blob);
  try {
    const fator = larguraMax > 0 && bitmap.width > larguraMax ? larguraMax / bitmap.width : 1;
    const largura = Math.max(1, Math.round(bitmap.width * fator));
    const altura = Math.max(1, Math.round(bitmap.height * fator));
    const canvas = new OffscreenCanvas(largura, altura);
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, 0, 0, largura, altura);
    return await canvas.convertToBlob(tipo === 'image/png' ? { type: tipo } : { type: tipo, quality: opcoes?.qualidade ?? 0.9 });
  } finally {
    bitmap.close?.();
  }
}

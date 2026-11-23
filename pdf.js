// One full-page image per badge. Page size is the badge size in inches.
(function (root, factory) {
  const api = factory();
  if (root) root.BadgePdf = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  function concat(parts) {
    let length = 0;
    for (const part of parts) length += part.length;
    const out = new Uint8Array(length);
    let offset = 0;
    for (const part of parts) {
      out.set(part, offset);
      offset += part.length;
    }
    return out;
  }

  function trimNum(value) {
    return (Math.round(value * 1000) / 1000).toString();
  }

  function canvasRgb(canvas) {
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const rgb = new Uint8Array(canvas.width * canvas.height * 3);
    const src = image.data;
    let j = 0;
    for (let i = 0; i < src.length; i += 4) {
      rgb[j++] = src[i];
      rgb[j++] = src[i + 1];
      rgb[j++] = src[i + 2];
    }
    return rgb;
  }

  async function deflate(bytes) {
    if (typeof CompressionStream !== "function") {
      throw new Error("This browser cannot build PDFs. Use the current version of Edge or Chrome.");
    }
    const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("deflate"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  async function buildPdf(canvases, widthIn, heightIn) {
    if (!canvases.length) throw new Error("No badges to export.");
    const encoder = new TextEncoder();
    const text = (value) => encoder.encode(value);
    const wPt = trimNum(widthIn * 72);
    const hPt = trimNum(heightIn * 72);
    const bodies = [null];
    const add = (bytes) => {
      bodies.push(bytes);
      return bodies.length - 1;
    };

    const pageCount = canvases.length;
    const pageIds = [];
    for (let i = 0; i < pageCount; i++) pageIds.push(5 + i * 3);

    add(text("<< /Type /Catalog /Pages 2 0 R >>"));
    add(text(`<< /Type /Pages /Count ${pageCount} /Kids [${pageIds.map((id) => id + " 0 R").join(" ")}] >>`));

    for (let i = 0; i < pageCount; i++) {
      const canvas = canvases[i];
      const rgb = canvasRgb(canvas);
      const compressed = await deflate(rgb);
      const imageId = 3 + i * 3;
      const contentId = 4 + i * 3;
      add(concat([
        text(`<< /Type /XObject /Subtype /Image /Width ${canvas.width} /Height ${canvas.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /Length ${compressed.length} >>\nstream\n`),
        compressed,
        text("\nendstream"),
      ]));
      // Image samples are already top-to-bottom, matching how this page draws them.
      const commands = text(`q\n${wPt} 0 0 ${hPt} 0 0 cm\n/Im0 Do\nQ\n`);
      add(concat([
        text(`<< /Length ${commands.length} >>\nstream\n`),
        commands,
        text("\nendstream"),
      ]));
      add(text(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${wPt} ${hPt}] /Resources << /XObject << /Im0 ${imageId} 0 R >> >> /Contents ${contentId} 0 R >>`));
    }

    const chunks = [text("%PDF-1.4\n%\xFF\xFF\xFF\xFF\n")];
    const offsets = [0];
    let position = chunks[0].length;
    for (let id = 1; id < bodies.length; id++) {
      offsets[id] = position;
      const parts = [text(`${id} 0 obj\n`), bodies[id], text("\nendobj\n")];
      for (const part of parts) {
        chunks.push(part);
        position += part.length;
      }
    }
    const xrefStart = position;
    let xref = `xref\n0 ${bodies.length}\n0000000000 65535 f \n`;
    for (let id = 1; id < bodies.length; id++) {
      xref += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
    }
    xref += `trailer\n<< /Size ${bodies.length} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;
    chunks.push(text(xref));
    return concat(chunks);
  }

  return { buildPdf };
});

// Fabrique un PDF minimal portant une pièce jointe compressée deflate, à
// l'image des PDF LRPGN (flux /Type/EmbeddedFile + /Filter/FlateDecode).
// Évite d'embarquer un binaire de 100 Ko dans le dépôt pour les tests.

async function deflate(texte: string): Promise<Uint8Array<ArrayBuffer>> {
  const flux = new Blob([texte]).stream().pipeThrough(new CompressionStream("deflate"));
  return new Uint8Array<ArrayBuffer>(await new Response(flux).arrayBuffer());
}

function concat(morceaux: Uint8Array<ArrayBuffer>[]): Uint8Array<ArrayBuffer> {
  const total = morceaux.reduce((n, m) => n + m.length, 0);
  const out = new Uint8Array(total);
  let pos = 0;
  for (const m of morceaux) {
    out.set(m, pos);
    pos += m.length;
  }
  return out;
}

export async function pdfAvecXml(xml: string, nom = "pv.pdf"): Promise<File> {
  const enc = new TextEncoder();
  const comprime = await deflate(xml);
  const octets = concat([
    enc.encode(
      "%PDF-1.7\n27 0 obj\n<</Length " +
        comprime.length +
        "/Type/EmbeddedFile/Filter/FlateDecode/Params<</ModDate(D:20250221144846+01'00')/Size " +
        xml.length +
        ">>/Subtype/application#2foctet-stream>>stream\n"
    ),
    comprime,
    // Saut de ligne avant endstream : c'est ce que produisent les PDF réels,
    // et l'extraction doit le supporter.
    enc.encode("\nendstream\nendobj\n%%EOF\n"),
  ]);
  return new File([octets], nom, { type: "application/pdf" });
}

export async function pdfSansPieceJointe(nom = "pv.pdf"): Promise<File> {
  const octets = new TextEncoder().encode("%PDF-1.7\n1 0 obj\n<</Type/Page>>\nendobj\n%%EOF\n");
  return new File([octets], nom, { type: "application/pdf" });
}

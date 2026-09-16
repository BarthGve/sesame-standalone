import "@testing-library/jest-dom";

// jsdom ne fournit pas ces API dont dépend le MainLayout (useResponsive) du ui-kit.
if (typeof window !== "undefined" && !window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

// jsdom ne fournit pas Blob.prototype.stream(), dont dépendent extraireXmlPdf
// et pdfAvecXml (compression/décompression du flux). On le complète ici avec
// une implémentation basée sur arrayBuffer(), disponible dans jsdom.
if (!Blob.prototype.stream) {
  Blob.prototype.stream = function (this: Blob): ReadableStream<Uint8Array<ArrayBuffer>> {
    const blob = this;
    return new ReadableStream({
      async start(controller) {
        controller.enqueue(new Uint8Array<ArrayBuffer>(await blob.arrayBuffer()));
        controller.close();
      },
    });
  };
}

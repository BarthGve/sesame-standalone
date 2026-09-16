// Manual mock of maplibre-gl for tests running under jsdom (no WebGL/canvas).
// Reused via: vi.mock("maplibre-gl", () => import("../test/maplibre-mock"))

class FakeMap {
  constructor(_opts?: unknown) {}
  addControl(..._args: unknown[]) {}
  on(..._args: unknown[]) {}
  once(..._args: unknown[]) {}
  getSource(..._args: unknown[]) {
    return undefined;
  }
  addSource(..._args: unknown[]) {}
  addLayer(..._args: unknown[]) {}
  getLayer(..._args: unknown[]) {
    return undefined;
  }
  setPaintProperty(..._args: unknown[]) {}
  isStyleLoaded() {
    return false;
  }
  fitBounds(..._args: unknown[]) {}
  resize() {}
  remove() {}
  getCanvas() {
    return { style: {} } as unknown as HTMLCanvasElement;
  }
}

class FakeNavigationControl {
  constructor(_opts?: unknown) {}
}

class FakePopup {
  constructor(_opts?: unknown) {}
  setLngLat(..._args: unknown[]) {
    return this;
  }
  setHTML(..._args: unknown[]) {
    return this;
  }
  addTo(..._args: unknown[]) {
    return this;
  }
}

const maplibregl = {
  Map: FakeMap,
  NavigationControl: FakeNavigationControl,
  Popup: FakePopup,
};

export default maplibregl;
export { FakeMap as Map, FakeNavigationControl as NavigationControl, FakePopup as Popup };

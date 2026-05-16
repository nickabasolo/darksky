// Colorized light pollution tiles from David Lorenz's Light Pollution Atlas.
// 1024px tiles with zoomOffset: -2 (each tile covers 4x the area of a standard 256px tile).
// URL uses {z}/{x}/{y} Leaflet placeholders mapped to tile_{z}_{x}_{y} naming.

const LORENZ_BASE = 'https://djlorenz.github.io/astronomy/image_tiles'
const LORENZ_ATTRIBUTION = '<a href="https://djlorenz.github.io/astronomy/lp/" target="_blank">Light Pollution Atlas</a> (D. Lorenz) &middot; VIIRS/EOG'

function lorenzLayer(year) {
  return {
    url: `${LORENZ_BASE}/tiles${year}/tile_{z}_{x}_{y}.png`,
    attribution: LORENZ_ATTRIBUTION,
    tileSize: 1024,
    zoomOffset: -2,
    maxNativeZoom: 8,
    maxZoom: 19,
    minZoom: 2,
    opacity: 0.5,
    errorTileUrl: `${LORENZ_BASE}/tiles${year}/black.png`,
  }
}

export const LIGHT_POLLUTION_LAYERS = {
  '2024': { label: '2024', ...lorenzLayer(2024) },
  '2023': { label: '2023', ...lorenzLayer(2023) },
  '2022': { label: '2022', ...lorenzLayer(2022) },
  '2020': { label: '2020', ...lorenzLayer(2020) },
  '2016': { label: '2016', ...lorenzLayer(2016) },
}

export const DEFAULT_LAYER = '2024'

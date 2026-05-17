const CITY_TYPES = new Set([
  'city', 'town', 'village', 'hamlet', 'suburb', 'quarter',
  'neighbourhood', 'borough', 'municipality',
])

const REGION_TYPES = new Set([
  'county', 'district', 'state', 'province', 'region',
  'country', 'continent', 'archipelago', 'island', 'administrative',
])

export function classifyLocation(raw) {
  const t = raw.addresstype ?? raw.type ?? ''
  if (CITY_TYPES.has(t)) return 'city'
  if (REGION_TYPES.has(t)) return 'region'
  return 'point'
}

const ZONES = [
  { zone: '0',  score: 1,  hex: '#000000', lpiRange: '<0.01',       sqm: '22.00–21.99' },
  { zone: '1a', score: 2,  hex: '#222222', lpiRange: '0.01–0.06',   sqm: '21.99–21.93' },
  { zone: '1b', score: 3,  hex: '#424242', lpiRange: '0.06–0.11',   sqm: '21.93–21.89' },
  { zone: '2a', score: 4,  hex: '#142F72', lpiRange: '0.11–0.19',   sqm: '21.89–21.81' },
  { zone: '2b', score: 5,  hex: '#2154D8', lpiRange: '0.19–0.33',   sqm: '21.81–21.69' },
  { zone: '3a', score: 6,  hex: '#0F5714', lpiRange: '0.33–0.58',   sqm: '21.69–21.51' },
  { zone: '3b', score: 7,  hex: '#1FA12A', lpiRange: '0.58–1.00',   sqm: '21.51–21.25' },
  { zone: '4a', score: 8,  hex: '#6E641E', lpiRange: '1.00–1.73',   sqm: '21.25–20.91' },
  { zone: '4b', score: 9,  hex: '#B8A625', lpiRange: '1.73–3.00',   sqm: '20.91–20.49' },
  { zone: '5a', score: 10, hex: '#BF641E', lpiRange: '3.00–5.20',   sqm: '20.49–20.02' },
  { zone: '5b', score: 11, hex: '#FD9650', lpiRange: '5.20–9.00',   sqm: '20.02–19.50' },
  { zone: '6a', score: 12, hex: '#FB5A49', lpiRange: '9.00–15.59',  sqm: '19.50–18.95' },
  { zone: '6b', score: 13, hex: '#FB998A', lpiRange: '15.59–27.00', sqm: '18.95–18.38' },
  { zone: '7a', score: 14, hex: '#A0A0A0', lpiRange: '27.00–46.77', sqm: '18.38–17.80' },
  { zone: '7b', score: 15, hex: '#F2F2F2', lpiRange: '>46.77',      sqm: '<17.80' },
]

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

const ZONE_RGB = ZONES.map(z => ({ ...z, rgb: hexToRgb(z.hex) }))

function nearestZone(r, g, b) {
  let best = null
  let bestDist = Infinity
  for (const z of ZONE_RGB) {
    const d = (r - z.rgb[0]) ** 2 + (g - z.rgb[1]) ** 2 + (b - z.rgb[2]) ** 2
    if (d < bestDist) { bestDist = d; best = z }
  }
  return best
}

function latLngToTile(lat, lng, z) {
  const n = 2 ** z
  const x = Math.floor((lng + 180) / 360 * n)
  const latRad = lat * Math.PI / 180
  const y = Math.floor((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * n)
  const px = Math.floor(((lng + 180) / 360 * n - x) * 1024)
  const py = Math.floor(((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * n - y) * 1024)
  return { x, y, px, py }
}

export async function sampleLightLevel(lat, lng, year) {
  const SAMPLE_ZOOM = 6
  const { x, y, px, py } = latLngToTile(lat, lng, SAMPLE_ZOOM)
  const url = `https://djlorenz.github.io/astronomy/image_tiles/tiles${year}/tile_${SAMPLE_ZOOM}_${x}_${y}.png`

  const img = new Image()
  img.crossOrigin = 'anonymous'

  await new Promise((resolve, reject) => {
    img.onload = resolve
    img.onerror = reject
    img.src = url
  })

  const canvas = document.createElement('canvas')
  canvas.width = 1024
  canvas.height = 1024
  const ctx = canvas.getContext('2d')
  ctx.drawImage(img, 0, 0)
  const [r, g, b] = ctx.getImageData(px, py, 1, 1).data

  return nearestZone(r, g, b)
}

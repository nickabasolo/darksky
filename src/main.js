import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { LIGHT_POLLUTION_LAYERS, DEFAULT_LAYER } from './layers.js'
import { setupGeolocation } from './geolocation.js'
import { sampleLightLevel, classifyLocation } from './lightLevel.js'
import './style.css'

const map = L.map('map', {
  center: [38, -97],
  zoom: 4,
  zoomControl: false,
})

L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/">CARTO</a>',
  subdomains: 'abcd',
  maxZoom: 19,
}).addTo(map)

function makeLayer(key, opacity) {
  const cfg = LIGHT_POLLUTION_LAYERS[key]
  return L.tileLayer(cfg.url, {
    opacity,
    attribution: cfg.attribution,
    tileSize: cfg.tileSize,
    zoomOffset: cfg.zoomOffset,
    maxNativeZoom: cfg.maxNativeZoom,
    maxZoom: cfg.maxZoom,
    minZoom: cfg.minZoom,
    errorTileUrl: cfg.errorTileUrl,
  })
}

let lightLayer = makeLayer(DEFAULT_LAYER, LIGHT_POLLUTION_LAYERS[DEFAULT_LAYER].opacity).addTo(map)

// ── Opacity slider ──

const slider = document.getElementById('opacity-slider')
const opacityBtn = document.getElementById('opacity-btn')
const opacityWrap = document.getElementById('opacity-wrap')

slider.value = LIGHT_POLLUTION_LAYERS[DEFAULT_LAYER].opacity * 100
slider.addEventListener('input', () => {
  lightLayer.setOpacity(slider.value / 100)
})

opacityBtn.addEventListener('click', (e) => {
  e.stopPropagation()
  const open = opacityWrap.hidden
  opacityWrap.hidden = !open
  opacityBtn.classList.toggle('active', open)
})

document.addEventListener('click', (e) => {
  if (!opacityWrap.hidden && !opacityWrap.contains(e.target) && e.target !== opacityBtn) {
    opacityWrap.hidden = true
    opacityBtn.classList.remove('active')
  }
})

// ── Zoom controls ──

document.getElementById('zoom-in').addEventListener('click', () => map.zoomIn())
document.getElementById('zoom-out').addEventListener('click', () => map.zoomOut())

// ── Custom marker ──

const customIcon = L.divIcon({
  className: 'custom-marker',
  html: '<div class="marker-pin"></div>',
  iconSize: [14, 14],
  iconAnchor: [7, 7],
})

let activeMarker = null

export function placeMarker(lat, lng) {
  if (activeMarker) map.removeLayer(activeMarker)
  activeMarker = L.marker([lat, lng], { icon: customIcon }).addTo(map)
}

export function clearMarker() {
  if (activeMarker) {
    map.removeLayer(activeMarker)
    activeMarker = null
  }
}

// ── Search panel state ──

const searchPanel = document.getElementById('search-panel')
const searchInput = document.getElementById('search-input')
const searchClear = document.getElementById('search-clear')
const searchSuggestions = document.getElementById('search-suggestions')
const infoBody = document.getElementById('info-body')

function setExpanded(expanded) {
  searchPanel.classList.toggle('expanded', expanded)
}

export function showInfoCard(placeName, bodyHtml) {
  searchInput.value = placeName
  searchClear.hidden = false
  infoBody.innerHTML = bodyHtml
  infoBody.hidden = false
  searchSuggestions.hidden = true
  setExpanded(true)
}

export function hideInfoCard() {
  infoBody.hidden = true
  infoBody.innerHTML = ''
}

// ── Search ──

let debounceTimer = null
let currentResults = []
let activeIndex = -1

searchInput.addEventListener('input', () => {
  const q = searchInput.value.trim()
  searchClear.hidden = q.length === 0
  activeIndex = -1
  hideInfoCard()
  clearTimeout(debounceTimer)
  if (q.length < 2) {
    searchSuggestions.hidden = true
    setExpanded(false)
    return
  }
  debounceTimer = setTimeout(() => fetchSuggestions(q), 300)
})

searchInput.addEventListener('keydown', (e) => {
  const items = searchSuggestions.querySelectorAll('li')
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    activeIndex = Math.min(activeIndex + 1, items.length - 1)
    updateActiveItem(items)
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    activeIndex = Math.max(activeIndex - 1, -1)
    updateActiveItem(items)
  } else if (e.key === 'Enter') {
    e.preventDefault()
    const target = activeIndex >= 0 ? currentResults[activeIndex] : currentResults[0]
    if (target) selectResult(target)
  } else if (e.key === 'Escape') {
    searchSuggestions.hidden = true
    activeIndex = -1
    searchInput.blur()
    if (infoBody.hidden) setExpanded(false)
  }
})

function updateActiveItem(items) {
  items.forEach((li, i) => li.classList.toggle('active', i === activeIndex))
}

searchClear.addEventListener('click', () => {
  searchInput.value = ''
  searchClear.hidden = true
  searchSuggestions.hidden = true
  hideInfoCard()
  clearMarker()
  setExpanded(false)
})

async function fetchSuggestions(query) {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=5`,
      { headers: { 'Accept-Language': 'en' } }
    )
    const results = await res.json()
    renderSuggestions(results)
  } catch {
    searchSuggestions.hidden = true
  }
}

function renderSuggestions(results) {
  currentResults = results
  activeIndex = -1
  searchSuggestions.innerHTML = ''
  if (!results.length) {
    searchSuggestions.hidden = true
    setExpanded(false)
    return
  }
  results.forEach((r) => {
    const li = document.createElement('li')
    li.textContent = r.display_name
    li.addEventListener('click', () => selectResult(r))
    searchSuggestions.appendChild(li)
  })
  searchSuggestions.hidden = false
  setExpanded(true)
}

async function selectResult(r) {
  const lat = parseFloat(r.lat)
  const lng = parseFloat(r.lon)
  const label = r.display_name

  map.setView([lat, lng], 8)
  placeMarker(lat, lng)

  const locationType = classifyLocation(r)
  if (locationType === 'region') {
    showInfoCard(label, `<div class="info-note">Light levels may vary across this region.</div>`)
    return
  }

  showInfoCard(label, `<div class="info-loading">Sampling light level…</div>`)

  try {
    const zone = await sampleLightLevel(lat, lng, DEFAULT_LAYER)
    showInfoCard(label, `
      <div class="info-row"><span class="info-label">Zone</span><span class="info-value">${zone.zone}</span></div>
      <div class="info-row"><span class="info-label">LPI</span><span class="info-value">${zone.lpiRange}</span></div>
      <div class="info-row"><span class="info-label">Sky quality</span><span class="info-value">${zone.sqm} mag/arcsec²</span></div>
    `)
  } catch {
    showInfoCard(label, `<div class="info-note">Light level data unavailable.</div>`)
  }
}

// ── Geolocation ──

setupGeolocation(
  map,
  (lat, lng) => {
    placeMarker(lat, lng)
    showInfoCard(
      'Your location',
      `<div class="info-row"><span class="info-label">Lat</span><span class="info-value">${lat.toFixed(4)}°</span></div>` +
      `<div class="info-row"><span class="info-label">Lng</span><span class="info-value">${lng.toFixed(4)}°</span></div>`
    )
  },
  (message) => {
    showInfoCard('Location error', `<div class="info-note">${message}</div>`)
  }
)

// ── Close suggestions on outside click ──

document.addEventListener('click', (e) => {
  if (!searchSuggestions.hidden && !searchPanel.contains(e.target)) {
    searchSuggestions.hidden = true
    if (infoBody.hidden) setExpanded(false)
  }
})

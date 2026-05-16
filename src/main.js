import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png'
import markerIcon from 'leaflet/dist/images/marker-icon.png'
import markerShadow from 'leaflet/dist/images/marker-shadow.png'
import { LIGHT_POLLUTION_LAYERS, DEFAULT_LAYER } from './layers.js'
import { setupGeolocation } from './geolocation.js'
import './style.css'

// Vite's asset hashing breaks Leaflet's internal icon URL resolution.
delete L.Icon.Default.prototype._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
})

const map = L.map('map', {
  center: [38, -97],
  zoom: 4,
  zoomControl: true,
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

const slider = document.getElementById('opacity-slider')
slider.value = LIGHT_POLLUTION_LAYERS[DEFAULT_LAYER].opacity * 100
slider.addEventListener('input', () => {
  lightLayer.setOpacity(slider.value / 100)
})

const layerSelect = document.getElementById('layer-select')
layerSelect.addEventListener('change', () => {
  const opacity = slider.value / 100
  map.removeLayer(lightLayer)
  lightLayer = makeLayer(layerSelect.value, opacity).addTo(map)
})

setupGeolocation(map, (lat, lng) => {
  L.marker([lat, lng]).addTo(map).bindPopup('You are here').openPopup()
})

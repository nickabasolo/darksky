import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { LIGHT_POLLUTION_LAYERS, DEFAULT_LAYER } from './layers.js'

const container = document.getElementById('map')
if (container._leaflet_id) container._leaflet_id = undefined

export const map = L.map('map', {
  center: [38, -97],
  zoom: 4,
  zoomControl: false,
})

L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/">CARTO</a>',
  subdomains: 'abcd',
  maxZoom: 19,
}).addTo(map)

const cfg = LIGHT_POLLUTION_LAYERS[DEFAULT_LAYER]
const lightLayer = L.tileLayer(cfg.url, {
  opacity: cfg.opacity,
  attribution: cfg.attribution,
  tileSize: cfg.tileSize,
  zoomOffset: cfg.zoomOffset,
  maxNativeZoom: cfg.maxNativeZoom,
  maxZoom: cfg.maxZoom,
  minZoom: cfg.minZoom,
  errorTileUrl: cfg.errorTileUrl,
}).addTo(map)

export const defaultOpacity = cfg.opacity

export function setLayerOpacity(opacity) {
  lightLayer.setOpacity(opacity)
}

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

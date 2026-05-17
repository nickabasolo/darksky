import { useState, useEffect, useRef } from 'react'
import { map, placeMarker, clearMarker, setLayerOpacity, defaultOpacity } from './map.js'
import { geolocate } from './geolocation.js'
import { sampleLightLevel, classifyLocation } from './lightLevel.js'
import { DEFAULT_LAYER } from './layers.js'

const isMobile = window.matchMedia('(max-width: 640px)').matches
const MODAL_VH = 50 // mobile info modal height, % of viewport

const SEARCH_PROMPTS = ['DarkSky', 'national parks', 'cities', 'addresses', 'dark sky reserves', 'observatories']

function useTypingPlaceholder(active) {
  const [suffix, setSuffix] = useState('')
  const [idx, setIdx] = useState(0)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    if (!active) return
    const target = SEARCH_PROMPTS[idx]
    let timer
    if (!deleting) {
      if (suffix.length < target.length) {
        timer = setTimeout(() => setSuffix(target.slice(0, suffix.length + 1)), 80)
      } else {
        timer = setTimeout(() => setDeleting(true), 1800)
      }
    } else {
      if (suffix.length > 0) {
        timer = setTimeout(() => setSuffix(s => s.slice(0, -1)), 45)
      } else {
        setIdx(i => (i + 1) % SEARCH_PROMPTS.length)
        setDeleting(false)
      }
    }
    return () => clearTimeout(timer)
  }, [active, suffix, deleting, idx])

  return suffix
}

const POPULAR = [
  'Big Bend National Park, TX',
  'Death Valley National Park, CA',
  'Cherry Springs State Park, PA',
  'Grand Canyon National Park, AZ',
  'Joshua Tree National Park, CA',
  'Borrego Springs, CA',
]

// On mobile, offset the view so the pin sits above the modal rather than
// behind it. Modal occupies bottom 50% of viewport; place pin at ~37.5% from top.
function setViewWithOffset(lat, lng, zoom) {
  if (!isMobile) {
    map.setView([lat, lng], zoom)
    return
  }
  const vpH = window.visualViewport?.height ?? window.innerHeight
  const pinPx = map.project([lat, lng], zoom)
  const offsetY = vpH * 0.5 - vpH * 0.375 // shift center down by 12.5% of vpH
  const centerLatLng = map.unproject(pinPx.add([0, offsetY]), zoom)
  map.setView(centerLatLng, zoom)
}

function parseLocationName(displayName) {
  const commaIdx = displayName.indexOf(',')
  if (commaIdx === -1) return { title: displayName, subtitle: '' }
  return {
    title: displayName.slice(0, commaIdx).trim(),
    subtitle: displayName.slice(commaIdx + 1).trim(),
  }
}

function InfoModal({ infoCard, onClose, children }) {
  useEffect(() => {
    document.documentElement.style.setProperty('--sheet-h', `${MODAL_VH}vh`)
    return () => document.documentElement.style.setProperty('--sheet-h', '0px')
  }, [])

  const { title, subtitle } = parseLocationName(infoCard.name)

  return (
    <div id="sheet">
      <div id="sheet-header">
        <div id="sheet-header-text">
          <span id="sheet-title">{title}</span>
          {subtitle && <span id="sheet-subtitle">{subtitle}</span>}
        </div>
        <button id="sheet-close" aria-label="Close" onClick={onClose}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>
      <div id="sheet-body">
        {children}
      </div>
    </div>
  )
}

// One band per Lorenz colour group, aligned with GAUGE_BANDS order.
const SCORE_BANDS = [
  { max: 3,  label: 'Excellent',  desc: 'Pristine sky with virtually no artificial light pollution.' },
  { max: 5,  label: 'Very good',  desc: 'Very dark sky with minimal light pollution.' },
  { max: 7,  label: 'Good',       desc: 'Dark rural sky with low levels of light pollution.' },
  { max: 9,  label: 'Fair',       desc: 'Moderate light pollution, typical of rural–suburban areas.' },
  { max: 11, label: 'Poor',       desc: 'Significant light pollution across much of the sky.' },
  { max: 13, label: 'Very poor',  desc: 'Heavy light pollution. Consider travelling to a darker site.' },
  { max: 15, label: 'Severe',     desc: 'Severe urban light pollution across the entire sky.' },
]

function getScoreInfo(score) {
  return SCORE_BANDS.find(b => score <= b.max) ?? SCORE_BANDS[SCORE_BANDS.length - 1]
}

// Gauge geometry: 0° = 3 o'clock (SVG), clockwise positive (y-down).
// Arc runs from 150° (8 o'clock) clockwise 240° to 30° (4 o'clock).
const GAUGE_START = 150
const GAUGE_SWEEP = 240

// 7 bands matching the 7 Lorenz zone groups (0/1, 2, 3, 4, 5, 6, 7).
const GAUGE_BANDS = [
  { fromScore: 1,  toScore: 3,  color: '#6a6a6a' },  // zones 0 / 1
  { fromScore: 4,  toScore: 5,  color: '#2154D8' },  // zone 2
  { fromScore: 6,  toScore: 7,  color: '#1FA12A' },  // zone 3
  { fromScore: 8,  toScore: 9,  color: '#B8A625' },  // zone 4
  { fromScore: 10, toScore: 11, color: '#FD9650' },  // zone 5
  { fromScore: 12, toScore: 13, color: '#FB5A49' },  // zone 6
  { fromScore: 14, toScore: 15, color: '#C8C8C8' },  // zone 7
]

const GAUGE_GAP  = 6   // degrees gap between segments (accommodates round caps)
const THIN_W     = 6   // inactive segment stroke width
const THICK_W    = 13  // active segment stroke width
const DOT_R      = 9   // needle dot radius

// Pre-compute each band's start / end angle, distributing arc proportionally
// to the number of scores in each band, minus inter-segment gaps.
const BAND_ANGLES = (() => {
  const totalScores  = 15
  const contentSweep = GAUGE_SWEEP - (GAUGE_BANDS.length - 1) * GAUGE_GAP
  let angle = GAUGE_START
  return GAUGE_BANDS.map(b => {
    const count = b.toScore - b.fromScore + 1
    const sweep = (count / totalScores) * contentSweep
    const start = angle
    const end   = angle + sweep
    angle = end + GAUGE_GAP
    return { start, end, sweep }
  })
})()

function polar(cx, cy, r, deg) {
  const rad = (deg * Math.PI) / 180
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) }
}

function arcPath(cx, cy, r, startDeg, endDeg) {
  const s = polar(cx, cy, r, startDeg)
  const e = polar(cx, cy, r, endDeg)
  const large = (endDeg - startDeg) > 180 ? 1 : 0
  return `M ${s.x.toFixed(2)} ${s.y.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${e.x.toFixed(2)} ${e.y.toFixed(2)}`
}

function scoreToAngle(score) {
  const idx   = GAUGE_BANDS.findIndex(b => score >= b.fromScore && score <= b.toScore)
  const band  = GAUGE_BANDS[idx]
  const angles = BAND_ANGLES[idx]
  const range = band.toScore - band.fromScore
  const t     = range === 0 ? 0 : (score - band.fromScore) / range
  return angles.start + t * angles.sweep
}

function GaugeChart({ score }) {
  const cx = 130, cy = 125, r = 90
  const activeBandIdx = GAUGE_BANDS.findIndex(b => score >= b.fromScore && score <= b.toScore)
  const activeColor   = GAUGE_BANDS[activeBandIdx]?.color ?? '#fff'
  const needleAngle   = scoreToAngle(score)
  const rad           = (needleAngle * Math.PI) / 180
  const dotPos        = polar(cx, cy, r, needleAngle)

  // Triangle: tip points toward dot, base closer to center
  const tip   = polar(cx, cy, r - DOT_R - 3, needleAngle)
  const baseC = polar(cx, cy, r - DOT_R - 18, needleAngle)
  const px    = Math.cos(rad + Math.PI / 2)
  const py    = Math.sin(rad + Math.PI / 2)
  const hw    = 5
  const triPts = [
    `${tip.x.toFixed(1)},${tip.y.toFixed(1)}`,
    `${(baseC.x + hw * px).toFixed(1)},${(baseC.y + hw * py).toFixed(1)}`,
    `${(baseC.x - hw * px).toFixed(1)},${(baseC.y - hw * py).toFixed(1)}`,
  ].join(' ')

  const info = getScoreInfo(score)
  const display10 = (score / 15 * 10).toFixed(1)

  // Draw inactive bands first, active band last so it sits on top
  const renderOrder = [...GAUGE_BANDS.keys()].sort((a, b) =>
    a === activeBandIdx ? 1 : b === activeBandIdx ? -1 : 0
  )

  return (
    <svg viewBox="0 0 260 205" className="gauge-svg" aria-label={`Sky quality: ${display10} out of 10 — ${info.label}`}>
      {renderOrder.map(i => {
        const band   = GAUGE_BANDS[i]
        const angles = BAND_ANGLES[i]
        const isActive = i === activeBandIdx
        const isLit    = i <= activeBandIdx
        return (
          <path key={i}
            d={arcPath(cx, cy, r, angles.start, angles.end)}
            fill="none"
            stroke={band.color}
            strokeWidth={isActive ? THICK_W : THIN_W}
            strokeLinecap="round"
            opacity={isLit ? 1 : 0.25}
          />
        )
      })}
      {/* Triangle pointer — no line, just the arrow */}
      <polygon points={triPts} fill="white" />
      {/* Dot: active band colour fill + white stroke */}
      <circle
        cx={dotPos.x.toFixed(1)} cy={dotPos.y.toFixed(1)}
        r={DOT_R} fill={activeColor} stroke="white" strokeWidth="2.5"
      />
      {/* Title above the score */}
      <text x={cx} y={cy - 44} textAnchor="middle" fontSize="10" fontWeight="500" fill="#8090b8" fontFamily="system-ui,-apple-system,sans-serif">
        Light level
      </text>
      {/* Score */}
      <text x={cx} y={cy - 0} textAnchor="middle" fontSize="44" fontWeight="700" fill="white" fontFamily="system-ui,-apple-system,sans-serif">
        {display10}
      </text>
      {/* Quality label */}
      <text x={cx} y={cy + 24} textAnchor="middle" fontSize="16" fontWeight="600" fill="#c8d0e0" fontFamily="system-ui,-apple-system,sans-serif">
        {info.label}
      </text>
    </svg>
  )
}

function InfoHeader({ name, onClose }) {
  const { title, subtitle } = parseLocationName(name)
  return (
    <div className="info-header">
      <div className="info-header-text">
        <span className="info-header-title">{title}</span>
        {subtitle && <span className="info-header-subtitle">{subtitle}</span>}
      </div>
      <button className="info-header-close" aria-label="Close" onClick={onClose}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
          <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
    </div>
  )
}

function InfoBody({ card, onOpenAbout }) {
  if (!card) return null
  if (card.type === 'loading') return <p className="info-loading">Sampling light level…</p>
  if (card.type === 'region') return <p className="info-note">Light levels may vary across this region.</p>
  if (card.type === 'error') return <p className="info-note">{card.message}</p>
  if (card.type === 'zone') {
    const score = card.score ?? 8
    const info = getScoreInfo(score)
    return (
      <div className="zone-card">
        <GaugeChart score={score} />
        <p className="zone-desc">{info.desc}</p>
        <div className="gauge-stats">
          <div className="stat-item">
            <span className="stat-label">Zone</span>
            <span className="stat-value">{card.zone}</span>
          </div>
          <div className="stat-item">
            <span className="stat-label">LPI</span>
            <span className="stat-value">{card.lpiRange}</span>
          </div>
          <div className="stat-item">
            <span className="stat-label">Quality</span>
            <span className="stat-value">{card.sqm}</span>
          </div>
        </div>
        <button type="button" className="score-help-link" onClick={onOpenAbout}>
          How is this score calculated?
        </button>
      </div>
    )
  }
  if (card.type === 'location') return (
    <>
      <div className="info-row"><span className="info-label">Lat</span><span className="info-value">{card.lat.toFixed(4)}°</span></div>
      <div className="info-row"><span className="info-label">Lng</span><span className="info-value">{card.lng.toFixed(4)}°</span></div>
    </>
  )
  return null
}

function AboutModal({ onClose }) {
  return (
    <div id="about-backdrop" onClick={onClose}>
      <div id="about-modal" onClick={e => e.stopPropagation()}>
        <div id="about-header">
          <span id="about-title">About DarkSky</span>
          <button id="about-close" aria-label="Close" onClick={onClose}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
        <div id="about-body">
          <p>I put together DarkSky as a simple, easy way to see light pollution levels in your area so you can find the best spot for nighttime stargazing.</p>
          <h3>How it works</h3>
          <p>The map overlay shows light pollution intensity using a 7-zone colour scale devised by David Lorenz, published in his <a href="https://djlorenz.github.io/astronomy/lp/" target="_blank" rel="noopener noreferrer">Light Pollution Atlas</a>.</p>
          <h3>Sky quality scale</h3>
          <ul className="zone-scale">
            <li><span className="zone-dot" style={{background:'#6a6a6a'}} />Zones 0–1 <span className="zone-label">Excellent</span></li>
            <li><span className="zone-dot" style={{background:'#2154D8'}} />Zone 2 <span className="zone-label">Very good</span></li>
            <li><span className="zone-dot" style={{background:'#1FA12A'}} />Zone 3 <span className="zone-label">Good</span></li>
            <li><span className="zone-dot" style={{background:'#B8A625'}} />Zone 4 <span className="zone-label">Fair</span></li>
            <li><span className="zone-dot" style={{background:'#FD9650'}} />Zone 5 <span className="zone-label">Poor</span></li>
            <li><span className="zone-dot" style={{background:'#FB5A49'}} />Zone 6 <span className="zone-label">Very poor</span></li>
            <li><span className="zone-dot" style={{background:'#C8C8C8'}} />Zone 7 <span className="zone-label">Severe</span></li>
          </ul>
          <h3>Understanding the metrics</h3>
          <dl className="metric-list">
            <dt>Zone</dt>
            <dd>The zone describes how much artificial light pollution is in the sky; each zone is 3x brighter than the previous zone. It's calculated using two metrics. </dd>
            <dt>Light Pollution Index (LPI)</dt>
            <dd>This is the ratio of artificial brightness to natural sky brightness. An LPI of 0 is pristine darkness, while 1 means artificial light equals natural light; a typical city is 30 or more.</dd>
            <dt>Sky quality (mag/arcsec²)</dt>
            <dd>Astronomers use this brightness scale where higher numbers mean darker skies — a natural, unpolluted sky measures ~22.0 mag/arcsec².</dd>
          </dl>
          <h3>Credits</h3>
          <p className="about-attribution">
           Map tiles © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors, © <a href="https://carto.com/" target="_blank" rel="noopener noreferrer">CARTO</a><br/>
             Big thank you to David Lorenz for publishing his research and data: <a href="https://djlorenz.github.io/astronomy/lp/" target="_blank" rel="noopener noreferrer">Light Pollution Atlas</a> (D. Lorenz) · VIIRS/EOG
          </p>
        </div>
      </div>
    </div>
  )
}

export default function App() {
  const [query, setQuery] = useState('')
  const [suggestions, setSuggestions] = useState([])
  const [infoCard, setInfoCard] = useState(null)
  const [opacity, setOpacity] = useState(defaultOpacity)
  const [opacityOpen, setOpacityOpen] = useState(false)
  const [aboutOpen, setAboutOpen] = useState(false)
  const [locating, setLocating] = useState(false)
  const [searchFocused, setSearchFocused] = useState(false)
  const [hasInteracted, setHasInteracted] = useState(false)
  const debounceRef = useRef(null)
  const inputRef = useRef(null)
  const searchPanelRef = useRef(null)
  const showPlaceholder = !searchFocused && query === ''
  const animating = showPlaceholder && !hasInteracted
  const placeholderSuffix = useTypingPlaceholder(animating)

  useEffect(() => { map.invalidateSize({ animate: false }) }, [])
  useEffect(() => { setLayerOpacity(opacity) }, [opacity])

  // Close desktop dropdown when clicking outside the search panel
  useEffect(() => {
    if (isMobile || !searchFocused) return
    function onDocClick(e) {
      if (!searchPanelRef.current?.contains(e.target)) {
        setSearchFocused(false)
      }
    }
    document.addEventListener('click', onDocClick)
    return () => document.removeEventListener('click', onDocClick)
  }, [searchFocused])

  function showInfo(card) {
    setInfoCard(card)
    setSuggestions([])
    setSearchFocused(false)
    setQuery('')
    clearTimeout(debounceRef.current)
  }

  function dismissSearch() {
    setSearchFocused(false)
    setQuery('')
    setSuggestions([])
    clearTimeout(debounceRef.current)
    inputRef.current?.blur()
  }

  function clearAll() {
    setQuery('')
    setSuggestions([])
    setInfoCard(null)
    setSearchFocused(false)
    clearTimeout(debounceRef.current)
    clearMarker()
    document.documentElement.style.setProperty('--sheet-h', '0px')
  }

  async function fetchSuggestions(q) {
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&limit=5`,
        { headers: { 'Accept-Language': 'en' } }
      )
      setSuggestions(await res.json())
    } catch {
      setSuggestions([])
    }
  }

  function handleQuery(value) {
    setQuery(value)
    clearTimeout(debounceRef.current)
    if (value.trim().length < 2) { setSuggestions([]); return }
    debounceRef.current = setTimeout(() => fetchSuggestions(value.trim()), 300)
  }

  async function handlePopularSelect(name) {
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(name)}&limit=1`,
        { headers: { 'Accept-Language': 'en' } }
      )
      const results = await res.json()
      if (results[0]) selectResult(results[0])
    } catch {
      // silently ignore — user can type to search manually
    }
  }

  async function selectResult(r) {
    const lat = parseFloat(r.lat)
    const lng = parseFloat(r.lon)
    setViewWithOffset(lat, lng, 8)
    placeMarker(lat, lng)
    const locationType = classifyLocation(r)
    if (locationType === 'region') {
      showInfo({ name: r.display_name, type: 'region' })
      return
    }
    showInfo({ name: r.display_name, type: 'loading' })
    try {
      const zone = await sampleLightLevel(lat, lng, DEFAULT_LAYER)
      showInfo({ name: r.display_name, type: 'zone', ...zone })
    } catch {
      showInfo({ name: r.display_name, type: 'error', message: 'Light level data unavailable.' })
    }
  }

  async function handleLocate() {
    setLocating(true)
    try {
      const { lat, lng } = await geolocate(map)
      setViewWithOffset(lat, lng, map.getZoom())
      placeMarker(lat, lng)

      let name = 'Your location'
      try {
        const res = await fetch(
          `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`,
          { headers: { 'Accept-Language': 'en' } }
        )
        const data = await res.json()
        if (data.display_name) name = data.display_name
      } catch {
        // fall back to generic name
      }

      showInfo({ name, type: 'loading' })
      try {
        const zone = await sampleLightLevel(lat, lng, DEFAULT_LAYER)
        showInfo({ name, type: 'zone', ...zone })
      } catch {
        showInfo({ name, type: 'error', message: 'Light level data unavailable.' })
      }
    } catch (err) {
      showInfo({ name: 'Location error', type: 'error', message: err.message })
    } finally {
      setLocating(false)
    }
  }

  function handleKeyDown(e) {
    if (e.key === 'Escape') dismissSearch()
  }

  const showPopular = searchFocused && query.trim().length < 2
  const showSuggestions = suggestions.length > 0
  const showDropdown = showPopular || showSuggestions

  const locateLi = (
    <li key="locate" className="locate-suggestion" onClick={handleLocate}>
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <polygon points="3 11 22 2 13 21 11 13 3 11"/>
      </svg>
      Use my location
    </li>
  )

  const listItems = showPopular
    ? POPULAR.map((name, i) => (
        <li key={i} onClick={() => handlePopularSelect(name)}>{name}</li>
      ))
    : suggestions.map((r, i) => (
        <li key={i} onClick={() => selectResult(r)}>{r.display_name}</li>
      ))

  const floatingControls = (
    <>
      {aboutOpen && <AboutModal onClose={() => setAboutOpen(false)} />}
      {opacityOpen && (
        <div id="opacity-wrap">
          <input type="range" id="opacity-slider" min="0" max="100"
            value={Math.round(opacity * 100)}
            onChange={e => setOpacity(Number(e.target.value) / 100)}
          />
        </div>
      )}
      <button id="opacity-btn" aria-label="Adjust opacity"
        className={opacityOpen ? 'active' : undefined}
        onClick={() => setOpacityOpen(o => !o)}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="4"/>
          <line x1="12" y1="2" x2="12" y2="4"/><line x1="12" y1="20" x2="12" y2="22"/>
          <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
          <line x1="2" y1="12" x2="4" y2="12"/><line x1="20" y1="12" x2="22" y2="12"/>
          <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
        </svg>
      </button>
      <button id="locate-btn" aria-label="Find my location"
        disabled={locating} className={locating ? 'active' : undefined}
        onClick={handleLocate}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polygon points="3 11 22 2 13 21 11 13 3 11"/>
        </svg>
      </button>
      <button id="about-btn" aria-label="About" onClick={() => setAboutOpen(o => !o)}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10"/>
          <path d="M9.5 9a2.5 2.5 0 0 1 5 0c0 1.5-1.5 1.8-2.3 2.5-.5.5-.7 1-.7 1.7"/>
          <circle cx="12" cy="17" r="0.6" fill="currentColor"/>
        </svg>
      </button>
    </>
  )

  if (isMobile) {
    return (
      <>
        {searchFocused && (
          <div id="search-backdrop" onClick={dismissSearch} />
        )}
        <div id="top-search" className={searchFocused ? 'focused' : undefined}>
          <div id="search-wrap">
            <button id="search-icon-btn" aria-label="Search">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
              </svg>
            </button>
            <div id="search-input-wrap">
              <input
                ref={inputRef}
                id="search-input"
                type="text"
                placeholder=""
                autoComplete="off"
                value={query}
                onChange={e => handleQuery(e.target.value)}
                onFocus={() => { setSearchFocused(true); setHasInteracted(true) }}
                onKeyDown={handleKeyDown}
              />
              {showPlaceholder && (
                <div id="search-placeholder" aria-hidden="true">
                  {`Search ${animating ? placeholderSuffix : 'DarkSky'}`}
                  {animating && <span className="ph-cursor" />}
                </div>
              )}
            </div>
            {searchFocused && (
              <button id="search-clear" aria-label="Close search" onClick={dismissSearch}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </button>
            )}
          </div>
          {showDropdown && (
            <div id="search-dropdown">
              {showPopular && <ul id="search-suggestions">{locateLi}</ul>}
              {showPopular && <p id="popular-label">Popular</p>}
              <ul id="search-suggestions">{listItems}</ul>
            </div>
          )}
        </div>
        {floatingControls}
        {infoCard && (
          <InfoModal infoCard={infoCard} onClose={clearAll}>
            <div id="info-body"><InfoBody card={infoCard} onOpenAbout={() => setAboutOpen(true)} /></div>
          </InfoModal>
        )}
      </>
    )
  }

  return (
    <>
      <div id="search-panel" ref={searchPanelRef}>
        <div id="search-wrap">
          <button id="search-icon-btn" aria-label="Search">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
          </button>
          <div id="search-input-wrap">
            <input
              ref={inputRef}
              id="search-input"
              type="text"
              placeholder=""
              autoComplete="off"
              value={query}
              onChange={e => handleQuery(e.target.value)}
              onFocus={() => { setSearchFocused(true); setHasInteracted(true) }}
              onKeyDown={handleKeyDown}
            />
            {showPlaceholder && (
              <div id="search-placeholder" aria-hidden="true">
                {`Search ${animating ? placeholderSuffix : 'DarkSky'}`}
                {animating && <span className="ph-cursor" />}
              </div>
            )}
          </div>
          {query && (
            <button id="search-clear" aria-label="Clear search" onClick={dismissSearch}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          )}
        </div>
        {showDropdown && (
          <>
            {showPopular && <ul id="search-suggestions">{locateLi}</ul>}
            {showPopular && <p id="popular-label">Popular</p>}
            <ul id="search-suggestions">{listItems}</ul>
          </>
        )}
      </div>
      {infoCard && (
        <div id="info-body">
          <InfoHeader name={infoCard.name} onClose={clearAll} />
          <InfoBody card={infoCard} onOpenAbout={() => setAboutOpen(true)} />
        </div>
      )}
      {floatingControls}
      <div id="zoom-controls">
        <button id="zoom-in" aria-label="Zoom in" onClick={() => map.zoomIn()}>+</button>
        <button id="zoom-out" aria-label="Zoom out" onClick={() => map.zoomOut()}>−</button>
      </div>
    </>
  )
}

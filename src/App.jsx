import { useState, useEffect, useRef } from 'react'
import { useSpring, animated } from '@react-spring/web'
import { useDrag } from '@use-gesture/react'
import { map, placeMarker, clearMarker, setLayerOpacity, defaultOpacity } from './map.js'
import { geolocate } from './geolocation.js'
import { sampleLightLevel, classifyLocation } from './lightLevel.js'
import { DEFAULT_LAYER } from './layers.js'

const isMobile = window.matchMedia('(max-width: 640px)').matches
const PEEK_PX = 88
const SPRING = { tension: 300, friction: 32 }

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

const getSnapYs = (vpH) => [vpH - PEEK_PX, vpH * 0.5, 0]

// On mobile, offset the view so the pin sits above the mid-snap sheet rather
// than behind it. Target: pin at 75% of the visible area (top 50% of screen)
// = 37.5% from screen top, vs. the default 50% map center.
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

function findSnap(y, vy, dy, snapYs) {
  if (Math.abs(vy) > 0.3) {
    if (dy > 0) {
      const above = snapYs.map((sy, i) => ({ sy, i })).filter(s => s.sy > y)
      if (above.length) return above.reduce((b, c) => c.sy < b.sy ? c : b).i
    } else {
      const below = snapYs.map((sy, i) => ({ sy, i })).filter(s => s.sy < y)
      if (below.length) return below.reduce((b, c) => c.sy > b.sy ? c : b).i
    }
  }
  return snapYs.reduce((b, sy, i) =>
    Math.abs(y - sy) < Math.abs(y - snapYs[b]) ? i : b, 0)
}

function parseLocationName(displayName) {
  const commaIdx = displayName.indexOf(',')
  if (commaIdx === -1) return { title: displayName, subtitle: '' }
  return {
    title: displayName.slice(0, commaIdx).trim(),
    subtitle: displayName.slice(commaIdx + 1).trim(),
  }
}

function BottomSheet({ snap, onSnap, onClose, infoCard, children }) {
  const sheetRef = useRef(null)
  const bodyRef = useRef(null)
  const vpHRef = useRef(window.visualViewport?.height ?? window.innerHeight)
  const snapRef = useRef(snap)
  snapRef.current = snap

  const [{ y }, api] = useSpring(() => {
    const vpH = window.visualViewport?.height ?? window.innerHeight
    vpHRef.current = vpH
    const snapYs = getSnapYs(vpH)
    return {
      from: { y: snapYs[0] },
      to: { y: snapYs[1] },
      config: SPRING,
      onChange: ({ value: { y: yVal } }) =>
        document.documentElement.style.setProperty('--sheet-h', `${vpHRef.current - yVal}px`),
    }
  })

  useEffect(() => {
    const vp = window.visualViewport
    if (!vp) return
    const update = () => {
      vpHRef.current = vp.height
      const sheet = sheetRef.current
      if (sheet) {
        sheet.style.top = `${vp.offsetTop}px`
        sheet.style.height = `${vp.height}px`
      }
      const newY = getSnapYs(vp.height)[snapRef.current]
      api.set({ y: newY })
      document.documentElement.style.setProperty('--sheet-h', `${vp.height - newY}px`)
    }
    vp.addEventListener('resize', update)
    vp.addEventListener('scroll', update)
    update()
    return () => {
      vp.removeEventListener('resize', update)
      vp.removeEventListener('scroll', update)
    }
  }, [api])

  useEffect(() => {
    api.start({ y: getSnapYs(vpHRef.current)[snap], config: SPRING })
  }, [snap, api])

  useDrag(({ cancel, active, first, offset: [, oy], velocity: [, vy], direction: [, dy], event }) => {
    if (first) {
      const inBody = bodyRef.current?.contains(event.target)
      const scrollTop = bodyRef.current?.scrollTop ?? 0
      if (inBody && (scrollTop > 0 || dy < 0)) {
        cancel()
        return
      }
    }
    if (active) {
      api.start({ y: oy, immediate: true })
    } else {
      const snapYs = getSnapYs(vpHRef.current)
      const targetIdx = findSnap(oy, vy, dy, snapYs)
      api.start({ y: snapYs[targetIdx], config: SPRING })
      onSnap(targetIdx)
    }
  }, {
    target: sheetRef,
    from: () => [0, y.get()],
    bounds: () => ({ top: 0, bottom: getSnapYs(vpHRef.current)[0] }),
    rubberband: 0.15,
    axis: 'y',
    filterTaps: true,
    threshold: 8,
  })

  const { title, subtitle } = parseLocationName(infoCard.name)

  return (
    <animated.div
      ref={sheetRef}
      id="sheet"
      style={{ transform: y.to(v => `translateY(${v}px)`) }}
    >
      <div id="sheet-handle-area">
        <div id="sheet-handle" />
      </div>
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
      <div ref={bodyRef} id="sheet-body">
        {children}
      </div>
    </animated.div>
  )
}

function InfoBody({ card }) {
  if (!card) return null
  if (card.type === 'loading') return <p className="info-loading">Sampling light level…</p>
  if (card.type === 'region') return <p className="info-note">Light levels may vary across this region.</p>
  if (card.type === 'error') return <p className="info-note">{card.message}</p>
  if (card.type === 'zone') return (
    <>
      <div className="info-row"><span className="info-label">Zone</span><span className="info-value">{card.zone}</span></div>
      <div className="info-row"><span className="info-label">LPI</span><span className="info-value">{card.lpiRange}</span></div>
      <div className="info-row"><span className="info-label">Sky quality</span><span className="info-value">{card.sqm} mag/arcsec²</span></div>
    </>
  )
  if (card.type === 'location') return (
    <>
      <div className="info-row"><span className="info-label">Lat</span><span className="info-value">{card.lat.toFixed(4)}°</span></div>
      <div className="info-row"><span className="info-label">Lng</span><span className="info-value">{card.lng.toFixed(4)}°</span></div>
    </>
  )
  return null
}

export default function App() {
  const [query, setQuery] = useState('')
  const [suggestions, setSuggestions] = useState([])
  const [infoCard, setInfoCard] = useState(null)
  const [opacity, setOpacity] = useState(defaultOpacity)
  const [opacityOpen, setOpacityOpen] = useState(false)
  const [locating, setLocating] = useState(false)
  const [snap, setSnap] = useState(1)
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
    if (isMobile) setSnap(1)
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
      showInfo({ name: 'Your location', type: 'location', lat, lng })
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

  const listItems = showPopular
    ? POPULAR.map((name, i) => (
        <li key={i} onClick={() => handlePopularSelect(name)}>{name}</li>
      ))
    : suggestions.map((r, i) => (
        <li key={i} onClick={() => selectResult(r)}>{r.display_name}</li>
      ))

  const floatingControls = (
    <>
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
              {showPopular && <p id="popular-label">Popular</p>}
              <ul id="search-suggestions">{listItems}</ul>
            </div>
          )}
        </div>
        {floatingControls}
        {infoCard && (
          <BottomSheet snap={snap} onSnap={setSnap} onClose={clearAll} infoCard={infoCard}>
            <div id="info-body"><InfoBody card={infoCard} /></div>
          </BottomSheet>
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
                Search <span>{placeholderSuffix}</span><span className="ph-cursor" />
              </div>
            )}
          </div>
          {(query || infoCard) && (
            <button id="search-clear" aria-label="Clear" onClick={clearAll}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          )}
        </div>
        {showDropdown && (
          <>
            {showPopular && <p id="popular-label">Popular</p>}
            <ul id="search-suggestions">{listItems}</ul>
          </>
        )}
        {infoCard && <div id="info-body"><InfoBody card={infoCard} /></div>}
      </div>
      {floatingControls}
      <div id="zoom-controls">
        <button id="zoom-in" aria-label="Zoom in" onClick={() => map.zoomIn()}>+</button>
        <button id="zoom-out" aria-label="Zoom out" onClick={() => map.zoomOut()}>−</button>
      </div>
    </>
  )
}

export function setupGeolocation(map, onLocate) {
  const btn = document.getElementById('locate-btn')
  const info = document.getElementById('location-info')

  btn.addEventListener('click', () => {
    if (!navigator.geolocation) {
      info.textContent = 'Geolocation not supported by your browser.'
      return
    }

    btn.disabled = true
    btn.textContent = 'Locating...'

    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        const { latitude, longitude } = coords
        map.setView([latitude, longitude], 8)
        btn.textContent = 'Find My Location'
        btn.disabled = false
        info.textContent = `${latitude.toFixed(4)}°, ${longitude.toFixed(4)}°`
        onLocate(latitude, longitude)
      },
      (error) => {
        btn.textContent = 'Find My Location'
        btn.disabled = false
        const messages = {
          1: 'Location access denied.',
          2: 'Position unavailable.',
          3: 'Location request timed out.',
        }
        info.textContent = messages[error.code] ?? 'Location error.'
      },
      { timeout: 10000, maximumAge: 60000 }
    )
  })
}

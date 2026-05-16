export function setupGeolocation(map, onLocate, onError) {
  const btn = document.getElementById('locate-btn')

  btn.addEventListener('click', () => {
    if (!navigator.geolocation) {
      onError('Geolocation not supported by your browser.')
      return
    }

    btn.disabled = true
    btn.classList.add('active')

    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        const { latitude, longitude } = coords
        map.setView([latitude, longitude], 8)
        btn.disabled = false
        btn.classList.remove('active')
        onLocate(latitude, longitude)
      },
      (error) => {
        btn.disabled = false
        btn.classList.remove('active')
        const messages = {
          1: 'Location access denied.',
          2: 'Position unavailable.',
          3: 'Location request timed out.',
        }
        onError(messages[error.code] ?? 'Location error.')
      },
      { timeout: 10000, maximumAge: 60000 }
    )
  })
}

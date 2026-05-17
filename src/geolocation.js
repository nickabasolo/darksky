export async function geolocate(map) {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Geolocation not supported by your browser.'))
      return
    }
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        const { latitude: lat, longitude: lng } = coords
        map.setView([lat, lng], 8)
        resolve({ lat, lng })
      },
      (error) => {
        const messages = {
          1: 'Location access denied.',
          2: 'Position unavailable.',
          3: 'Location request timed out.',
        }
        reject(new Error(messages[error.code] ?? 'Location error.'))
      },
      { timeout: 10000, maximumAge: 60000 }
    )
  })
}

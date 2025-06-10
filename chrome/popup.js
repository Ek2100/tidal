let currentTrackData = null
let isReportingPaused = false
let refreshInterval = null

// UI Elements
const authSection = document.getElementById("auth-section")
const mainContent = document.getElementById("main-content")
const authTokenInput = document.getElementById("authTokenInput")
const saveAuthTokenBtn = document.getElementById("saveAuthTokenBtn")
const authError = document.getElementById("auth-error")

// Update UI with track data
function updateUI(trackData) {
  const trackInfo = document.getElementById("trackInfo")
  const noTrack = document.getElementById("noTrack")
  const statusDot = document.getElementById("statusDot")
  const statusText = document.getElementById("statusText")

  if (trackData && trackData.title && trackData.title !== "No Track Playing") {
    trackInfo.style.display = "block"
    noTrack.style.display = "none"

    document.getElementById("trackTitle").textContent = trackData.title
    document.getElementById("trackArtist").textContent = trackData.artist
    document.getElementById("trackStatus").textContent = trackData.isPlaying ? "Playing" : "Paused"

    const playIndicator = document.getElementById("playIndicator")
    playIndicator.className = trackData.isPlaying ? "play-indicator" : "play-indicator paused"

    const playIcon = document.getElementById("playIcon")
    const pauseIcon = document.getElementById("pauseIcon")
    const playPauseText = document.getElementById("playPauseText")

    if (trackData.isPlaying) {
      playIcon.style.display = "none"
      pauseIcon.style.display = "block"
      playPauseText.textContent = "Pause"
    } else {
      playIcon.style.display = "block"
      pauseIcon.style.display = "none"
      playPauseText.textContent = "Play"
    }

    const likeBtn = document.getElementById("likeBtn")
    likeBtn.className = trackData.isLiked ? "toggle-btn active" : "toggle-btn"
    likeBtn.textContent = trackData.isLiked ? "♥ Liked" : "♡ Like"

    const shuffleBtn = document.getElementById("shuffleBtn")
    shuffleBtn.className = trackData.isShuffled ? "toggle-btn active" : "toggle-btn"

    statusDot.className = "status-dot"
    statusText.textContent = "Connected"
  } else {
    trackInfo.style.display = "none"
    noTrack.style.display = "block"
    statusDot.className = "status-dot"
    statusText.textContent = "Connected"
  }

  currentTrackData = trackData
}

// Update connection status
function updateConnectionStatus(connected) {
  const statusDot = document.getElementById("statusDot")
  const statusText = document.getElementById("statusText")

  if (connected) {
    statusDot.className = "status-dot"
    statusText.textContent = "Connected"
  } else {
    statusDot.className = "status-dot disconnected"
    statusText.textContent = "Disconnected"
  }
}

// Send command to content script
async function sendCommand(action) {
  try {
    const tabs = await window.chrome.tabs.query({ url: "*://*.tidal.com/*" })
    if (tabs.length > 0) {
      await window.chrome.tabs.sendMessage(tabs[0].id, {
        type: "EXECUTE_ACTION",
        action: action,
      })
    }
  } catch (error) {
    console.error("Command failed:", error)
  }
}

// Load current data
function loadData() {
  window.chrome.runtime.sendMessage({ type: "GET_CURRENT_TRACK" }, (response) => {
    if (window.chrome.runtime.lastError) {
      console.error(window.chrome.runtime.lastError.message)
      updateConnectionStatus(false)
      return
    }
    if (response && response.success && response.trackData) {
      updateUI(response.trackData)
      updateConnectionStatus(true)
    } else {
      updateConnectionStatus(false)
    }
  })
}

// Toggle reporting
function toggleReporting() {
  isReportingPaused = !isReportingPaused
  const reportingBtn = document.getElementById("reportingBtn")

  if (isReportingPaused) {
    reportingBtn.className = "toggle-btn"
    reportingBtn.textContent = "📴 Paused"
    window.chrome.runtime.sendMessage({ type: "PAUSE_REPORTING", paused: true })
  } else {
    reportingBtn.className = "toggle-btn active"
    reportingBtn.textContent = "📡 Reporting"
    window.chrome.runtime.sendMessage({ type: "PAUSE_REPORTING", paused: false })
  }
}

function showMainContent() {
  authSection.style.display = "none"
  mainContent.style.display = "block"
  loadData()

  if (refreshInterval) clearInterval(refreshInterval)
  refreshInterval = setInterval(loadData, 2000)
}

function showAuthSection() {
  mainContent.style.display = "none"
  authSection.style.display = "block"
  if (refreshInterval) clearInterval(refreshInterval)
}

document.getElementById('showAuthBtn').addEventListener('click', showAuthSection);

// Initialize popup
document.addEventListener("DOMContentLoaded", () => {
  // Check for auth token first
  window.chrome.storage.local.get(["localApiAuthToken"], (result) => {
    if (result.localApiAuthToken) {
      showMainContent()
    } else {
      showAuthSection()
    }
  })

  // Save Auth Token
  saveAuthTokenBtn.addEventListener("click", () => {
    const token = authTokenInput.value.trim()
    if (token) {
      window.chrome.storage.local.set({ localApiAuthToken: token }, () => {
        console.log("Auth token saved.")
        authError.style.display = "none"
        showMainContent()
      })
    } else {
      authError.textContent = "Token cannot be empty."
      authError.style.display = "block"
    }
  })

  // Control buttons
  document.getElementById("playPauseBtn").addEventListener("click", () => {
    const action = currentTrackData?.isPlaying ? "pause" : "play"
    sendCommand(action)
    if (currentTrackData) {
      currentTrackData.isPlaying = !currentTrackData.isPlaying
      updateUI(currentTrackData)
    }
  })

  document.getElementById("prevBtn").addEventListener("click", () => sendCommand("previous"))
  document.getElementById("nextBtn").addEventListener("click", () => sendCommand("next"))
  document.getElementById("likeBtn").addEventListener("click", () => sendCommand("toggleLike"))
  document.getElementById("shuffleBtn").addEventListener("click", () => sendCommand("toggleShuffle"))
  document.getElementById("reportingBtn").addEventListener("click", toggleReporting)
})

// Listen for updates from background
window.chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "TRACK_DATA_UPDATE") {
    updateUI(message.data)
    updateConnectionStatus(true)
  }
})
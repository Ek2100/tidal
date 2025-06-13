let currentTrackData = null
let isUpdatingTrack = false
let lastTrackUpdateTime = 0
let commandCheckInterval = null
let isReportingPaused = false
let cachedPlaylists = []

const API_BASE_URL = "http://localhost:3049"
const COMMAND_CHECK_INTERVAL = 1000
const TRACK_UPDATE_DEBOUNCE = 1000
const PAUSED_UPDATE_DEBOUNCE = 3000
const STALE_DATA_TIMEOUT = 10 * 60 * 1000

function log(message, type = "info") {
  const timestamp = new Date().toLocaleTimeString()
  console.log(`[${timestamp}] ${message}`)
}

async function getAuthToken() {
  return new Promise((resolve) => {
    chrome.storage.local.get(["localApiAuthToken"], (result) => {
      resolve(result.localApiAuthToken || null)
    })
  })
}

async function sendTrackDataToAPI(data) {
  const token = await getAuthToken()
  if (!token) {
    log("Auth token not set in Chrome extension. Skipping API call.", "warn")
    return false
  }

  if (isUpdatingTrack || isReportingPaused) {
    return false
  }

  const now = Date.now()
  const stateAge = data.lastStateChangeTime ? now - data.lastStateChangeTime : 0
  const isStale = !data.isPlaying && stateAge > STALE_DATA_TIMEOUT

  if (isStale) {
    log(`Skipping stale data (paused for ${Math.floor(stateAge / 60000)} minutes)`)
    return false
  }

  try {
    isUpdatingTrack = true

    const dataWithTimestamp = {
      ...data,
      timestamp: now,
      lastWrite: now,
      state: data.isPlaying ? "PLAYING" : "PAUSED",
      stateAge: stateAge,
    }

    log(`Sending track data: ${data.title} - ${data.artist} (${data.isPlaying ? "Playing" : "Paused"})`)

    const response = await fetch(`${API_BASE_URL}/track-data`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(dataWithTimestamp),
    })

    if (!response.ok) {
      throw new Error(`API request failed: ${response.status} ${response.statusText}`)
    }

    const result = await response.json()
    lastTrackUpdateTime = now
    log(`Track data sent successfully: ${result.message}`)

    chrome.runtime
      .sendMessage({
        type: "TRACK_DATA_UPDATE",
        data: dataWithTimestamp,
      })
      .catch(() => {})

    return true
  } catch (error) {
    log(`API request error: ${error.message}`)
    return false
  } finally {
    isUpdatingTrack = false
  }
}

async function checkForCommandsFromAPI() {
  const token = await getAuthToken()
  if (!token) {
    return
  }

  try {
    const response = await fetch(`${API_BASE_URL}/get-command`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
    })

    if (!response.ok) {
      throw new Error(`API request failed: ${response.status} ${response.statusText}`)
    }

    const result = await response.json()

    if (result.status === "no-commands") {
      return
    }

    if (result.action) {
      log(`Received command from API: ${result.action}`)

      const age = Date.now() - (result.timestamp || 0)
      if (age > 30000) {
        log(`Skipping old command: ${result.action}`)
        return
      }

      const tabs = await chrome.tabs.query({ url: "*://*.tidal.com/*" })
      if (tabs.length > 0) {
        try {
          await chrome.tabs.sendMessage(tabs[0].id, {
            type: "EXECUTE_ACTION",
            action: result.action,
            params: result.params || {},
          })
          log(`Command executed successfully: ${result.action}`)
        } catch (error) {
          log(`Command execution failed: ${error.message}`)
        }
      } else {
        log("No Tidal tabs found for command execution")
      }
    }
  } catch (error) {
    // get out
  }
}

function startCommandChecking() {
  if (commandCheckInterval) {
    clearInterval(commandCheckInterval)
  }
  commandCheckInterval = setInterval(checkForCommandsFromAPI, COMMAND_CHECK_INTERVAL)
  log("Started command checking loop")
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "PING") {
    sendResponse({ success: true, timestamp: Date.now() })
    return true
  }

  if (message.type === "TRACK_UPDATE") {
    currentTrackData = message.data

    const now = Date.now()
    const isPlaying = message.data && message.data.isPlaying

    const debounceTime = isPlaying ? TRACK_UPDATE_DEBOUNCE : PAUSED_UPDATE_DEBOUNCE

    if (now - lastTrackUpdateTime < debounceTime) {
      sendResponse({ success: true, debounced: true })
      return true
    }

    sendTrackDataToAPI(currentTrackData).then((success) => {
      sendResponse({ success })
    })
    return true
  }

  if (message.type === "GET_CURRENT_TRACK") {
    sendResponse({
      success: true,
      trackData: currentTrackData,
    })
  }

  if (message.type === "PAUSE_REPORTING") {
    isReportingPaused = message.paused
    log(`Reporting ${isReportingPaused ? "paused" : "resumed"}`)
    sendResponse({ success: true })
  }

  if (message.type === "PLAYLISTS_DATA") {
    cachedPlaylists = message.playlists
    log(`Cached ${cachedPlaylists.length} playlists`)
    sendResponse({ success: true })
  }

  if (message.type === "GET_PLAYLISTS") {
    sendResponse({
      success: true,
      playlists: cachedPlaylists,
    })
  }
})

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete" && tab.url && tab.url.includes("tidal.com")) {
    log(`Tidal tab updated: ${tab.url}`)
    setTimeout(() => {
      chrome.tabs.sendMessage(tabId, { type: "GET_INITIAL_DATA" }).catch(() => {
        log(`Could not contact newly loaded tab ${tabId}`)
      })
    }, 2000)
  }
})

chrome.runtime.onStartup.addListener(() => {
  log("Extension started")
  initialize()
})

chrome.runtime.onInstalled.addListener(() => {
  log("Extension installed/updated")
  initialize()
})

async function initialize() {
  log("Initializing background script...")
  log(`API server URL: ${API_BASE_URL}`)

  await chrome.storage.local.clear()

  try {
    const tabs = await chrome.tabs.query({ url: "*://*.tidal.com/*" })
    log(`Found ${tabs.length} Tidal tabs`)

    for (const tab of tabs) {
      try {
        await chrome.tabs.sendMessage(tab.id, { type: "GET_INITIAL_DATA" })
        log(`Requested initial data from tab ${tab.id}`)
      } catch (error) {
        log(`Could not contact tab ${tab.id}: ${error.message}`)
      }
    }
  } catch (error) {
    log(`Error checking Tidal tabs: ${error.message}`)
  }

  startCommandChecking()
}

chrome.runtime.onSuspend.addListener(() => {
  log("Extension suspending, cleaning up...")
  if (commandCheckInterval) {
    clearInterval(commandCheckInterval)
  }
})

initialize()

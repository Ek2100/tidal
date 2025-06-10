;(() => {
  if (window.tidalControllerInjected) {
    console.log("[Tidal Content] Already injected, skipping")
    return
  }
  window.tidalControllerInjected = true

  let lastTrackData = null
  let monitoringInterval = null
  let isMonitoring = false
  let extensionContextValid = true
  let messageListenerSetup = false
  let chrome

  const MONITOR_INTERVAL = 1500 
  const FORCE_UPDATE_INTERVAL = 3000 
  const STALE_DATA_TIMEOUT = 10 * 60 * 1000 
  const MAX_RETRIES = 3
  let retryCount = 0
  let forceUpdateInterval = null
  let lastPlayingState = null
  let lastStateChangeTime = Date.now()

  const COMMAND_MAP = {
    play: () => {
      const trackData = getTidalData()
      const isCurrentlyPlaying = trackData ? trackData.isPlaying : false

      log(`Play command - currently playing: ${isCurrentlyPlaying}`)

      if (isCurrentlyPlaying) {
        log("Already playing, ignoring play command")
        return true
      }

      const playSelectors = [
        'button[data-test="play"][aria-label="Play"]',
        'button[data-test="play"]',
        '[data-test="play-controls"] button[data-test="play"]',
        '.playbackControls button[data-test="play"]',
        'button[aria-label="Play"][data-test="play"]',
      ]

      for (const selector of playSelectors) {
        const button = document.querySelector(selector)
        if (button && button.offsetParent !== null && !button.disabled) {
          log(`Found play button with selector: ${selector}`)
          log(
            `Button attributes: data-test="${button.getAttribute("data-test")}", aria-label="${button.getAttribute("aria-label")}", data-type="${button.getAttribute("data-type")}"`,
          )

          createEdgeLightingEffect()
          button.click()
          log(`Successfully clicked play button: ${selector}`)
          return true
        } else if (button) {
          log(
            `Play button found but not clickable: ${selector}, offsetParent: ${button.offsetParent}, disabled: ${button.disabled}`,
          )
        }
      }

      log(`No clickable play button found. Tried selectors: ${playSelectors.join(", ")}`)
      return false
    },

    pause: () => {
      const pauseSelectors = [
        'button[data-test="pause"][aria-label="Pause"]',
        'button[data-test="pause"]',
        '[data-test="play-controls"] button[data-test="pause"]',
        '.playbackControls button[data-test="pause"]',
        'button[aria-label="Pause"][data-test="pause"]',
      ]

      for (const selector of pauseSelectors) {
        const button = document.querySelector(selector)
        if (button && button.offsetParent !== null && !button.disabled) {
          log(`Found pause button with selector: ${selector}`)
          createEdgeLightingEffect()
          button.click()
          log(`Successfully clicked pause button: ${selector}`)
          return true
        }
      }

      log(`No clickable pause button found. Tried selectors: ${pauseSelectors.join(", ")}`)
      return false
    },

    next: () =>
      clickButtonWithFallbacks(['[data-test="next"]', '[aria-label="Next"]', 'button[data-type="button__skip-next"]']),
    previous: () =>
      clickButtonWithFallbacks([
        '[data-test="previous"]',
        '[aria-label="Previous"]',
        'button[data-type="button__skip-previous"]',
      ]),
    toggleLike: () => clickButtonWithFallbacks(['[data-test="footer-favorite-button"]', '[aria-label*="Collection"]']),
    toggleShuffle: () => clickButtonWithFallbacks(['[data-test="shuffle"]', '[aria-label="Shuffle"]']),
    toggleRepeat: () =>
      clickButtonWithFallbacks(['[data-test="repeat"]', '[aria-label="Repeat"]', 'button[data-type*="repeat"]']),
  }

  function debugPlayPauseButtons() {
    log("=== DEBUG: All play/pause buttons ===")

    const allButtons = document.querySelectorAll("button")
    const playPauseButtons = []

    allButtons.forEach((button, index) => {
      const dataTest = button.getAttribute("data-test")
      const ariaLabel = button.getAttribute("aria-label")
      const dataType = button.getAttribute("data-type")

      if (
        dataTest === "play" ||
        dataTest === "pause" ||
        ariaLabel === "Play" ||
        ariaLabel === "Pause" ||
        dataType?.includes("play") ||
        dataType?.includes("pause")
      ) {
        playPauseButtons.push({
          index,
          dataTest,
          ariaLabel,
          dataType,
          visible: button.offsetParent !== null,
          disabled: button.disabled,
          selector:
            button.tagName.toLowerCase() +
            (button.id ? `#${button.id}` : "") +
            (button.className ? `.${button.className.split(" ").join(".")}` : "") +
            (dataTest ? `[data-test="${dataTest}"]` : "") +
            (ariaLabel ? `[aria-label="${ariaLabel}"]` : ""),
        })
      }
    })

    log(`Found ${playPauseButtons.length} play/pause buttons:`)
    playPauseButtons.forEach((btn, i) => {
      log(
        `  ${i + 1}. data-test="${btn.dataTest}", aria-label="${btn.ariaLabel}", data-type="${btn.dataType}", visible=${btn.visible}, disabled=${btn.disabled}`,
      )
    })

    return playPauseButtons
  }

  function log(message, type = "info") {
    const timestamp = new Date().toLocaleTimeString()
    const logMessage = `[Tidal Content] [${timestamp}] ${message}`
    console.log(logMessage)

    if (extensionContextValid && typeof window.chrome !== "undefined" && window.chrome.runtime) {
      chrome = window.chrome
      try {
        chrome.runtime
          .sendMessage({
            type: "LOG_MESSAGE",
            message: `[Content] ${message}`,
            logType: type,
            timestamp: timestamp,
          })
          .catch((error) => {
            extensionContextValid = false
          })
      } catch (error) {
        extensionContextValid = false
      }
    }
  }

  function testExtensionConnection() {
    return new Promise((resolve) => {
      if (typeof window.chrome === "undefined" || !window.chrome.runtime) {
        resolve(false)
        return
      }

      try {
        window.chrome.runtime.sendMessage({ type: "PING" }, (response) => {
          if (window.chrome.runtime.lastError) {
            extensionContextValid = false
            resolve(false)
          } else {
            extensionContextValid = true
            resolve(true)
          }
        })
      } catch (error) {
        extensionContextValid = false
        resolve(false)
      }
    })
  }

  function clickButtonWithFallbacks(selectors) {
    for (const selector of selectors) {
      const button = document.querySelector(selector)
      if (button && button.offsetParent !== null && !button.disabled) {
        createEdgeLightingEffect()
        button.click()
        log(`Successfully clicked button: ${selector}`)
        return true
      }
    }
    log(`No clickable button found for: ${selectors.join(", ")}`, "warn")
    return false
  }

  function findPlayPauseButton(isCurrentlyPlaying) {
    const footerPlayer =
      document.querySelector('[data-test="footer-player"]') || document.querySelector('[id="footerPlayer"]')

    if (!footerPlayer) {
      log("Footer player not found for play/pause detection", "warn")
      return null
    }

    const playPauseSelectors = [
      '[data-test="footer-player"] button[data-test="play"]',
      '[data-test="footer-player"] button[data-test="pause"]',
      '[data-test="footer-player"] button[aria-label="Play"]',
      '[data-test="footer-player"] button[aria-label="Pause"]',
      '.player-controls button[data-test="play"]',
      '.player-controls button[data-test="pause"]',
      'button[data-type*="play"]:not([data-test*="track"]):not([data-test*="album"])',
      'button[data-type*="pause"]:not([data-test*="track"]):not([data-test*="album"])',
    ]

    for (const selector of playPauseSelectors) {
      const button = footerPlayer.querySelector(selector) || document.querySelector(selector)
      if (button && button.offsetParent !== null && !button.disabled) {
        const buttonText = button.textContent?.toLowerCase() || ""
        const ariaLabel = button.getAttribute("aria-label")?.toLowerCase() || ""

        if (
          buttonText.includes("play track") ||
          buttonText.includes("play album") ||
          ariaLabel.includes("play track") ||
          ariaLabel.includes("play album")
        ) {
          continue
        }

        log(`Found play/pause button: ${selector}`)
        return button
      }
    }

    return null
  }

function createEdgeLightingEffect(targetElement) {
    if (!targetElement) {
        targetElement = document.getElementById('footerPlayer') || document.querySelector('[data-test="footer-player"]');
    }
    
    if (!targetElement) {
        console.warn('Target element not found');
        return;
    }

    const existingEffect = document.getElementById("edge-lighting-effect")
    if (existingEffect) existingEffect.remove()

    const rect = targetElement.getBoundingClientRect()
    const scrollX = window.pageXOffset || document.documentElement.scrollLeft
    const scrollY = window.pageYOffset || document.documentElement.scrollTop

    const svgContainer = document.createElement("div")
    svgContainer.id = "edge-lighting-effect"
    svgContainer.style.cssText = `
      position: absolute;
      top: ${rect.top + scrollY}px;
      left: ${rect.left + scrollX}px;
      width: ${rect.width}px;
      height: ${rect.height}px;
      pointer-events: none;
      z-index: 999999;
      overflow: visible;
    `

    const w = rect.width
    const h = rect.height

    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg")
    svg.setAttribute("width", "100%")
    svg.setAttribute("height", "100%")
    svg.setAttribute("viewBox", `0 0 ${w} ${h}`)

    const path = document.createElementNS("http://www.w3.org/2000/svg", "path")
    
    const inset = 4 
    const innerRadius = 8  

    const x1 = inset
    const y1 = inset
    const x2 = w - inset
    const y2 = h - inset

    const pathData = `
      M ${x1 + innerRadius} ${y1}
      L ${x2 - innerRadius} ${y1}
      Q ${x2} ${y1}, ${x2} ${y1 + innerRadius}
      L ${x2} ${y2 - innerRadius}
      Q ${x2} ${y2}, ${x2 - innerRadius} ${y2}
      L ${x1 + innerRadius} ${y2}
      Q ${x1} ${y2}, ${x1} ${y2 - innerRadius}
      L ${x1} ${y1 + innerRadius}
      Q ${x1} ${y1}, ${x1 + innerRadius} ${y1}
      Z
    `

    path.setAttribute("d", pathData)
    path.setAttribute("fill", "none")
    path.setAttribute("stroke", "rgba(0, 170, 255, 0.9)")
    path.setAttribute("stroke-width", "2")
    path.setAttribute("stroke-linecap", "round")
    path.setAttribute("stroke-linejoin", "round")

    const filter = document.createElementNS("http://www.w3.org/2000/svg", "filter")
    filter.setAttribute("id", "glow")
    filter.setAttribute("x", "-50%")
    filter.setAttribute("y", "-50%")
    filter.setAttribute("width", "200%")
    filter.setAttribute("height", "200%")

    const feGaussianBlur = document.createElementNS("http://www.w3.org/2000/svg", "feGaussianBlur")
    feGaussianBlur.setAttribute("stdDeviation", "4")
    feGaussianBlur.setAttribute("result", "blur")

    const feComposite = document.createElementNS("http://www.w3.org/2000/svg", "feComposite")
    feComposite.setAttribute("in", "SourceGraphic")
    feComposite.setAttribute("in2", "blur")
    feComposite.setAttribute("operator", "over")

    filter.appendChild(feGaussianBlur)
    filter.appendChild(feComposite)
    svg.appendChild(filter)

    path.setAttribute("filter", "url(#glow)")

    const pathLength = path.getTotalLength() || 2 * (w + h)
    path.setAttribute("stroke-dasharray", pathLength)
    path.setAttribute("stroke-dashoffset", pathLength)
    path.style.transition = "none"
    path.style.strokeDashoffset = pathLength.toString()

    svg.appendChild(path)
    svgContainer.appendChild(svg)
    document.body.appendChild(svgContainer)

    void svgContainer.offsetWidth

    path.style.transition = `stroke-dashoffset 0.4s cubic-bezier(0.215, 0.61, 0.355, 1)`
    path.style.strokeDashoffset = "0"

    setTimeout(() => {
      path.style.transition = `stroke-width 0.15s ease-in-out, filter 0.15s ease-in-out`
      path.style.strokeWidth = "3"
      path.setAttribute("stroke", "rgba(0, 170, 255, 1)")
      feGaussianBlur.setAttribute("stdDeviation", "6")
    }, 400)

    setTimeout(() => {
      path.style.strokeWidth = "2"
      path.setAttribute("stroke", "rgba(0, 170, 255, 0.9)")
      feGaussianBlur.setAttribute("stdDeviation", "4")
    }, 550)

    setTimeout(() => {
      path.style.transition = `stroke-dashoffset 0.4s cubic-bezier(0.55, 0.055, 0.675, 0.19)`
      path.style.strokeDashoffset = (-pathLength).toString()
    }, 700)

    setTimeout(() => {
      if (svgContainer.parentNode) {
        svgContainer.remove()
      }
    }, 1200)
}

  function getTidalData() {
    const now = Date.now()

    try {
      if (!window.location.href.includes("tidal.com")) {
        return null
      }

      if (document.readyState !== "complete") {
        return null
      }

      const footerPlayer =
        document.querySelector('[data-test="footer-player"]') || document.querySelector('[id="footerPlayer"]')

      if (!footerPlayer) {
        return null
      }

      const playbackState = footerPlayer.getAttribute("data-test-playback-state")
      const pauseButton =
        document.querySelector('[data-test="pause"]') || document.querySelector('[aria-label="Pause"]')
      const playButton = document.querySelector('[data-test="play"]') || document.querySelector('[aria-label="Play"]')

      const isPlaying =
        playbackState === "PLAYING" ||
        (pauseButton && pauseButton.offsetParent !== null) ||
        (playButton && playButton.offsetParent === null)

      if (lastPlayingState !== isPlaying) {
        log(`Play state changed: ${lastPlayingState} -> ${isPlaying}`)
        lastPlayingState = isPlaying
        lastStateChangeTime = now
      }

      const titleSelectors = [
        '[data-test="footer-track-title"] .wave-text-description-demi',
        '[data-test="footer-track-title"] a span[data-wave-color="textDefault"]',
        '[data-test="footer-track-title"] span[data-wave-color="textDefault"]',
        '[data-test="footer-track-title"] span',
        ".wave-text-description-demi",
      ]

      const artistSelectors = [
        '.artist-link a[data-test="grid-item-detail-text-title-artist"]',
        ".artist-link a[aria-label]",
        ".artist-link a",
        '[data-test="grid-item-detail-text-title-artist"]',
        "._currentMediaItemDetails_dc0f159 .tidal-ui__text a",
        "._descriptionText_f6de630 .artist-link a",
        '[data-test="footer-track-title"] ~ div a',
      ]

      let titleElement = null
      let artistElement = null

      for (const selector of titleSelectors) {
        try {
          titleElement = document.querySelector(selector)
          if (titleElement && titleElement.textContent?.trim()) {
            break
          }
        } catch (e) {
          // Get out
        }
      }

      for (const selector of artistSelectors) {
        try {
          artistElement = document.querySelector(selector)
          if (artistElement && artistElement.textContent?.trim()) {
            break
          }
        } catch (e) {
          // Get out
        }
      }

      if (!titleElement || !artistElement) {
        return null
      }

      const title = titleElement.textContent?.trim()
      const artist = artistElement.textContent?.trim()

      if (!title || !artist || title === "Unknown" || artist === "Unknown") {
        return null
      }

      const currentTimeEl = document.querySelector('[data-test="current-time"]')
      const durationEl = document.querySelector('[data-test="duration"]')
      const currentTime = currentTimeEl?.textContent?.trim() || "0:00"
      const duration = durationEl?.textContent?.trim() || "0:00"

      const favoriteBtn = document.querySelector('[data-test="footer-favorite-button"]')
      const shuffleBtn = document.querySelector('[data-test="shuffle"]')
      const repeatBtn = document.querySelector('[data-test="repeat"]')

      const isLiked =
        favoriteBtn?.getAttribute("aria-checked") === "true" ||
        favoriteBtn?.querySelector('[href="#general__heart-filled"]') !== null ||
        favoriteBtn?.getAttribute("aria-label")?.includes("Remove from")

      const isShuffled = shuffleBtn?.getAttribute("aria-checked") === "true"

      let repeatMode = "off"
      if (repeatBtn?.getAttribute("aria-checked") === "true") {
        const dataType = repeatBtn.getAttribute("data-type")
        if (dataType?.includes("repeatSingle") || dataType?.includes("One")) {
          repeatMode = "one"
        } else {
          repeatMode = "all"
        }
      }

      const playingFromEl = document.querySelector('[data-test="playing-from-links"]')
      const playingFrom = playingFromEl?.textContent?.trim() || ""

      const imageEl =
        document.querySelector("._currentMediaImagery_e674243 img") ||
        document.querySelector('[data-test="current-media-imagery"] img')
      const imageUrl = imageEl?.src || ""

      const data = {
        title,
        artist,
        isPlaying,
        currentTime,
        duration,
        isLiked,
        isShuffled,
        repeatMode,
        playingFrom,
        imageUrl,
        timestamp: now,
        lastStateChangeTime: lastStateChangeTime,
        url: window.location.href,
      }

      return data
    } catch (error) {
      log(`Error extracting data: ${error.message}`, "error")
      return null
    }
  }

  function executeCommand(action, commandId) {
    log(`Executing command: ${action}`)

    if (action === "play" || action === "pause") {
      debugPlayPauseButtons()
    }

    const commandFunc = COMMAND_MAP[action]
    if (!commandFunc) {
      log(`Unknown command: ${action}`, "error")
      return { success: false, error: "Unknown command" }
    }

    try {
      const success = commandFunc()

      if (success) {
        log(`Command ${action} executed successfully`)
        setTimeout(sendTrackUpdate, 100)
        return { success: true, action }
      } else {
        log(`Command ${action} failed - button not found or not clickable`, "error")
        return { success: false, error: "Button not found or not clickable" }
      }
    } catch (error) {
      log(`Error executing ${action}: ${error.message}`, "error")
      return { success: false, error: error.message }
    }
  }

  function sendTrackUpdate(force = false) {
    if (!extensionContextValid) {
      return
    }

    const trackData = getTidalData()
    if (!trackData) {
      return
    }

    const stateAge = Date.now() - trackData.lastStateChangeTime

    const isStale = !trackData.isPlaying && stateAge > STALE_DATA_TIMEOUT

    if (isStale) {
      log(`Track data is stale (paused for ${Math.floor(stateAge / 60000)} minutes)`)
      return
    }

    const hasChanged =
      !lastTrackData ||
      JSON.stringify({ ...trackData, timestamp: 0, lastStateChangeTime: 0 }) !==
        JSON.stringify({ ...lastTrackData, timestamp: 0, lastStateChangeTime: 0 })

    if (force || hasChanged) {
      log(
        `Sending track update: "${trackData.title}" by "${trackData.artist}" (${trackData.isPlaying ? "Playing" : "Paused"})`,
      )
      lastTrackData = { ...trackData }

      try {
        if (chrome && chrome.runtime) {
          chrome.runtime
            .sendMessage({
              type: "TRACK_UPDATE",
              data: trackData,
            })
            .catch((error) => {
              log(`Failed to send update: ${error.message}`, "error")
              extensionContextValid = false
            })
        }
      } catch (error) {
        log(`Send update error: ${error.message}`, "error")
        extensionContextValid = false
      }
    }
  }

  function setupMessageListener() {
    if (messageListenerSetup || !chrome || !chrome.runtime) {
      return
    }

    try {
      chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        log(`Received message: ${message.type}`)

        try {
          if (message.type === "EXECUTE_ACTION") {
            const result = executeCommand(message.action, message.commandId)
            sendResponse(result)
            return true
          } else if (message.type === "GET_INITIAL_DATA") {
            setTimeout(sendTrackUpdate, 100)
            sendResponse({ success: true })
          } else if (message.type === "FORCE_UPDATE") {
            sendTrackUpdate(true)
            sendResponse({ success: true })
          } else if (message.type === "PING") {
            sendResponse({ success: true, timestamp: Date.now() })
          }
        } catch (error) {
          log(`Message handler error: ${error.message}`, "error")
          sendResponse({ success: false, error: error.message })
        }

        return true
      })

      messageListenerSetup = true
      log("Message listener setup complete")
    } catch (error) {
      log(`Failed to setup message listener: ${error.message}`, "error")
      extensionContextValid = false
    }
  }

  function startMonitoring() {
    if (isMonitoring) return

    log("Starting monitoring...")
    isMonitoring = true

    sendTrackUpdate(true)

    if (monitoringInterval) {
      clearInterval(monitoringInterval)
    }

    if (forceUpdateInterval) {
      clearInterval(forceUpdateInterval)
    }

    monitoringInterval = setInterval(() => {
      sendTrackUpdate()
    }, MONITOR_INTERVAL)

    forceUpdateInterval = setInterval(() => {
      sendTrackUpdate(true)
    }, FORCE_UPDATE_INTERVAL)

    log("Monitoring started")
  }

  function setupDOMObserver() {
    try {
      const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          if (mutation.type === "attributes" || mutation.type === "childList") {
            sendTrackUpdate(true)
            return
          }
        }
      })

      const playerElement =
        document.querySelector('[data-test="footer-player"]') || document.querySelector('[id="footerPlayer"]')

      if (playerElement) {
        observer.observe(playerElement, {
          attributes: true,
          childList: true,
          subtree: true,
          attributeFilter: ["data-test-playback-state", "aria-label"],
        })
        log("DOM observer set up")
      }
    } catch (error) {
      log(`Error setting up DOM observer: ${error.message}`, "error")
    }
  }

  function checkPageReady() {
    const isTidalPage = window.location.href.includes("tidal.com")
    const hasFooterPlayer =
      document.querySelector('[data-test="footer-player"]') || document.querySelector('[id="footerPlayer"]')
    const hasTrackInfo = document.querySelector('[data-test="footer-track-title"]')

    if (isTidalPage && hasFooterPlayer && hasTrackInfo) {
      startMonitoring()
      setupDOMObserver()
    } else if (isTidalPage) {
      setTimeout(checkPageReady, 1000)
    }
  }

  async function initialize() {
    log("Initializing content script...")

    if (typeof window.chrome !== "undefined") {
      chrome = window.chrome
    }

    const connected = await testExtensionConnection()
    if (!connected) {
      log("Extension connection failed, retrying...", "error")
      if (retryCount < MAX_RETRIES) {
        retryCount++
        setTimeout(initialize, 1000)
        return
      } else {
        log("Max retries reached, continuing with limited functionality", "error")
      }
    }

    setupMessageListener()

    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", () => {
        setTimeout(checkPageReady, 500)
      })
    } else {
      setTimeout(checkPageReady, 300)
    }

    let lastUrl = window.location.href
    const urlCheckInterval = setInterval(() => {
      if (window.location.href !== lastUrl) {
        lastUrl = window.location.href
        log(`URL changed: ${lastUrl}`)
        isMonitoring = false

        if (monitoringInterval) {
          clearInterval(monitoringInterval)
          monitoringInterval = null
        }

        if (forceUpdateInterval) {
          clearInterval(forceUpdateInterval)
          forceUpdateInterval = null
        }

        setTimeout(checkPageReady, 500)
      }
    }, 500)

    window.addEventListener("beforeunload", () => {
      if (monitoringInterval) clearInterval(monitoringInterval)
      if (forceUpdateInterval) clearInterval(forceUpdateInterval)
      if (urlCheckInterval) clearInterval(urlCheckInterval)
    })

    log("Content script initialization complete")
  }

  initialize()
})()

-- ClassClock for Hammerspoon
--
-- Shows the web app's compact layout (?mode=compact) in a small, borderless,
-- always-on-top window.
--
--   * Toggle show / hide   : Ctrl+Alt+Cmd + C
--   * Move to next corner  : Ctrl+Alt+Cmd + M
--   * Reload the page      : Ctrl+Alt+Cmd + R
--   * Move freely          : hold Option (alt) and drag the window
--   * The position (and whether it is shown) is remembered across restarts.
--
-- Install: see README.md ("Hammerspoon"). Either use this file as
-- ~/.hammerspoon/init.lua, or copy it to ~/.hammerspoon/classclock.lua and add
--     require("classclock")
-- to your own init.lua.
--
-- APIs used (all from the Hammerspoon sources: hs.webview, hs.canvas constants,
-- hs.eventtap, hs.hotkey, hs.settings, hs.screen, hs.timer, hs.dockicon).

---------------------------------------------------------------------------
-- Settings: edit these
---------------------------------------------------------------------------
local config = {
  -- Page to show. For offline use, serve the repo locally (python3 -m http.server)
  -- and point this at e.g. "http://localhost:8000/?mode=compact".
  url = "https://sasekazu.github.io/class-clock/?mode=compact",

  width = 285,
  height = 70,

  -- Where the window goes the first time (and on the corner hotkey cycle):
  -- "topRight" | "bottomRight" | "bottomLeft" | "topLeft"
  corner = "topRight",
  margin = 12,

  -- Shortcuts
  hotkeyMods = { "ctrl", "alt", "cmd" },
  keyToggle = "C",
  keyCorner = "M",
  keyReload = "R",

  -- Hold this modifier ("alt", "cmd", "ctrl" or "shift") and drag to move the window.
  dragModifier = "alt",

  -- Window level, a key of hs.canvas.windowLevels. Higher = more likely to stay above
  -- full-screen presentations. "screenSaver" is the documented "above fullscreen windows"
  -- level; "assistiveTechHigh" sits higher still. If the clock hides behind your
  -- presentation software, try the other one.
  level = "assistiveTechHigh",

  -- Needed for windows to appear on top of other apps' full-screen Spaces:
  -- hides Hammerspoon's Dock icon (menu-bar icon stays).
  hideDockIcon = true,

  -- If the page fails to load (e.g. Wi-Fi not up yet after login), retry after this many seconds.
  retrySeconds = 30,
}

---------------------------------------------------------------------------
-- State
---------------------------------------------------------------------------
local KEY_X, KEY_Y = "classclock.x", "classclock.y"
local KEY_VISIBLE, KEY_CORNER = "classclock.visible", "classclock.corner"
local CORNERS = { "topRight", "bottomRight", "bottomLeft", "topLeft" }

local view = nil          -- hs.webview
local dragTap = nil       -- hs.eventtap (Option + drag)
local screenWatcher = nil -- hs.screen.watcher
local retryTimer = nil
local dragOffset = nil    -- {dx, dy} while dragging

if config.hideDockIcon then hs.dockicon.hide() end

---------------------------------------------------------------------------
-- Geometry helpers
---------------------------------------------------------------------------
local function contains(rect, p)
  return p.x >= rect.x and p.x < rect.x + rect.w and p.y >= rect.y and p.y < rect.y + rect.h
end

-- The screen whose area contains point p (or the main screen).
local function screenAt(p)
  for _, s in ipairs(hs.screen.allScreens()) do
    if contains(s:fullFrame(), p) then return s end
  end
  return hs.screen.mainScreen()
end

local function cornerPosition(corner, screen)
  local f = screen:frame() -- visible area: excludes menu bar and Dock
  local left = (corner == "topLeft" or corner == "bottomLeft")
  local top = (corner == "topLeft" or corner == "topRight")
  return {
    x = left and (f.x + config.margin) or (f.x + f.w - config.width - config.margin),
    y = top and (f.y + config.margin) or (f.y + f.h - config.height - config.margin),
  }
end

-- Saved position, if it still lies on a connected screen.
local function savedPosition()
  local x, y = hs.settings.get(KEY_X), hs.settings.get(KEY_Y)
  if type(x) ~= "number" or type(y) ~= "number" then return nil end
  local center = { x = x + config.width / 2, y = y + config.height / 2 }
  for _, s in ipairs(hs.screen.allScreens()) do
    if contains(s:fullFrame(), center) then return { x = x, y = y } end
  end
  return nil
end

local function savePosition()
  if not view then return end
  local tl = view:topLeft()
  hs.settings.set(KEY_X, tl.x)
  hs.settings.set(KEY_Y, tl.y)
end

---------------------------------------------------------------------------
-- Window
---------------------------------------------------------------------------
local ERROR_HTML = [[<body style="margin:0;background:#000;color:#9a9a9a;font:13px -apple-system,sans-serif;
display:flex;align-items:center;justify-content:center;height:100vh">ClassClock を読み込めません。再試行します…</body>]]

local function scheduleRetry()
  if retryTimer then return end
  retryTimer = hs.timer.doAfter(config.retrySeconds, function()
    retryTimer = nil
    if view then view:url(config.url) end
  end)
end

local function createView()
  local pos = savedPosition() or cornerPosition(config.corner, hs.screen.mainScreen())
  local w = hs.webview.new({ x = pos.x, y = pos.y, w = config.width, h = config.height })

  w:windowStyle({ "borderless", "nonactivating" }) -- no title bar; never takes focus
  w:allowTextEntry(false)
  w:shadow(false)
  w:level(hs.canvas.windowLevels[config.level] or hs.canvas.windowLevels.screenSaver)
  -- Follow the user across Spaces and be allowed on a full-screen app's Space.
  w:behavior(hs.canvas.windowBehaviors.canJoinAllSpaces | hs.canvas.windowBehaviors.fullScreenAuxiliary)
  w:navigationCallback(function(action)
    if action == "didFailProvisionalNavigation" or action == "didFailNavigation" then
      scheduleRetry()
      return ERROR_HTML
    end
  end)
  w:url(config.url)
  return w
end

local function setVisible(visible)
  if not view then view = createView() end
  if visible then view:show() else view:hide() end
  hs.settings.set(KEY_VISIBLE, visible)
end

local function toggle()
  setVisible(not (view and view:isVisible()))
end

local function moveToNextCorner()
  if not view then return end
  local tl = view:topLeft()
  local screen = screenAt({ x = tl.x + config.width / 2, y = tl.y + config.height / 2 })
  local current = hs.settings.get(KEY_CORNER) or config.corner
  local index = 0
  for i, c in ipairs(CORNERS) do
    if c == current then index = i end
  end
  local nextCorner = CORNERS[(index % #CORNERS) + 1]
  view:topLeft(cornerPosition(nextCorner, screen))
  hs.settings.set(KEY_CORNER, nextCorner)
  savePosition()
end

local function reload()
  if view then view:url(config.url) end
end

---------------------------------------------------------------------------
-- Option + drag to move
---------------------------------------------------------------------------
local types = hs.eventtap.event.types
dragTap = hs.eventtap.new({ types.leftMouseDown, types.leftMouseDragged, types.leftMouseUp }, function(e)
  if not view or not view:isVisible() then return false end
  local t = e:getType()
  if t == types.leftMouseDown then
    if not e:getFlags()[config.dragModifier] then return false end
    local p = e:location()
    local f = view:frame()
    if not contains(f, p) then return false end
    dragOffset = { dx = p.x - f.x, dy = p.y - f.y }
    return true -- swallow the click
  elseif t == types.leftMouseDragged and dragOffset then
    local p = e:location()
    view:topLeft({ x = p.x - dragOffset.dx, y = p.y - dragOffset.dy })
    return true
  elseif t == types.leftMouseUp and dragOffset then
    dragOffset = nil
    savePosition()
    return true
  end
  return false
end)
dragTap:start()

---------------------------------------------------------------------------
-- Hotkeys, screen changes, startup
---------------------------------------------------------------------------
hs.hotkey.bind(config.hotkeyMods, config.keyToggle, toggle)
hs.hotkey.bind(config.hotkeyMods, config.keyCorner, moveToNextCorner)
hs.hotkey.bind(config.hotkeyMods, config.keyReload, reload)

-- If a display is unplugged, bring the window back to a visible spot.
screenWatcher = hs.screen.watcher.new(function()
  if not view then return end
  local tl = view:topLeft()
  local center = { x = tl.x + config.width / 2, y = tl.y + config.height / 2 }
  for _, s in ipairs(hs.screen.allScreens()) do
    if contains(s:fullFrame(), center) then return end
  end
  view:topLeft(cornerPosition(config.corner, hs.screen.mainScreen()))
  savePosition()
end)
screenWatcher:start()

local wasVisible = hs.settings.get(KEY_VISIBLE)
setVisible(wasVisible ~= false) -- shown on first run

return { toggle = toggle, show = function() setVisible(true) end, hide = function() setVisible(false) end,
         nextCorner = moveToNextCorner, reload = reload }

---
paths:
  - "shared/**"
  - "apps/*/page/**"
  - "apps/*/worker/**"
---

# What the shared code holds

- Each file below is named with what it's for.
  How it works is in its own top comment.
- Pages import the shared modules as `#shared/<module>.js` through their import map,
  and Node through the root's `package.json`'s imports.
- The Worker serves every file in `shared/page/`, its `networks/` logos too, under `shared/`.
- Pages link the shared stylesheets before their own `styles.css`,
  and theme them with the tokens each one's top comment lists.

## `shared/page/`: the page's modules and stylesheets

### The page and its tabs

- `html.js`: the `html` template and `setHtml`, which build and write the page's markup
- `tabs.js`: a row of tabs, picked by a tap or the keys
- `tab-bar.js`: the tab bar floating at a phone's bottom
- `page-tabs.js`: switching the page's tabs
- `last-tab.js`: keeping the tab the page shows
- `open-last-tab.js`: reopening the last tab before the first paint
- `device.js`: telling a phone or tablet from a computer, and the Home Screen from the browser
- `keyboard-focus.js`: showing focus rings only while a keyboard moves the focus
- `gate.js`: the access code's gate
- `access.js`: reloading into the gate once the Worker asks for the code again
- `updates.js`: the Updates box under the tabs, with the app's release notes
- `channel-tag.js`: the tag beside the app's name on beta, with the commit it runs
- `title-year.js`: the year in the title, lighter, whenever the season shown isn't being played
- `league-words.js`: what each league's fans call things, for shared code to show
- `device-storage.js`: the choices a viewer makes, kept on their own device
- `local-storage.js`: what the page keeps on the device
- `failed-images.js`: leaving out a picture from another site that didn't load

### Opening, coming back, and catching up

- `long-away.js`: starting the page over after two minutes away
- `show-last-drawn.js`: putting back what the page last showed, before the first paint
- `last-seen.js`: saving what the page shows as it leaves the screen
- `element-path.js`: where a part sits under another, for a later load to find it
- `sheet-memory.js`: how long a sheet stays open while the page is away
- `slow-load.js` and `load-note.js`: the note on a slow or lost connection while the views are empty
- `catch-up-note.js`: the header's line while the scores shown aren't yet confirmed
- `caught-up-sweep.js`: the sweep through the header's lines once the page has caught up
- `pull-to-refresh.js`: pulling a page on the Home Screen down to catch up
- `resume.js`: the release check and catching up on return
- `release.js`: reading which release the page and the Worker run
- `release-guard.js`: reloading a page loaded mid-deploy until its files are from one release
- `stamp.js`: the header's lines on the latest score and the next game

### The service worker

- `service-worker.js`: registering the service worker, and reading its steps
- `offline-worker.js`: the page's offline copy and the pictures it last showed
- `push-worker.js`: showing the Worker's pushes as notifications
- `service-worker-steps.js`: the service worker's last steps, for Diagnostics

### Settings and Diagnostics

- `settings-sheet.js`: the settings sheet
- `season-picker.js`: the settings' Season picker
- `notifications.js` and `notification-status.js`: the notifications switch and the note under it
- `diagnostics.js`: the Diagnostics at settings' end, and the report they share
- `step-log.js`: a log of what one part of the page does, for Diagnostics
- `viewport-log.js`: the log of each change to the screen's viewports
- `sheet-log.js`: the log of what each dialog's row of sheets does
- `day-strip-log.js`: the log of what a season's list of days does
- `list-log.js`: where each season's list of days is, at each record's end
- `bracket-standings-log.js`: the log of each touch on a season's standings and bracket
- `phone-look-log.js`: the log of each change of the phone's light or dark look
- `error-log.js`: the log of each error the page's code doesn't catch

### The Home Screen welcome and theme

- `draw-home-screen-asks.js`: the Home Screen welcome and settings' box, drawn before the first paint
- `home-screen.js`: Chrome's Install, and the welcome's opening and closing
- `pick-theme.js`: the theme picked, shown before the first paint
- `appearance.js`: settings' Appearance choices, and the note on updating the icon
- `re-add-note.js`: when settings shows the note on updating the icon
- `dismiss-button.js`: the X in the corner of a box like the note or the Updates box

### Standings and bracket

- `bracket-standings.js`: one tab for a season's standings and its bracket
- `season-header.js`: the header riding up over the standings or bracket
- `season-part.js`: finding the standings or bracket that holds a part
- `rider-taps.js`: stand-ins under the Updates box's buttons, so a drag from one scrolls
- `pill-thumb.js`: the accent block under a pill's shown name
- `held-bar.js`: marking a bar held at the top once its list scrolls under it
- `opening-round.js`: opening a sideways bracket on its earliest round still playing
- `round-dots.js`: a sideways bracket's round dots
- `series-text.js`: how a playoff game and its series read

### The Games list and its strip

- `day-strip.js`: a season's games as one list of days under a strip of every day
- `day-strip-rules.js`: what the list decides apart from drawing and scrolling
- `strip-slide.js`: the strip's dates sliding behind its box
- `near-days.js`: which days a long list draws whole
- `season-days.js`: each game day under its label
- `game-row.js`: each game's row
- `game-clubs.js`: which teams a game is between
- `all-star.js`: an All-Star team's star

### Search

- `game-search-view.js`: the search's view
- `search-reading.js`: what the search shows for its words as they're typed
- `game-search.js`, `game-search-read.js`, `game-search-match.js`, `game-search-describe.js`, and `game-search-dictionary.js`:
  reading a search of games, finding them, and saying how it read them
- `search-words.js`: what a search's words mean
- `search-dates.js`: the calendar's words a search reads
- `search-suggestions.js`: what a search offers as it's typed
- `page-search.js`: reading a search's words into the pages they name
- `page-places.js`: the pages a search can find besides games

### Motion and touch

- `spring-scroll.js`: a scroll that eases into place on a spring
- `reduced-motion.js`: whether the device asks for less motion
- `press.js`: a row tinting while it's pressed, and a touch that scrolls never tapping
- `kept-place.js`: keeping the rows on the screen in place as what's above them changes size
- `eased-redraw.js`: easing the page's parts to their new heights as new data redraws them
- `slide-panels.js`: panels side by side, one shown, that a finger drags and a tap slides

### Sheets

- `sheet.js`: a sheet a tap opens, and a dialog's stack of sheets
- `sheet-swipe.js`: closing a sheet with a swipe down
- `side-swipe.js`: each sideways swipe the page's code follows
- `sheet-reopen.js`: the sheets open as the page leaves, taken back on its next load
- `sheet-sections.js`: a sheet's sections under pills
- `sheet-part.js`: a sheet's titled parts
- `tape.js`: a sheet's face-off rows
- `network-logos.js` and `networks/`: the line of channels a game's sheet says it's on
- `placeholder.js`: the placeholders that hold a sheet's shape while it loads
- `retry.js`: what a sheet shows where a read failed, with Try again

### Team and player sheets

- `team-sheet.js`: a team's sheet
- `game-cards.js`: the cards of a team's nearest games
- `nearest-games.js`: which games those are
- `season-series.js`: two teams' season series on their game's sheet
- `rank-curve.js`: a number beside its rank on a curve, or beside another on a line
- `team-numbers.js`: a team's numbers measured against every team's
- `team-colors.js`: the colors two teams take on one chart
- `playing-now.js`: a player a box score shows playing, marked for the sheet it opens
- `highlights-view.js`, `highlights-section.js`, and `clip-player.js`: a final's Highlights section and its clips

### The store and reading

- `worker-store.js`: the store client, which keeps the page's data current from the Worker
- `compare.js`: whether two documents hold the same data
- `season-reader.js`: reading the season the store says is current
- `season-doc-follower.js`: following a document the store keeps for the season shown
- `poll-schedule.js`: how long a league's next update waits
- `kept-read.js`: a read worked out again only once what it reads from changes
- `worker-fetch.js`: reading what a sheet shows from the app's own Worker
- `sheet-reads.js`: what sheets read from the Worker, kept by what each is about
- `worker-error.js`: reading the Worker's error answers

### News

- `news.js`, `news-view.js`, `news-picks.js`, and `news-choices.js`: the News tab, its cards, and its switches
- `news-photo.js`: how a story's photo sits on its card
- `photo-credits.js`: how a photo's credit wraps

### Days and text

- `days.js`: days and times, on the viewer's clock and a league's Eastern day
- `ordinal.js`: a number as 1st, 2nd, or 3rd
- `escape-pattern.js`: text made safe to match word for word in a regular expression

### Stylesheets

- `type.css`: the type roles
- `chrome.css`: the tab bar, settings, the Home Screen welcome and box, and the header's lines
- `diagnostics.css`: the Diagnostics at settings' end
- `pager.css`: a pill's names and what slides under it
- `day-strip.css`: a season's list of days and its strip
- `game-search.css`: the search's view
- `game-row.css`: a game row and an All-Star team's star
- `sheet.css`: a sheet a tap opens and what its parts hold
- `team-sheet.css`: a team's sheet and the buttons that open a team's or a player's
- `row-button.css`: a table's row that opens wherever it's tapped
- `game-cards.css`: the cards of a team's nearest games
- `updates.css`: the Updates box
- `news.css`: the News view's layout
- `retry.css`: what a sheet shows where a read failed
- `highlights.css`: a final's Highlights
- `rank-curve.css`: a rank curve and the notes on how a player is ranked
- `no-field-note.css`: the bracket before the playoff field is set
- `channel-tag.css`: the tag beside the app's name on beta
- `gate.css`: the access code's gate, whose title and button the welcome takes too

## `shared/worker/`: the Worker's modules

- `app-worker.js`: the Worker's routing under the key
- `access-gate.js`: the access code's gate and the cookie that keeps a phone signed in
- `health.js`: the Worker's health, for an uptime monitor
- `responses.js`: what the Worker's JSON endpoints answer with
- `timeout.js`: giving up on a service that doesn't answer in time
- `seasons.js`: the season a request names
- `season-store.js`: the store's Durable Object, which keeps the season up to date
- `upstream.js`: reading a league's feeds
- `feed-keeper.js`: reading a league's slower feeds again only when they may have changed
- `background-job.js`: what a league's background jobs share
- `job-status.js`: what every background job's status says of its last run
- `highlights-job.js`: keeping each final's highlights
- `game-details-job.js`: keeping each finished game's details
- `store-reads.js`: what the Worker's routes read from the store
- `injury-report.js`: ESPN's injury report for a league
- `story-lead.js`: a story's first lines as plain text
- `news-updater.js`, `news-feeds.js`, `news-parse.js`, `news-rules.js`, `news-prompts.js`, and `news-claude.js`:
  keeping a league's news from its outlets' feeds, judged by Claude
- `news-photos.js` and `image-size.js`: framing the news cards' photos
- `claude.js`: asking Claude for an answer in a JSON schema's shape
- `hash-text.js`: a short, fixed-length name for any text
- `notifications.js`: turning the page's lines into notifications, and capping a night's
- `push.js`: push subscriptions and the key that signs messages for them
- `web-push.js`: sending Web Push messages

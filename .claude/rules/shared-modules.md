---
paths:
  - "shared/**"
  - "apps/*/page/**"
  - "apps/*/worker/**"
---

# What the shared code holds

Each module's top comment says more. Pages import them as `#shared/<module>.js` through their import map, and Node through the root's `package.json`'s imports. The root's `tests/shared-modules-list.test.js` keeps this list whole.

## `shared/page/`

The Worker serves every file here, its `networks/` logos too, under `shared/`, but for the tuning panel's, which only a channel off production serves, and only while a round is open (the root's `worker/tuning-files.mjs`).

### The page and its tabs

- `html.js`: the `html` template, which escapes every value
- `tabs.js`: marking the tab shown
- `tab-bar.js`: the phone's tab bar and its pill
- `page-tabs.js`: switching the page's tabs
- `last-tab.js`: the tab last shown, kept on the device
- `open-last-tab.js`: reopening the last tab before the first paint
- `device.js`: a phone or tablet or a computer, and the Home Screen or the browser
- `gate.js`: the access code's gate
- `access.js`: reloading into the gate once the access code changes
- `updates.js`: the Updates box of what's new
- `title-year.js`: the title's year, lighter when the season shown isn't being played
- `device-storage.js`: a viewer's choices kept on their device, and other tabs' changes to them
- `local-storage.js`: what the page keeps on the device, safe when storage refuses or is full
- `keyboard-focus.js`: focus rings only for keyboard use
- `league-words.js`: what a league's pages call things, in its fans' words
- `draw-channel-tag-age.js`: how long ago beta's release went live, in the tag beside the app's name, before the first paint
- `channel-tag.js`: keeping that tag's age current while the page stays open
- `release.js`: the release the build writes into the page, and the latest one the Worker serves
- `release-guard.js`: reloading until every file comes from one release, as a deploy lands
- `tuning-panel.js`: off production, the panel that tunes a round's values on the page
- `tuning-round.js`: off production, what a tuning round asks for, and its values as text to copy

### Opening, coming back, and catching up

- `long-away.js`: the two minutes away after which the page starts over
- `show-last-drawn.js`: putting back what the page last showed before the first paint
- `sheet-memory.js`: which sheets close as the page comes back
- `slow-load.js`: saying the page is slow or offline while its views are empty
- `load-note.js`: the first drawing ending that note
- `catch-up-note.js`: the header's line while scores aren't yet confirmed, or the phone is offline
- `caught-up-sweep.js`: the sweep through the header once caught up
- `pull-to-refresh.js`: pulling down on the Home Screen to catch up
- `resume.js`: the release check and catching up on return
- `daily-count.js`: counting each browser or Home Screen app once a day, with nothing about who
- `last-seen.js`: what the page last showed, drawn first on its next load
- `element-path.js`: where a part sits, so a later load finds it
- `stamp.js`: the header's lines on the latest score and the next game

### Service worker

- `service-worker.js`: what the page reads of its service worker
- `offline-worker.js`: the offline copy of the page and its files
- `push-worker.js`: showing push messages and opening the page from one
- `service-worker-steps.js`: the service worker's last steps, for Diagnostics

### Settings and Diagnostics

- `settings-sheet.js`: the settings sheet
- `settings-page.js`: shared Settings page navigation
- `settings-icons.js`: Settings caret and Back icons
- `contact.js`: Contact navigation, validation, screenshots, and sending
- `contact-view.js`: the selected Contact menu, forms, and confirmations
- `contact-drafts.js`: separate category drafts and stable submission identifiers
- `contact-rules.js`: Contact categories and shared input limits
- `season-picker.js`: settings' Season picker
- `notifications.js`: the Notifications group's permission, saving and timing changes
- `notifications-view.js`: the Notifications group's rows, from its state and the league's words
- `notification-preferences.js`: device push categories, timing presets, and validation
- `notification-intent.js`: the game a notification asks to open, from its message or the page's address
- `notification-navigation.js`: opening a game from a notification through reloads and the access gate
- `notification-status.js`: notification guidance and category control states
- `save-queue.js`: saves that run one at a time, the newest choice last
- `diagnostics.js`: the Diagnostics and their shared report
- `sent-label.js`: how long a button that copies or shares says it did
- `step-log.js`: a Diagnostics log of what one part of the page does
- `report-addresses.js`: hiding private addresses in Diagnostics and submitted reports
- `viewport-log.js`: each change to the screen's viewports
- `sheet-log.js`: what each dialog's sheets do
- `day-strip-log.js`: what a season's list of days does
- `list-log.js`: where each list of days stands, at each record's end
- `bracket-standings-log.js`: each touch on the standings and bracket
- `phone-look-log.js`: each change of the phone's light or dark look, and of the page's focus
- `error-log.js`: each error the page's code doesn't catch

### The Home Screen welcome and theme

- `draw-home-screen-asks.js`: the welcome and settings' box of steps, before the first paint
- `home-screen.js`: Chrome's Install and opening the welcome again
- `pick-theme.js`: the theme picked, and each install's icon
- `page-move.js`: moving from the old address to the app's own, carrying the viewer's choices
- `move-cards.js`: the Updates box's cards for that move and for turning notifications back on
- `re-add-note.js`: when settings shows the note on updating the icon
- `appearance.js`: settings' Appearance choices and the note on updating the icon
- `dismiss-button.js`: the X in a box's corner

### Standings and bracket

- `bracket-standings.js`: one tab for a season's standings and bracket
- `season-header.js`: the header riding up over the standings or bracket
- `season-part.js`: whether an element is the standings or the bracket
- `rider-taps.js`: stand-ins under the Updates box's buttons that tap or scroll
- `pill-thumb.js`: the accent block under a pill's shown name
- `opening-round.js`: opening a bracket on its earliest round still playing
- `round-dots.js`: a sideways bracket's round dots
- `held-bar.js`: marking a bar held at the top of a list

### The Games list and its strip

- `day-strip.js`: a season's game days under a strip of every day
- `day-strip-rules.js`: what `day-strip.js` decides apart from drawing and scrolling
- `strip-slide.js`: the strip's dates sliding behind its still box
- `near-days.js`: which days a long list draws whole
- `season-days.js`: each game day under its label
- `game-row.js`: each game's row and its button
- `game-clubs.js`: which teams a game is between
- `all-star.js`: an All-Star team's star
- `series-text.js`: how a playoff game and its series read

### Search

- `game-search-view.js`: the search's view, with suggestions and examples
- `game-search.js`: reading a search of games, finding them, and saying how it read
- `game-search-read.js`: reading a search's words into what it asks of a game
- `game-search-dictionary.js`: every phrase a league's search knows
- `game-search-match.js`: finding the games a search asks for
- `game-search-describe.js`: the line under the field saying how it read
- `search-words.js`: what a search's words mean
- `search-dates.js`: the calendar words a search reads
- `search-suggestions.js`: what a search offers as it's typed
- `search-reading.js`: what search shows for words as they're typed
- `page-search.js`: reading the same words into the pages they name
- `page-places.js`: what a league's search finds besides games

### Motion and touch

- `spring-scroll.js`: a scroll that eases into place on a spring
- `reduced-motion.js`: whether the device asks for less motion
- `press.js`: every control's press, and telling a tap from a scroll
- `kept-place.js`: keeping rows in place as what's above them changes
- `eased-redraw.js`: easing parts to their new heights on a redraw
- `slide-panels.js`: side-by-side panels a finger drags
- `side-swipe.js`: each sideways swipe the page's code follows

### Sheets

- `sheet.js`: a sheet and a dialog's stack of sheets, and the rules every motion keeps
- `sheet-swipe.js`: a swipe down closing a sheet
- `sheet-reopen.js`: the sheets open as the page leaves, put back on reload
- `sheet-sections.js`: a sheet's sections under pills
- `sheet-part.js`: a sheet's titled parts
- `sheet-reads.js`: what sheets read from the Worker, and when they read again
- `tape.js`: a sheet's face-off rows
- `network-logos.js`: the line of channels a game is on, with their logos in `networks/`
- `placeholder.js`: placeholders holding a sheet's shape while it loads
- `retry.js`: what a sheet shows where a read failed, with Try again

### Team and player sheets

- `team-sheet.js`: a team's sheet
- `team-colors.js`: the colors two teams take when they share a chart
- `game-cards.js`: the cards of a team's nearest games
- `nearest-games.js`: which games those are
- `season-series.js`: a game's two teams' season series
- `rank-curve.js`: a player's number beside its rank, on a curve
- `team-numbers.js`: a team's playoff numbers against the playoff field's
- `playing-now.js`: marking a player in a game under way or ended today
- `highlights-view.js`: a finished game's Highlights, its recap and clips
- `highlights-section.js`: a game sheet's Highlights section, read from the Worker
- `clip-player.js`: playing a clip full screen in the device's own player

### The store and reading

- `reminder-games.js`: the playoff games a league's snapshot hands the store for reminders
- `worker-fetch.js`: reading from the app's own Worker, sharing a recent read
- `worker-error.js`: reading the Worker's error answers
- `worker-store.js`: the store client
- `store-path.js`: names and document paths shared by the store client and Worker
- `count-path.js`: the route the daily count is sent to, shared by the page and Worker
- `season-reader.js`: reading the current season, its record, and the store's status
- `season-doc-follower.js`: following a document the store keeps for the season shown
- `poll-schedule.js`: how long a league's next update waits
- `kept-read.js`: a read worked out again only once what it reads changes
- `compare.js`: comparing documents whatever their key order

### News

- `news.js`: the News tab
- `news-view.js`: its cards
- `news-picks.js`: the outlets each device reads
- `news-choices.js`: its switches
- `news-photo.js`: how a story's photo sits on its card
- `photo-credits.js`: how a photo's credit wraps
- `failed-images.js`: leaving out pictures that didn't load

### Days and text

- `days.js`: days and times, with `nameDay`, `readEasternDay`, and `addDays`
- `ordinal.js`: 1st, 2nd, 3rd
- `escape-pattern.js`: text made safe to match in a regular expression

### Stylesheets

Pages link these before their own stylesheet, and theme them with the tokens their top comments list.

- `type.css`: the type roles
- `chrome.css`: the tab bar, settings, round dots, the welcome and its box, the catching-up line, and pull to refresh
- `diagnostics.css`: the Diagnostics and the look the stylesheets see
- `contact.css`: the Contact menu, forms, and delivery states
- `pager.css`: a pill's names and the standings and bracket under one
- `day-strip.css`: a season's list of days and its strip
- `game-search.css`: the search's view
- `game-row.css`: a game row and an All-Star team's star
- `sheet.css`: a sheet a tap opens and its parts
- `chip.css`: every chip, like Bonus, a status beside a title, or a rank tag
- `team-sheet.css`: a team's sheet and the buttons that open one
- `row-button.css`: a table's row that opens wherever it's tapped
- `game-cards.css`: the cards of a team's nearest games
- `updates.css`: the Updates box
- `news.css`: the News view's layout
- `retry.css`: what a sheet shows where a read failed
- `highlights.css`: a final's Highlights
- `rank-curve.css`: a rank curve and its notes
- `no-field-note.css`: the bracket before the playoff field is set
- `channel-tag.css`: the tag beside the app's name on beta
- `tuning-panel.css`: the tuning panel and its Tune button
- `gate.css`: the access code's gate
- `controls.css`: how every control shows its focus and its press

## `shared/worker/`

- `app-worker.js`: the Worker's routing, under the key or at its own address, and moving the page there
- `contact-request.js`: bounded Contact requests behind the app's access gate
- `access-gate.js`: asking for the access code before the page opens
- `daily-count.js`: writing each browser's or Home Screen app's daily count to Analytics Engine, with the address it came from
- `health.js`: the Worker's health, for an uptime monitor, and what each service it binds answers
- `services.js`: the services an app may bind, and each one's binding name
- `season-store.js`: the store's Durable Object, which each app's store hands its league
- `background-job.js`: what a league's background jobs share
- `job-status.js`: what each job's status says of its last run
- `upstream.js`: reading a league's feeds and reusing a recent load
- `feed-keeper.js`: reading slower feeds again only when they may have changed
- `timeout.js`: giving up on a call that doesn't answer in time
- `highlights-job.js`: keeping each final's highlights
- `game-details-job.js`: keeping each finished game's details
- `injury-report.js`: ESPN's injury report
- `store-reads.js`: reading the documents the store keeps for a sheet
- `story-lead.js`: a story's first lines as plain text
- `news-updater.js`: keeping a league's news from its outlets' feeds
- `news-feeds.js`: reading a league's news outlets
- `news-parse.js`: turning each outlet's feed into stories
- `news-rules.js`: what the news drops without asking Claude
- `news-prompts.js`: the prompt Claude judges a league's news by
- `news-claude.js`: asking Claude to judge a batch of stories
- `news-photos.js`: framing the photos the news cards show
- `image-size.js`: a photo's size from the start of its file
- `claude.js`: asking Claude for an answer shaped by a JSON schema
- `hash-text.js`: the SHA-256 of any text, in full or as a short fixed-length name
- `seasons.js`: the season a request names
- `notifications.js`: capping a night's notifications
- `game-reminders.js`: persisted game reminder deadlines, verification, delivery, and retries
- `push.js`: active and retired push devices, private preferences and receipts, signing and delivery
- `web-push.js`: sending Web Push messages
- `responses.js`: what the JSON endpoints answer with

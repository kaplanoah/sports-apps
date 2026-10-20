---
paths:
  - "shared/**"
  - "apps/*/page/**"
  - "apps/*/worker/**"
---

# What the shared code holds

- `shared/page/` holds the page modules every app uses:
  - The page and its tabs:
    - the `html` template
    - tabs and the tab bar
    - `page-tabs.js`: switching the page's tabs
    - `open-last-tab.js`: reopening the last tab before the first paint
    - `device.js`: telling a phone or tablet from a computer, and the Home Screen from the browser
    - `gate.js`: the access code's gate
    - `updates.js`: the box under the tabs that lists what's new since the device first opened the app or last dismissed it,
      with each app's release notes under New in the app
    - `title-year.js`: the year in the title, lighter, whenever the season shown isn't being played,
      an earlier one or the current one once its last game is final
    - `device-storage.js`: keeping what a viewer chooses on their own device,
      listing every such choice, and telling the page when another tab changes one
  - Opening, coming back, and catching up:
    - `long-away.js`: the two minutes away after which the page starts over where a viewer moved it, on the tab it showed,
      a plain script in the head whose limit and rules the page's modules read too
    - `show-last-drawn.js`: putting back what each part the page draws whole last showed,
      the switches its settings showed and the look picked,
      and the sheets it had open, before the first paint,
      or, after two minutes away, starting it over (`long-away.js`),
      and hiding again a part marked `data-start-hidden`, like the search
    - `sheet-memory.js`: closing, before the page draws as it comes back or loads again,
      settings left two minutes and any other sheet six hours,
      but not a game's sheet on top showing a game on its day or under way,
      which stays until an hour after its end shows on the screen
    - `slow-load.js`: saying the page is slow or offline while its views are still empty,
      until the page's first drawing ends it with `endLoadNote` from `load-note.js`
    - `catch-up-note.js`: saying, as the header's first line,
      when the scores shown are from while the store hasn't yet confirmed them since the page opened or came back,
      and that the phone is offline or the server isn't answering
    - `caught-up-sweep.js`: showing that the page has caught up with a sweep through the header's lines,
      faded where they changed and a faded band passing through where they didn't
    - `pull-to-refresh.js`: pulling a page on the Home Screen down to catch up
    - `resume.js`: the release check and catching up on return
    - `last-seen.js`: what the page last showed, drawn first on its next load
    - `stamp.js`: the header's lines on the latest score and the next game, in words like "last night"
  - Settings and Diagnostics:
    - `settings-sheet.js`: the settings sheet
    - `season-picker.js`: the settings' Season picker
    - `diagnostics.js`: the Diagnostics past the settings sheet's end.
      Once switched on, they record what the store sends and what each part the page draws whole shows in each open's first seconds.
      With a tap on Share report, they record what the page shows then, with the sheets open,
      and share it at once under a header naming the release, the device,
      the page's state, and how each of the store's background jobs last ran,
      from the status each saves (`shared/worker/job-status.js`),
      and the steps the service worker kept.
    - The Diagnostics also log these, each a log made with `step-log.js`:
      - `viewport-log.js`: each change to the screen's viewports, and how they stand as the page opens,
        leaves the screen, and comes back, but not a bounce past the page's top or bottom.
        It flags the visual one out of line with the layout one that the tab bar and sheets are held to,
        and keeps the latest line where it went off.
      - `sheet-log.js`: what each dialog's row of sheets does, each touch and click on it,
        each slide, and each sheet it settles on or lets go of
      - `day-strip-log.js`: what a season's list of days does, each touch and click on it,
        where each tap on a day or on Today takes the list and when it arrives,
        and what each fill draws and where it leaves the list.
        It also logs each new day at its top and whether the strip's dates slide to it,
        any day that changes height as it's drawn whole or as a stand-in,
        and a strip that doesn't scroll where it's told.
      - `bracket-standings-log.js`: each touch on a season's standings and bracket, how far it moved,
        whether the page's code took it from the browser, whether the browser cancelled its pointer,
        and how far the part under it scrolled, and each click on them
      - `error-log.js`: each error the page's code doesn't catch
  - The Home Screen welcome and theme:
    - `draw-home-screen-asks.js`: the welcome over the whole screen that a phone's or tablet's browser opens on,
      and the box at the top of settings that keeps the steps, both drawn before the first paint,
      so the welcome never arrives over the page and its pick and close work at once.
      The welcome's numbered steps pick the theme the Home Screen icon takes and say how to add the page there,
      until the page is added or the viewer goes on in the browser, which keeps it closed on that device.
    - `home-screen.js`: Chrome's Install in the welcome and the box,
      and the welcome opened again from the ? that ends settings' Notifications note where only the Home Screen gets notifications,
      wherever the page asks to be added there,
      rising and closing as settings does
    - `pick-theme.js`: the theme picked, shown before the first paint and named in the browser's address,
      where Safari reloads the page after a pick,
      since it takes the Home Screen app's address and its own bars' color from the page as it loaded,
      and which the Home Screen app keeps on its first open.
      An iPhone's app, which keeps the icon it was added with, hands Safari a link to add the site again,
      opening Safari's page on that theme and the welcome.
      It keeps each install's icon, from the address it opens at or, added on System, the phone's setting as it first opened.
    - `re-add-note.js`: deciding when settings shows the note on updating the icon, while the look picked, or on System the phone's, isn't the icon's,
      or, for an app that doesn't know its icon, from the first switch of looks,
      and keeping that switch and its dismissal for that install
    - `appearance.js`: settings' Appearance choices and the welcome's copy of them,
      and the note on updating the icon, with both icons and an X,
      whose link it keeps signed in with a fresh handoff while settings shows it
    - `dismiss-button.js`: the X in the corner of a box like the note or the Updates box
  - Standings and bracket:
    - `bracket-standings.js`: one tab for a season's standings and its bracket,
      named Standings and opening on them until the playoff field is set, and Bracket from then on.
      The two sit side by side, with the one it opens on first in the pill over them,
      and a tap on a name or a swipe slides between them,
      a swipe on the bracket scrolling it to its end first, as a team's Roster does.
    - `season-header.js`: the standings and bracket each scrolling on its own,
      with the header riding up over the one shown until the pill holds at the top,
      as a profile's tabs do in a phone's apps
    - `rider-taps.js`: a stand-in under each of the Updates box's buttons in each part's empty top,
      so a tap on one opens what it does and a finger that drags from it scrolls the part,
      as a button inside a list does
    - `pill-thumb.js`: the accent block under a pill's shown name,
      which never travels between names but hands off from one to the next once a tap or a finger's lift sets what's under it off
    - `opening-round.js`: opening a sideways bracket on its earliest round still playing
    - `round-dots.js`: a sideways bracket's round dots
  - The Games list and its strip:
    - `day-strip.js`: a season's games as one list of its game days under a strip of every day,
      as each app's Games view shows them, with:
      - the strip's chosen day the one at the list's top,
        its box holding still while the list's scroll slides the dates behind it on a spring (`strip-slide.js`)
      - today's named Today, which a tap on a day or on Today brings to the top
      - a day's gap under the bar
      - a tap on a date without games bringing in its No games row until it's out of sight
      - a tap on Today with the list already there bringing the date back to the strip's middle after a finger moved the strip,
        or, with the strip there too, pulsing the date, whose month follows the strip as a finger moves it
      - going back to today after two minutes away (`long-away.js`)
      - for a league of many games a day,
        drawing whole only the days within a few screens of what shows and the rest as stand-ins as tall as their games,
        which days those are in `near-days.js`, as the search's list of games draws them too
    - `day-strip-rules.js`: what `day-strip.js` decides apart from drawing and scrolling,
      like each date's label and when a trip to a day jumps rather than flies
    - `season-days.js`: each game day under a label,
      the WNBA's date beside its games as a wall calendar shows it and MLB's heading over them,
      with a No games row for today between game days
    - `game-row.js`: each game's row and its button that opens the game wherever the row is tapped
    - `all-star.js`: an All-Star team's star, in its uniform's color and set in as a dot is
  - Search:
    - `game-search-view.js`: a search over a season's games and a league's pages, in a view of its own,
      with suggestions and examples.
      The search reads what's typed with fixed rules into teams, a word two teams share finding either's,
      places and venues, groups of teams like a conference or a division,
      days, times, day and night games by the clock where they're played,
      rounds, a conference's own rounds, kinds of game, doubleheaders, and starters.
      It finds the games, and says in a line under the field what it read.
      It draws from:
      - `search-words.js`
      - `search-dates.js`
      - `game-search.js`, which reads what's typed in `game-search-read.js` with the words in `game-search-dictionary.js`,
        finds the games in `game-search-match.js`, and says what it read in `game-search-describe.js`
      - `search-suggestions.js`
    - `search-reading.js`: what the search shows for words as they're typed,
      a name half typed read as the name the first suggestion finishes once three letters of it are,
      or five with one wrong.
      Each app's `tests/search-typing.test.js` types it a key at a time, as fans do,
      and with a letter wrong each way a thumb gets one wrong,
      with the root's `tests/search-sweep.js`.
    - `page-search.js`: reading the same words into the pages they name,
      from the list of a season's players the store keeps for it:
      - a team's
      - its section's
      - a player's, even with a letter wrong, or by a team's name and the number a player wears,
        or while it's typed each number it starts, over the suggestions
      - a place's
      - a game's part's, like a final's Highlights or the next game's Matchup
  - Motion and touch:
    - `spring-scroll.js`: a scroll that eases into place on a spring, as UIKit's scroll to top does
    - `reduced-motion.js`: whether the viewer's device asks for less motion, which every motion checks
    - `press.js`: a row that opens something tinting while a finger or the mouse presses it,
      a moment after a finger lands so a scroll never tints one,
      and a tapped search row's search waiting for its tint to show.
      A touch the browser takes for a scroll never taps what it landed on,
      even when iOS still sends its click, as an iPhone's lists do.
    - `kept-place.js`: keeping the rows on the screen where they are as what's above a list grows or shrinks,
      as Chrome's scroll anchoring does and Safari's doesn't
    - `eased-redraw.js`: easing the page's parts to their new heights, fading in what's new,
      when new data redraws them
    - `slide-panels.js`: panels side by side, one shown,
      that a finger drags and that slide to rest with no animation left once they settle,
      as the stack and a sheet's sections move
  - Sheets:
    - `sheet.js`: opening a sheet at its top, over the whole screen on a phone,
      and a dialog's sheets one over another, only the one on top drawn at rest.
      A sheet opened from another slides in beside it from the right with a back arrow in place of its close caret,
      even a sheet the stack already holds,
      which leaves in its place a copy of what it showed that it takes back once the stack returns there.
      A tap on what the sheet under it shows goes back to that,
      and the arrow or a swipe right that the finger drags slides it away and out of the stack.
      Its ways to close the dialog are the caret, the backdrop, Escape, and a swipe down (`sheet-swipe.js`).
      Its top comment states the stack and the three rules every motion keeps: nothing asks for a layer ahead of time,
      nothing animates at rest, and nothing filters what is behind it.
    - `side-swipe.js`: each sideways swipe the page's code follows,
      which leaves a swipe to anything that scrolls sideways on its own until it's at its edge
    - `sheet-reopen.js`: the sheets open listed as the page leaves the screen,
      and each sheet's code taking back what it showed when a reload put it back open
    - `sheet-sections.js`: a sheet's sections under pills in its still top, one shown at a time,
      which a tap on a pill or a swipe slides between, each scrolling on its own,
      like the WNBA team's Team and Roster
    - `sheet-part.js`: a sheet's titled parts
    - `tape.js`: the face-off rows of a sheet a tap opens
    - `network-logos.js` and `networks/`: the line of channels a game's sheet says it's on, with their logos
    - `placeholder.js`: the placeholders that hold a sheet's shape while it loads
    - `retry.js`: what a sheet shows where a read of its Worker failed,
      a centered block for a whole sheet or section and a note for one part,
      each with a Try again button, which, like the phone coming back online or the page coming back,
      reads again while the part shows its placeholders
  - Team and player sheets:
    - `team-sheet.js`: a team's sheet, which a tap on the team's name or dot opens wherever it shows,
      with its numbers and facts, and any sections a league fills after them
    - `game-cards.js`: the cards of a team's nearest games across its sheet's top,
      each as wide as the row's widest line
    - `nearest-games.js`: which games those are
    - `season-series.js`: the season series of a game's two teams before it starts,
      each meeting first to last under who leads or won it
    - `rank-curve.js`: a player's number in a stat beside its rank, on a curve of every ranked player's,
      or a number beside another's,
      each a dot on a line solid across a range and dashed past it as far as a number reaches
    - `team-numbers.js`: a team's playoffs facing the playoff field's that way on the regular season's range,
      with a legend for the dashes once a line has them
    - `playing-now.js`: a player a box score shows in a game under way or ended today marked on his button for the sheet it opens,
      which then leaves out the injury report's box
    - `highlights-view.js`, `highlights-section.js`, and `clip-player.js`: a final's Highlights section,
      its recap video, story, and plays, each a clip a tap plays full screen in the device's own player
  - The store and reading:
    - `worker-fetch.js`: reading what a sheet shows from the app's own Worker, sharing a recent read of it
    - `worker-error.js`: reading the Worker's error answers
    - `season-reader.js`: reading the season the store says is current,
      its record, which a page reads only in the version it knows,
      reloading once a newer release is out, and the store's status,
      and moving on to the next season when the store does.
      It keeps each season a viewer picks while its record is on its way,
      and puts it back on the season shown when it can't be read (`createSeasonPicks`).
    - `poll-schedule.js`: how long a league's next update waits, from where its games stand
    - `kept-read.js`: a read worked out again only once what it reads from changes, like each app's season for its search
    - the store client (`worker-store.js`), which, coming back with a drawing on the screen,
      holds what the store sends until the update the store brought forward is done, so the page redraws once
    - notifications
  - News:
    - `news.js`, `news-view.js`, `news-picks.js`, and `news-choices.js`: the News tab,
      its cards and the outlets each device reads, and its switches,
      from the cards a league's news job keeps
  - Days and text:
    - `days.js`: days and times (a day near now named in words with `nameDay`,
      the league's Eastern day with `readEasternDay`, and adding days to a date with `addDays`)
    - `escape-pattern.js`: text made safe to match word for word in a regular expression
- Pages import the shared modules as `#shared/<module>.js` through their import map,
  and Node through the root's `package.json`'s imports.
- `shared/page/` also holds the stylesheets,
  which pages link before their own `styles.css` and theme with the tokens their top comments list:
  - `type.css` lists the type roles
  - `chrome.css` styles the tab bar, settings sheet and its Diagnostics, round dots, Home Screen welcome and box,
    a card with an X in its corner and settings' note on updating the icon,
    the catching-up line and the sweep once caught up, and pull to refresh's spokes
  - `pager.css` styles a pill's names and the standings and bracket under one
  - `day-strip.css` styles a season's list of days and its strip
  - `game-search.css` styles the search's view
  - `game-row.css` lays out a game row and colors an All-Star team's star
  - `sheet.css` styles a sheet a tap opens, like MLB's pitching matchup,
    with its face-off rows and line of channels, titled parts, status chips,
    the meetings of a season series, and a player's facts
  - `team-sheet.css` styles a team's sheet and the buttons that open a team's or a player's sheet
  - `row-button.css` styles a table's row that opens wherever it's tapped
  - `game-cards.css` styles the cards of a team's nearest games
  - `updates.css` styles the Updates box
  - `news.css` styles the News view's layout
  - `retry.css` styles what a sheet shows where a read failed
  - `highlights.css` styles a final's Highlights
  - `rank-curve.css` styles a rank curve, each player's mark on it, and the notes on how a player is ranked
  - `no-field-note.css` styles the bracket before the playoff field is set
  - `channel-tag.css` styles the tag beside the app's name on beta
  - `gate.css` styles the access code's gate, whose title and button the welcome takes too
- The Worker serves every file in `shared/page/`, its `networks/` logos too, under `shared/`.
- `shared/worker/` holds the Worker's modules:
  - `app-worker.js`: the Worker's routing under the key
  - `season-store.js`: the store's Durable Object,
    which saves the update status and backs off its retries itself.
    Each app's `worker/src/store.js` hands it its league:
    - how it loads and saves a snapshot
    - how long to wait
    - what to notify
    - any details of the games pages have open that it reads with each update
    - any work of its own it runs beside the season's updates, on its own schedule, like the WNBA's news
  - `upstream.js`: reading a league's feeds and reusing a recent load
  - `feed-keeper.js`: reading a league's slower feeds again only when they may have changed
  - `highlights-job.js`: keeping each final's highlights, read over the hours after it ends
  - `game-details-job.js`: keeping each finished game's details, a few at a time
  - `store-reads.js`: reading the documents the store keeps for a sheet
  - `story-lead.js`: a story's first lines as plain text
  - `news-updater.js`, `news-feeds.js`, `news-parse.js`, `news-rules.js`, `news-prompts.js`, and `news-claude.js`:
    keeping a league's news from its outlets' feeds, judged by Claude with the prompt the league hands it
  - `seasons.js`: the season a request names
  - `notifications.js`: capping a night's notifications
  - push
  - responses

# NBA backend

This folder contains the postseason feed adapter and a store-owned source reader. It is not registered as a deployable app. The page's design remains undecided.

The NBA adapter reads playoff and Play-In placements for an explicit season starting year. It checks the returned league and season, team identities, rounds, seeds, wins, duplicates and complete output schemas. Bracket placements never confirm game scores, clocks or reminder eligibility.

`createPostseasonReader` takes the store's documents, private storage, shared identity lookup, budgeted fetch and clock. It shares concurrent reads, persists usable answers, preserves them after failures and restarts, and returns feed failures and retry deadlines. Play-In game references use opaque identities from the shared atomic lookup. The reader does not merge vendors or publish a season snapshot.

The fixtures are complete historical 2024-25 bracket responses recorded on October 31, 2026. They cover 15 playoff series and six Play-In games. The tests use the real shared store writer in a simulated Durable Object context; they do not prove live Cloudflare or iPhone behavior.

The backend remains incomplete. Scoreboard, schedule, standings, player totals and partitioned game logs, detail routes and historical jobs still require implementation. NBA.com remains the primary source and ESPN the planned backup. The shared compatible readers and vendor merge must be available before integration. No live-game clock behavior has been observed.

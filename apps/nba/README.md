# NBA backend

This folder contains recorded game, conference standings and postseason adapters, plus store-owned source readers and bounded history preparation. It is not registered as a deployable app. The page's design remains undecided.

The NBA adapter reads playoff and Play-In placements for an explicit season starting year. It checks the returned league and season, team identities, rounds, seeds, wins, duplicates and complete output schemas. Bracket placements never confirm game scores, clocks or reminder eligibility.

`createPostseasonReader` takes the store's documents, private storage, shared identity lookup, budgeted fetch and clock. It shares concurrent reads, persists usable answers, preserves them after failures and restarts, and returns feed failures and retry deadlines. Play-In game references use opaque identities from the shared atomic lookup. The reader does not merge vendors or publish a season snapshot.

The bracket fixtures are complete historical 2024-25 responses recorded on October 31, 2026. They cover 15 playoff series and six Play-In games. ESPN fixtures project the recorded fields used by ingestion, retaining the entire January inventory: 232 listings, including 227 finals and five postponed games. Requests negotiate JSON without asserting browser identity or website context. The fixtures prove parsing and persistence behavior, not reliable access.

The shared ESPN adapter validates league and event season separately and keeps game competition facts separate from generic league metadata. NBA supplies season numbering, team mappings and competition formats. Cup finals are explicit and postponed games are not finals. Unknown teams or unsupported playoff rounds fail rather than acquire guessed facts.

`createGameSourceReader` persists independent day answers in monthly documents with opaque game IDs. `createStoredGameReader` reads those documents through the shared identity lookup without vendor calls. `createGameHistory` resumes a caller-supplied list of days newest first, at most four per run and only within the store's remaining historical request allowance. It makes no monthly completeness assumption. None of these readers is registered as a runtime backup or reminder confirmation.

The tests use the real shared store writer in a simulated Durable Object context; they do not prove live Cloudflare or iPhone behavior.

The approved architecture ranks eligible fresh answers above saved answers. Within each category it prefers the league, then ESPN, then Balldontlie, using shared coherent per-part merging and source/read-time provenance. Shared compatible readers, provenance, merging and secondary integration remain prerequisites; this draft does not implement or replace them. Paid providers remain candidates when a demonstrated useful gap justifies their cost. No provider or subscription is selected.

The backend remains incomplete and rollout is on hold. Full opaque-aware store wiring, shared provenance and merging, snapshot publication, detail routes, player jobs and source qualification remain prerequisites. NBA preparation accepts the agreed `identityLookup` context, with no lookup causing an explicit failure before any vendor read. History forwards that same scoped lookup, and detail readers use only read methods. The prepared policy opts into `nativeIdMode: "internal"` and reads explicit facts without ID decoding. Shared runtime support for the optional fourth snapshot-loader argument, job/detail contexts and internal-ID registration has not landed, so this policy is not registered with the store yet. Existing request windows, budgets and the all-league-feeds-down read policy remain in force. No live-game clock behavior has been observed.

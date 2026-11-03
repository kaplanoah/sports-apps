# NBA recorded responses

The bracket files preserve complete NBA historical responses recorded October 31, 2026.

`espn-games.json` projects the recorded ESPN event fields consumed by ingestion. It retains every event from the January listing and each sampled Finals, Play-In, Cup and scheduled day. Links, images, broadcasts and other unused fields are omitted without changing retained values. January contains 232 listings: 227 finals and five postponed games.

`espn-standings.json` projects all 30 recorded teams and their wins, losses and playoff ranks from the 2024-25 conference standings.

History tests partition the recorded month into simulated daily answers. They prove ingestion, opaque identity reuse, bounded requests and resumable storage for that inventory. They do not establish that live daily reads are complete, or that these sources remain accessible or fresh.

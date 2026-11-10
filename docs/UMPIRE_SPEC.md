# Umpire Assigner – Requirements (built)

Source: "QYBSL Umpire Assigner — Requirements Spec" Claude Doc (https://claude.ai/code/artifact/dacf9692-a9a7-441e-9961-8655d4673915) plus decisions made while building and testing, Nov 2026. This is what the current code implements.

## Scope

- Student umpires for Farm 8 and Farm 9 (spring) and the 8A/8B/9A/9B age-group teams (summer). Summer 10 and up, Minors, Majors and Babe Ruth use patched umpires from an outside assignor; the app only tracks their coverage status (Not requested / Requested / Confirmed + note). Fall Ball needs no umpires.
- Two slots per student game: plate and field. Plate is limited to umpires an admin marks plate-qualified; new umpires are field-only.

## People and sign-in

- Email + PIN for everyone (4–6 digits, scrypt-hashed, 60-day session cookie, lockout after 8 misses).
- Admins (4 seats): John, Director of Umpires (to be hired), President, Farm Director. Bootstrapped by `ADMIN_EMAILS`, editable in Settings.
- Rosters: admins upload an umpire list and a coach list (CSV) each season. Umpires on the list are approved automatically when they sign up; others wait for approval. Coaches on the list are linked to their team(s) automatically by email; others wait for an admin to link them.
- Umpire sign-up collects mobile, parent name/email/mobile, and Venmo.

## Sign-up rules

- All games open from the start; first come, first served.
- Weekly cap: 2 games per umpire per Mon–Sun week (configurable). No two overlapping games. Not both slots of one game.
- No straight drops: an umpire can only get out by posting a swap; another eligible umpire must accept; the original stays responsible until then.
- Same-day emergencies go to the Director of Umpires, who can post an urgent opening (blasts every eligible umpire) or assign anyone. Admins can override every rule after a warning.
- Umpires see their partner's first name on their own games, never other umpires' names elsewhere.

## Schedule sync

- Source: SportsEngine HQ schedule export (CSV) uploaded by an admin, or an iCal feed link. Nightly re-sync plus "Sync now". SportsEngine's public calendar feed for QYBSL is empty, so the CSV upload is the real source.
- Games are sorted into divisions by configurable rules (Settings → Advanced), falling back to the coach list's team → division.
- iCal games match by event UID; CSV games (no IDs) match by teams + date + time, and a vanished game is paired with a new game between the same teams (closest date) as a move.
- Moved games keep their umpires, who must reconfirm within 24 hours or the spot reopens. A game moved into the past keeps its umpires (no reconfirm). Cancelled games release umpires (unpaid). New games get two open slots and the pool is notified (not on the first import).
- Guard: if more than half (and more than 5) of a source's upcoming games vanish at once, nothing is cancelled and a warning is logged.
- Every change is written to a sync log.

## Reminders and messages

- Sunday evening weekly digest; day-before reminder; reconfirm requests; cancellations; swap offers; open/urgent spots; 72-hour coverage-gap digest to the Director of Umpires + admins (daily); daily coach nudge to confirm umpires worked.
- Email and text, with umpires' parents copied. Texts stay off until Twilio A2P 10DLC is approved (Settings → texts enabled).
- Every message is logged to the outbox (Messages page), including ones not sent.

## Confirmation, ratings, pay

- Either head coach confirms each umpire Worked or No-show after the game; one confirmation is enough.
- Optional 1–5 rating + comment from both coaches; admin-only; season and all-time averages; no-shows logged automatically; no automatic penalty.
- $40 per confirmed game (configurable), paid by Venmo every two weeks. Payout report lists umpire, Venmo, games and amount; unconfirmed games are held and roll forward; admins mark a period paid.

## Test copy

A second Cloud Run service with its own database, a TEST COPY banner, date-shifting for uploaded schedules, a reset button, and messages only to `higgins.qyb…` addresses.

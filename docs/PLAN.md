# League Operations – Product Plan

Source: "QYBSL League App — Plan Beyond Umpires" Claude Doc (Plan tab), decisions as of Nov 9, 2026.
Living copy: https://claude.ai/artifact/PXviRPquoZzbV8hhHMjSEb

## Overview

The umpire app grows into **Quincy Youth Baseball - League Operations**, one league app for Opening Day 2027 (assumed ~April 10, 2027): one link and one sign-in for coaches, umpires, division directors and the board. On top of umpire scheduling it adds scores and standings, playoff brackets, pitch counts with eligibility, rainouts, and Snack Shack sign-ups.

- **Divisions in scope:** Farm 8, Farm 9, Cal Ripken Minors, Cal Ripken Majors, Babe Ruth. Summer travel and softball are out of scope for now.
- **Replaces:** coaches texting scores to directors who retype them into SportsEngine; pitch counts texted to the Cal Ripken director with no shared eligibility view; rainouts passed around by phone.
- **SportsEngine stays the master** for registration, rosters, the game schedule and the public site (families see scores and standings there). The app reads SportsEngine exports and never writes back.
- **Separate apps:** the practice field scheduler and equipment tracker stay separate, linked from this app.

## Users, roles and permissions

Sign-in stays email + PIN. One person can hold several roles.

| Role | Who | Can do |
| --- | --- | --- |
| Board admin (4 seats) | John, President, Director of Umpires, Farm Director | Everything; close fields and call rainouts (admins only); upload schedules and rosters |
| Division director | Farm Director, Cal Ripken Director, Babe Ruth Director | Their division only: settle score disputes, approve other-town game scores, enter a score or pitch count for a coach who can't, see pitch violations, manage umpires (assign, urgent openings) |
| Head coach | One per team, from the coach list | Enter final score (home), confirm/dispute (away), log own pitchers, see both teams' eligibility, confirm umpires worked |
| Umpire | Student umpires (minors) | Unchanged from the umpire app |
| Snack Shack Director | One person (TBD) | Create shifts, see sign-ups |
| Volunteer | Any parent | No account; signs up via public link |

- Head coach only: no assistant/scorekeeper logins. If a coach can't enter something, the division director enters it for them.
- The coach list must cover all five divisions.

## Scores and standings

- Score entry = final score + optional home runs field (who hit them).
- Home coach enters after the game (24-hour deadline, nightly nudges). Away coach confirms or disputes; no answer in 24 hours = confirmed.
- Disputes go to the division director, who sets the final score.
- Games against other towns (Babe Ruth vs South Boston, inter-league): our coach enters; final once the division director approves. The other town never uses the app.
- Forfeits: marked by a division director, count as a 6–0 win.
- Cancelled and rained-out games need no score; makeups arrive via the SportsEngine schedule.
- Standings for all five divisions: winning percentage, tie = half a win. Tiebreakers in order: head-to-head, fewest runs allowed (full season), coin toss by the division director (recorded in the app).
- South Boston games count in Babe Ruth standings.
- Standings show to coaches, directors and the board in the app; families see standings on SportsEngine.
- Directors copy confirmed scores into SportsEngine by hand from an "enter in SE" list (confirmed, not yet marked entered).

## Playoffs and brackets

- Majors: 6-team double elimination. Winner's-bracket team is home in the final; if a second final is needed the higher seed is home.
- Minors: 5-team single elimination. Farm 8, Farm 9, Babe Ruth: single elimination.
- Every team qualifies; higher seed is home. First two weeks of June.
- Seeding from standings tiebreakers; a director can swap seeds before publishing.
- Playoff games are scheduled in SportsEngine and uploaded; the app maps each to its bracket slot so umpires, scores and pitch counts work as in the regular season.
- Instructional has no bracket. Pitch rest carries into playoffs.

## Pitch counts and eligibility (Minors and Majors)

Logging:
- Each head coach logs their own pitchers within 24 hours: player + pitches thrown, plus innings pitched (to a third) when the pitcher is 12 by league age. Nothing else.
- Players come from the SportsEngine roster export: name, jersey number, birthdate → league age. Birthdate discarded after upload; no contact details kept.
- Division director can log for a coach who can't. League games only (playoffs included); all-star, tournament and summer outings don't count.

Eligibility:
- Before a game, both coaches see each pitcher's status (available / pitches left today / resting until date), opponents included.
- Logging a count that breaks a rule shows a warning immediately. Violations email the Cal Ripken Director the same day and appear on their dashboard.
- **Warn and report, never block** saving a count.

Limits (2026 Cal Ripken Majors and Minors rulebooks, identical):

| League age | Daily max | 0 days rest | 1 day | 2 days | 3 days | 4 days |
| --- | --- | --- | --- | --- | --- | --- |
| 9–10 | 75 | 1–20 | 21–35 | 36–50 | 51–65 | 66+ |
| 11–12 | 85 | 1–20 | 21–35 | 36–50 | 51–65 | 66+ |

- League age = age on April 30 of the season year (rulebook eligibility window May 1–April 30).
- A pitcher at the daily max may finish the current batter, so a count slightly over the max shows "check: finished the batter?" rather than a violation.
- A pitcher may pitch two games in a day while under the daily max. Pitches in suspended games count.
- 12-year-old weekly cap: all 12-year-olds on a team combined may pitch at most 12 innings per Mon–Sun week; warn coach and Cal Ripken Director as it nears 12. Store innings as outs.
- Limits live in Settings so the Cal Ripken Director can change them without code changes.
- Open: confirm with the Cal Ripken Director exactly which day "4 days rest" makes a pitcher eligible.

## Rainouts and field closures

1. A board admin (admins only) closes a field, several fields, or all of Quarry Hills, for a day or a time window (including relaying a City Parks closure, or a planned closure like a multi-day infield rebuild).
2. Every game on those fields in that window is marked rained out: no score, no pitch log, no umpire pay, not in standings.
3. Both head coaches get email + text.
4. Assigned umpires and their parents get email + text (game off, unpaid).
5. The Communications Director gets one ready-to-post note listing every affected team and game, to post to families in SportsEngine.
6. The makeup is scheduled in SportsEngine; the next upload brings it in paired with the original, and its umpires get the reconfirm request.

Follow-up for John: the 2026 Cal Ripken rulebooks give weather calls to the Cal Ripken directors; their wording should change to match admins-only.

## Snack Shack volunteer sign-ups

- Snack Shack Director creates shifts (date, start/end, people needed), or copies last week.
- Parents sign up from a public link with name, email, mobile. No account.
- Day-before reminder (email; text once texting is approved) with a cancel link that reopens the spot.
- Director sees sign-ups and gets a weekly unfilled-shifts email.
- A full Quarry Hills closure cancels that day's shifts and tells the volunteers.
- Only Snack Shack shifts for now.

## Data, uploads and SportsEngine handoff

| In from SportsEngine | How | When |
| --- | --- | --- |
| Game schedule (all five divisions) | HQ schedule export CSV, uploaded by an admin; moves and cancellations reconciled | Start of season, then whenever games change |
| Player rosters (Minors, Majors) | HQ roster export CSV: name, number, birthdate | Start of season and after roster changes |
| Head coach list | CSV: name, email, mobile, team, division | Start of season |
| Umpire list | CSV, as today | Start of season |

Back to SportsEngine (by hand): confirmed scores from the "enter in SE" list; the rainout note to families.

New records: teams (division, head coach), players (Minors/Majors), scores (entered by, confirmed/disputed, final), pitch logs, standings (computed, never stored by hand), brackets, field closures, Snack Shack shifts and sign-ups.

## Messaging policy

Email and text go to coaches, umpires and volunteers. Umpires' parents are copied on umpire messages (the one exception, because umpires are minors doing paid work). No other family address is ever messaged. Families hear through SportsEngine. Expect the email volume to need the Google for Nonprofits workspace (pending) rather than a personal Gmail account (~500/day).

## Still open (owners outside the code)

- Snack Shack Director: to be named.
- Director of Umpires: to be hired.
- Twilio A2P 10DLC registration: John to start; texts stay off until approved.
- Cal Ripken rulebook weather wording.

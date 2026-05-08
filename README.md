# 🎰 Bandittomaten

A slot-machine randomizer for organizing group casino nights. Spin to decide who plays what, on which machine, for how long — and let the reels settle any disputes.

Built with vanilla HTML, CSS and JavaScript. No framework, no build step. Open `index.html` and go.

---

## Features

- **Spin-based round generator** — randomizes machine type, bet size, spin count and play style for each player
- **Archetype system** — each spin pulls from a weighted pool of archetypes (Classic Search, Provider Tribunal, Machine Tribunal, High Roller, Cursed Round, etc.)
- **Social effects** — some rounds involve a second player (who picks the machine, who sets the bet, etc.)
- **Blackjack Bonus** — progressive ramp-up mechanic (0 % → +5 %/spin) triggers a forced blackjack detour with a calculated hand bet and optional side bets
- **Session balance tracking** — enter your starting balance, record results after each round, track net profit/loss live
- **Balance sparkline** — live mini-graph in the sidebar; click to zoom into a full modal with player annotations and per-player legend
- **Big Win fanfare** — configurable threshold (default €20); triggers `bigwin.mp3` → confetti barrage + screen shake + `yay.mp3`
- **Leaderboard & awards** — biggest win, biggest loss, most sessions tracked per evening
- **History log** — every round recorded with tags, bet info, and bonus details
- **Sound design** — background music, reel stop sounds, bonus tension ramp-up, blackjack reveal sting, big win fanfare (Howler.js)
- **Confetti** — canvas-confetti on positive balance updates; overdone on big wins
- **Dark casino aesthetic** — gold accents, animated marquee lights, card-reveal animations

---

## Getting Started

1. Clone or download the repo
2. Drop your audio files in the project root (see [Sound Files](#sound-files) below)
3. Open `index.html` in a browser — no server required

```
git clone https://github.com/roger-payload/bandittomaten.git
cd bandittomaten
open index.html
```

---

## Configuration

Everything game-related lives in **`config.js`**. No need to touch `app.js` for normal customization.

| Key | What it controls |
|-----|-----------------|
| `providers` | List of slot providers used in Provider Tribunal rounds |
| `searchTerms` | Word pool for Classic Search machine names |
| `betValues` | Available bet sizes with balance thresholds and weights |
| `spinCounts` | Available spin counts with weights |
| `archetypes` | Round types — name, emoji, machine type, bet profiles, social rules |
| `betProfiles` | Named bet/spin configurations (safe grind, balanced, high roller, etc.) |
| `playStyles` | Flavor text styles attached to rounds |
| `modifiers` | Extra round conditions (e.g. "play with one hand", "eyes closed") |
| `socialEffects` | Effects involving a second player |
| `bonusRules` | Special mid-round rules that can trigger |
| `machineCategories` | Categories shown on the reels (Megaways, Bonus Buy, etc.) |
| `reelDecoys` | Fake reel items for visual flair |
| `blackjackBonus` | Chance ramp-up step, hand bet options, side bet options, hand count caps |
| `bigWinThreshold` | Euro delta above which the big win fanfare triggers (default `20`) |
| `defaultPlayers` | Pre-populated players on first load |
| `avatarPresets` | Emoji avatars available in the player editor |

---

## Sound Files

The following files are expected in the project root. Bring your own — any `.mp3` works:

| File | When it plays |
|------|--------------|
| `music_background.mp3` | Looping background music during normal play |
| `music_bonus.mp3` | Looping music during the blackjack bonus modal |
| `pop.mp3` | Each reel stopping |
| `tension_rampup.mp3` | Plays during bonus-spin reel animation |
| `bonus_drop.mp3` | First three reels landing during a bonus spin |
| `bonus_modal_reveal.mp3` | Fourth (final) reel landing during a bonus spin |
| `bigwin.mp3` | Big win ramp-up sting |
| `yay.mp3` | Crowd cheer — plays after bigwin finishes (or on normal positive balance) |

---

## Project Structure

```
bandittomaten/
├── index.html      # Markup and layout
├── styles.css      # All styling
├── app.js          # Game logic, state, rendering, audio
├── config.js       # All game data and tunable values
├── dealer.png      # Dealer image for the blackjack bonus modal
└── *.mp3           # Sound files (not included — bring your own)
```

---

## Dependencies (CDN, no install needed)

- [Howler.js 2.2.4](https://howlerjs.com/) — audio playback
- [canvas-confetti 1.9.3](https://github.com/catdad/canvas-confetti) — confetti

---

## Console Helpers

Open DevTools and use these during a session:

```js
testBonus()   // Arms the next spin to guarantee a blackjack bonus round
```

---

## License

MIT — do whatever you want with it. Just don't blame us for your losses.

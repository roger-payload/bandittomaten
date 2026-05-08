/*
 * app.js — Bandittomaten core logic
 *
 * HOW TO EXTEND THE ROUND ENGINE:
 *
 * 1. New archetype:      Add to CONFIG.archetypes in config.js. Give it a unique machineType
 *                        (or reuse 'any'/'fixed_provider'/'search_term'). The pickMachineSelection()
 *                        function below maps machineType strings to behaviour — add a new case there
 *                        if you need custom logic.
 *
 * 2. New bet profile:    Add a key to CONFIG.betProfiles. Set betTiers and spinTiers to control
 *                        which bets/spins are valid. Then list the new key in the betProfiles array
 *                        of any archetypes that should use it.
 *
 * 3. New play style:     Add to CONFIG.playStyles. List allowed bet profiles in the betProfiles array.
 *                        Add any special constraints to validateRound() below.
 *
 * 4. New validator rule: Add a check in validateRound(). Return an error string from the ERRORS
 *                        constant. The generate-with-retry loop in generateRound() handles retries.
 *
 * 5. New social effect:  Add to CONFIG.socialEffects. Use {name} placeholder for the player name.
 *                        The renderResultCards() function handles display automatically.
 *
 * Architecture:
 *   generateRound()
 *     → runGenerationPipeline()   — builds the complete round object step by step
 *     → validateRound()           — checks for invalid combinations
 *     → (retry up to 50×)
 *     → buildReels()              — converts round to slot-machine presentation model
 *   animateReels()                — drives the visual animation, then reveals result
 */

'use strict';

// ============================================================
// AUDIO
// ============================================================

const SFX = {
	reelStop:         new Howl({ src: ['pop.mp3'],                volume: 0.6  }),
	bgMusic:          new Howl({ src: ['music_background.mp3'],   volume: 0.25, loop: true }),
	bonusMusic:       new Howl({ src: ['music_bonus.mp3'],        volume: 0.45, loop: true }),
	tensionRampup:    new Howl({ src: ['tension_rampup.mp3'],     volume: 0.2  }),
	bonusDrop:        new Howl({ src: ['bonus_drop.mp3'],         volume: 0.7  }),
	bonusModalReveal: new Howl({ src: ['bonus_modal_reveal.mp3'], volume: 1    }),
	yay:              new Howl({ src: ['yay.mp3'],                volume: 0.7  }),
	bigWin:           new Howl({ src: ['bigwin.mp3'],             volume: 0.85 }),
};

let _bgMusicStarted = false;

// ============================================================
// STATE
// ============================================================

const STATE = {
	players: [],
	currentPlayerIndex: 0,
	roundHistory: [],
	currentRound: null,
	isSpinning: false,
	bonusChance: 0,       // ramps up 5% per spin, resets to 5% after bonus triggers
	selectedAvatar: '🎩',
	selectedColor: CONFIG.playerColors[0],
	editingPlayerId: null,
	session: {
		startBalance: null,   // opening balance typed at start of evening
		currentBalance: null, // most recently recorded balance
		balanceHistory: []    // { balance, delta, playerId, playerName, roundId, roundTitle, timestamp }
	}
};

const LS_KEY_PLAYERS = 'bandittomaten_players';
const LS_KEY_TURN    = 'bandittomaten_turn';
const LS_KEY_HISTORY = 'bandittomaten_history';
const LS_KEY_SESSION = 'bandittomaten_session';

// ============================================================
// UTILITY
// ============================================================

function weightedRandom(items) {
	const totalWeight = items.reduce((sum, item) => sum + (item.weight || 1), 0);
	let r = Math.random() * totalWeight;
	for (const item of items) {
		r -= (item.weight || 1);
		if (r <= 0) return item;
	}
	return items[items.length - 1];
}

function randomFrom(array) {
	if (!array || array.length === 0) return null;
	return array[Math.floor(Math.random() * array.length)];
}

function shuffleArray(arr) {
	const a = [...arr];
	for (let i = a.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		[a[i], a[j]] = [a[j], a[i]];
	}
	return a;
}

function generateId(prefix) {
	return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

function formatTime(date) {
	const d = date instanceof Date ? date : new Date(date);
	return d.toLocaleTimeString('no-NO', { hour: '2-digit', minute: '2-digit' });
}

// ============================================================
// PLAYER MANAGEMENT
// ============================================================

function createPlayer(name, avatar, color) {
	return {
		id: generateId('p'),
		name: name.trim(),
		avatar: avatar || '🎩',
		color: color || CONFIG.playerColors[0],
		stats: { roundsPlayed: 0 },
		joinedAt: new Date().toISOString()
	};
}

function addPlayer(name, avatar, color) {
	const player = createPlayer(name, avatar, color);
	STATE.players.push(player);
	saveState();
	return player;
}

function removePlayer(playerId) {
	const idx = STATE.players.findIndex(p => p.id === playerId);
	if (idx === -1) return;
	STATE.players.splice(idx, 1);
	if (STATE.currentPlayerIndex >= STATE.players.length) {
		STATE.currentPlayerIndex = Math.max(0, STATE.players.length - 1);
	}
	saveState();
}

function updatePlayer(playerId, updates) {
	const player = STATE.players.find(p => p.id === playerId);
	if (!player) return;
	Object.assign(player, updates);
	saveState();
}

function getCurrentPlayer() {
	if (STATE.players.length === 0) return null;
	return STATE.players[STATE.currentPlayerIndex % STATE.players.length];
}

function getOtherPlayers(currentPlayerId) {
	return STATE.players.filter(p => p.id !== currentPlayerId);
}

// ============================================================
// TURN SYSTEM
// ============================================================

function advanceTurn() {
	if (STATE.players.length === 0) return;
	STATE.currentPlayerIndex = (STATE.currentPlayerIndex + 1) % STATE.players.length;
	saveState();
}

function resetNight() {
	STATE.roundHistory = [];
	STATE.currentRound = null;
	STATE.currentPlayerIndex = 0;
	STATE.isSpinning = false;
	STATE.bonusChance = 0;
	STATE.session = { startBalance: null, currentBalance: null, balanceHistory: [] };
	for (const p of STATE.players) {
		if (p.stats) p.stats.roundsPlayed = 0;
	}
	saveState();
	renderApp();
}

// ============================================================
// SESSION BALANCE (shared — one account for the whole group)
// ============================================================

function setSessionStart(balance) {
	STATE.session.startBalance = balance;
	STATE.session.currentBalance = balance;
	STATE.session.balanceHistory = [];
	saveState();
	renderSessionPanel();
	renderLeaderboard();
}

function recordSessionBalance(newBalance, roundId, roundTitle, playerId, playerName) {
	const prev = STATE.session.currentBalance !== null
		? STATE.session.currentBalance
		: STATE.session.startBalance;
	const delta = prev !== null ? +(newBalance - prev).toFixed(2) : 0;

	STATE.session.currentBalance = newBalance;
	STATE.session.balanceHistory.push({
		balance: newBalance,
		delta,
		playerId: playerId || null,
		playerName: playerName || null,
		roundId: roundId || null,
		roundTitle: roundTitle || null,
		timestamp: new Date().toISOString()
	});

	// Attach result to the matching round so history and result section can display it
	if (roundId) {
		const histRound = STATE.roundHistory.find(r => r.id === roundId);
		if (histRound) { histRound.balanceSaved = newBalance; histRound.balanceDelta = delta; }
		if (STATE.currentRound && STATE.currentRound.id === roundId) {
			STATE.currentRound.balanceSaved = newBalance;
			STATE.currentRound.balanceDelta = delta;
		}
	}

	// 🎉 Confetti for positive balance changes
	if (delta > 0 && typeof confetti === 'function') {
		if (delta >= CONFIG.bigWinThreshold) {
			triggerBigWin(delta);
		} else {
			const intensity = Math.min(60 + Math.round(delta * 8), 200);
			confetti({
				particleCount: intensity,
				spread: 75,
				origin: { y: 0.65 },
				colors: ['#ffc83c', '#2ecc71', '#00e5ff', '#f15bb5', '#ffffff']
			});
			SFX.yay.play();
		}
	}

	saveState();
	renderSessionPanel();
	renderLeaderboard();
}

function renderSessionPanel() {
	const startForm   = document.getElementById('sessionStartForm');
	const balDisplay  = document.getElementById('sessionBalanceDisplay');
	if (!startForm || !balDisplay) return;

	if (STATE.session.startBalance === null) {
		startForm.style.display  = '';
		balDisplay.style.display = 'none';
		return;
	}

	startForm.style.display  = 'none';
	balDisplay.style.display = '';

	const current = STATE.session.currentBalance;
	const start   = STATE.session.startBalance;
	const net     = current !== null ? +(current - start).toFixed(2) : 0;

	const currentEl = document.getElementById('sessionCurrentValue');
	const netEl     = document.getElementById('sessionNetValue');
	const startEl   = document.getElementById('sessionStartLabel');

	if (currentEl) currentEl.textContent = `€${current.toFixed(2)}`;
	if (startEl)   startEl.textContent   = `€${start.toFixed(2)}`;
	if (netEl) {
		const sign = net >= 0 ? '+' : '';
		netEl.textContent = `${sign}€${net.toFixed(2)}`;
		netEl.className   = 'session-balance-net' + (net > 0 ? ' pos' : net < 0 ? ' neg' : '');
	}

	renderBalanceGraph();
}

// ============================================================
// BALANCE SPARKLINE GRAPH
// ============================================================

/**
 * Build the SVG string for the balance sparkline.
 * @param {object} opts
 *   W, H         – canvas size in px (viewBox units)
 *   padL/R/T/B   – padding
 *   annoFontSize – font-size for avatar annotations
 *   sigMul       – multiplier for significant-delta threshold (default 0.12)
 *   strokeWidth  – line stroke-width (default 1.8)
 *   dotR         – radius of data dots (default 2.5)
 */
function buildBalanceGraphSVG(opts = {}) {
	const {
		W            = 260,
		H            = 80,
		padL         = 8,
		padR         = 8,
		padT         = 22,
		padB         = 12,
		annoFontSize = 12,
		sigMul       = 0.12,
		strokeWidth  = 1.8,
		dotR         = 2.5,
	} = opts;

	const history = STATE.session.balanceHistory;
	const start   = STATE.session.startBalance;

	const pts    = [{ balance: start, delta: 0, playerId: null }].concat(history);
	const plotW  = W - padL - padR;
	const plotH  = H - padT - padB;

	const balances  = pts.map(p => p.balance);
	const dataMin   = Math.min(...balances);
	const dataMax   = Math.max(...balances);
	const dataRange = dataMax - dataMin || (start * 0.1) || 10;
	const margin    = dataRange * 0.12;
	const yMin      = dataMin - margin;
	const yMax      = dataMax + margin;
	const yRange    = yMax - yMin;

	const xOf = i => padL + (pts.length <= 1 ? plotW / 2 : (i / (pts.length - 1)) * plotW);
	const yOf = b => padT + (1 - (b - yMin) / yRange) * plotH;

	const net     = (STATE.session.currentBalance ?? start) - start;
	const lineCol = net > 0 ? '#2ecc71' : net < 0 ? '#e74c3c' : '#a09070';
	const fillCol = net > 0 ? 'rgba(46,204,113,0.12)' : net < 0 ? 'rgba(231,76,60,0.12)' : 'rgba(160,144,112,0.08)';

	const pathD = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${xOf(i).toFixed(1)},${yOf(p.balance).toFixed(1)}`).join(' ');
	const fillD = pathD +
		` L${xOf(pts.length - 1).toFixed(1)},${(padT + plotH).toFixed(1)}` +
		` L${xOf(0).toFixed(1)},${(padT + plotH).toFixed(1)} Z`;

	const refY    = yOf(start).toFixed(1);
	const refLine = `<line x1="${padL}" y1="${refY}" x2="${W - padR}" y2="${refY}" stroke="rgba(255,255,255,0.15)" stroke-width="1" stroke-dasharray="3,3"/>`;

	// Y-axis labels (start value + current value) for large view
	let yAxisHtml = '';
	if (opts.showYLabels) {
		const cur = STATE.session.currentBalance ?? start;
		yAxisHtml += `<text x="${padL}" y="${padT - 6}" font-size="9" fill="rgba(255,255,255,0.45)" text-anchor="start">€${start.toFixed(0)}</text>`;
		if (dataMax !== dataMin) {
			yAxisHtml += `<text x="${padL}" y="${padT - 6}" font-size="9" fill="rgba(255,255,255,0.45)" text-anchor="start" dy="0"></text>`;
			const topY = yOf(dataMax).toFixed(1);
			const botY = yOf(dataMin).toFixed(1);
			yAxisHtml += `<text x="${padL + 1}" y="${topY}" font-size="9" fill="rgba(255,255,255,0.35)" dominant-baseline="auto">€${dataMax.toFixed(0)}</text>`;
			yAxisHtml += `<text x="${padL + 1}" y="${botY}" font-size="9" fill="rgba(255,255,255,0.35)" dominant-baseline="hanging">€${dataMin.toFixed(0)}</text>`;
		}
	}

	// Dots
	let dotsHtml = '';
	for (let i = 0; i < pts.length; i++) {
		const p   = pts[i];
		const cx  = xOf(i).toFixed(1);
		const cy  = yOf(p.balance).toFixed(1);
		const col = i === 0 ? 'rgba(160,144,112,0.5)'
		          : p.delta > 0 ? '#2ecc71'
		          : p.delta < 0 ? '#e74c3c'
		          : '#a09070';
		const r = i === 0 ? dotR * 0.75 : dotR;
		dotsHtml += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${col}"/>`;
	}

	// Avatar annotations at significant deltas
	const sigThreshold = Math.max(3, dataRange * sigMul);
	let annoHtml = '';
	for (let i = 1; i < pts.length; i++) {
		const p = pts[i];
		if (Math.abs(p.delta) < sigThreshold) continue;
		if (!p.playerId) continue;
		const player = STATE.players.find(pl => pl.id === p.playerId);
		if (!player) continue;
		const cx       = xOf(i);
		const cy       = yOf(p.balance);
		const isUp     = p.delta > 0;
		const textY    = isUp ? cy - annoFontSize * 0.7 : cy + annoFontSize * 0.7;
		const baseline = isUp ? 'auto' : 'hanging';
		annoHtml += `<text x="${cx.toFixed(1)}" y="${textY.toFixed(1)}" text-anchor="middle" font-size="${annoFontSize}" dominant-baseline="${baseline}" style="user-select:none">${player.avatar}</text>`;
	}

	return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;display:block">
		${refLine}
		${yAxisHtml}
		<path d="${fillD}" fill="${fillCol}"/>
		<path d="${pathD}" fill="none" stroke="${lineCol}" stroke-width="${strokeWidth}" stroke-linejoin="round" stroke-linecap="round"/>
		${dotsHtml}
		${annoHtml}
	</svg>`;
}

function renderBalanceGraph() {
	const wrap = document.getElementById('balanceGraphWrap');
	if (!wrap) return;

	const history = STATE.session.balanceHistory;
	const start   = STATE.session.startBalance;

	if (start === null || history.length < 1) {
		wrap.style.display = 'none';
		return;
	}
	wrap.style.display = '';

	wrap.innerHTML = buildBalanceGraphSVG({ W: 260, H: 80, padL: 8, padR: 8, padT: 22, padB: 12, annoFontSize: 12 });
}

// ---------------------------------------------------------------
// GRAPH ZOOM MODAL
// ---------------------------------------------------------------

function openGraphModal() {
	const history = STATE.session.balanceHistory;
	const start   = STATE.session.startBalance;
	if (start === null || history.length < 1) return;

	// Build large SVG
	const svgHtml = buildBalanceGraphSVG({
		W: 800, H: 340,
		padL: 20, padR: 20, padT: 36, padB: 24,
		annoFontSize: 22,
		sigMul: 0.08,
		strokeWidth: 3,
		dotR: 5.5,
		showYLabels: true,
	});

	// Per-player legend
	const net     = (STATE.session.currentBalance ?? start) - start;
	const players = STATE.players.filter(pl => hasPlayerHistory(pl.id));
	let legendHtml = '';
	if (players.length) {
		const items = players.map(pl => {
			const pNet = getPlayerNetProfit(pl.id);
			const sign = pNet >= 0 ? '+' : '';
			const cls  = pNet > 0 ? 'pos' : pNet < 0 ? 'neg' : '';
			return `<div class="graph-legend-item">
				<span class="graph-legend-avatar">${pl.avatar}</span>
				<span class="graph-legend-name">${pl.name}</span>
				<span class="graph-legend-delta ${cls}">${sign}€${(pNet ?? 0).toFixed(2)}</span>
			</div>`;
		}).join('');
		legendHtml = `<div class="graph-legend">${items}</div>`;
	}

	// Net summary
	const sign    = net >= 0 ? '+' : '';
	const netCls  = net > 0 ? 'pos' : net < 0 ? 'neg' : '';
	const netHtml = `<div class="graph-modal-net ${netCls}">Kveldens resultat: <strong>${sign}€${net.toFixed(2)}</strong></div>`;

	// Reuse the existing modal overlay
	const overlay = document.getElementById('modalOverlay');
	const modal   = document.getElementById('playerModal');
	document.getElementById('modalTitle').textContent = '📈 Kveldens Balansegraf';
	modal.classList.add('modal--graph');

	document.getElementById('modalBody').innerHTML = `
		<div class="graph-modal-svg">${svgHtml}</div>
		${netHtml}
		${legendHtml}
	`;

	overlay.style.display = 'flex';
}

function closeGraphModal() {
	const modal = document.getElementById('playerModal');
	modal.classList.remove('modal--graph');
	closeModal();
}

// ============================================================
// BIG WIN FANFARE
// ============================================================

function triggerBigWin(delta) {
	// 1. Stop bg music cleanly, then play bigwin.mp3
	SFX.bgMusic.fade(0.25, 0, 350);
	setTimeout(() => SFX.bgMusic.stop(), 350);

	// Remove any previous end-listener so double-triggers don't stack
	SFX.bigWin.off('end');
	SFX.bigWin.stop();

	SFX.bigWin.once('end', () => {
		// Restore bg music — single instance guaranteed by stop() first
		SFX.bgMusic.stop();
		SFX.bgMusic.volume(0.25);
		SFX.bgMusic.play();

		// 2a. yay + shake kick off simultaneously
		SFX.yay.play();

		const app = document.getElementById('app');
		app.classList.remove('bigwin-shake');
		void app.offsetWidth;
		app.classList.add('bigwin-shake');
		app.addEventListener('animationend', () => app.classList.remove('bigwin-shake'), { once: true });

		// 2b. Confetti waves — all timed from the moment bigwin ends
		const colors = ['#ffc83c', '#2ecc71', '#00e5ff', '#f15bb5', '#ffffff', '#ff6b6b'];
		const burst = opts => confetti({ ...opts, colors });

		burst({ particleCount: 180, spread: 100, origin: { x: 0.5, y: 0.55 }, scalar: 1.3 });

		setTimeout(() => {
			burst({ particleCount: 120, angle:  60, spread: 70, origin: { x: 0, y: 0.65 } });
			burst({ particleCount: 120, angle: 120, spread: 70, origin: { x: 1, y: 0.65 } });
		}, 300);

		setTimeout(() => {
			burst({ particleCount: 200, spread: 160, origin: { x: 0.5, y: 0.3 }, gravity: 0.7, scalar: 0.9 });
		}, 700);

		setTimeout(() => {
			burst({ particleCount: 150, spread: 180, origin: { x: 0.3, y: 0.2 }, gravity: 0.6 });
			burst({ particleCount: 150, spread: 180, origin: { x: 0.7, y: 0.2 }, gravity: 0.6 });
		}, 1200);
	});
	SFX.bigWin.play();
}

// ============================================================
// PER-PLAYER STATS (derived from shared session history)
// ============================================================

function getPlayerDeltas(playerId) {
	return STATE.session.balanceHistory
		.filter(h => h.playerId === playerId)
		.map(h => h.delta);
}

function hasPlayerHistory(playerId) {
	return getPlayerDeltas(playerId).length >= 1;
}

function getPlayerNetProfit(playerId) {
	const deltas = getPlayerDeltas(playerId);
	if (deltas.length === 0) return null;
	return +deltas.reduce((sum, d) => sum + d, 0).toFixed(2);
}

function getPlayerBiggestGain(playerId) {
	const deltas = getPlayerDeltas(playerId);
	return deltas.length ? Math.max(...deltas) : null;
}

function getPlayerBiggestLoss(playerId) {
	const deltas = getPlayerDeltas(playerId);
	return deltas.length ? Math.min(...deltas) : null;
}

function getPlayerLongestStreak(playerId, direction) {
	const deltas = getPlayerDeltas(playerId);
	let best = 0, cur = 0;
	for (const d of deltas) {
		const match = direction === 'up' ? d > 0 : d < 0;
		cur = match ? cur + 1 : 0;
		if (cur > best) best = cur;
	}
	return best;
}

// Sum of absolute deltas — how much total volatility a player caused
function getPlayerVolatility(playerId) {
	const deltas = getPlayerDeltas(playerId);
	if (deltas.length === 0) return null;
	return +deltas.reduce((sum, d) => sum + Math.abs(d), 0).toFixed(2);
}

// Net profit per round played
function getPlayerEfficiency(playerId) {
	const net    = getPlayerNetProfit(playerId);
	const player = STATE.players.find(p => p.id === playerId);
	const rounds = player && player.stats ? player.stats.roundsPlayed : 0;
	if (net === null || rounds === 0) return null;
	return +(net / rounds).toFixed(2);
}

// From lowest cumulative running total to highest subsequent — the comeback
function getPlayerBiggestRecovery(playerId) {
	const deltas = getPlayerDeltas(playerId);
	if (deltas.length < 2) return null;
	let runningSum = 0, minSum = 0, maxRecovery = 0;
	for (const d of deltas) {
		runningSum += d;
		if (runningSum < minSum) minSum = runningSum;
		const recovery = runningSum - minSum;
		if (recovery > maxRecovery) maxRecovery = recovery;
	}
	return maxRecovery > 0 ? +maxRecovery.toFixed(2) : null;
}

// ============================================================
// ROUND ENGINE — GENERATION PIPELINE
// ============================================================

const MAX_RETRIES = 50;

function generateRound() {
	const player = getCurrentPlayer();
	if (!player) return null;

	for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
		const round = runGenerationPipeline(player, STATE.players);
		const validation = validateRound(round);
		if (validation.valid) {
			round.reels = buildReels(round);
			// Ramp-up bonus mechanic: chance increases 5% each spin, resets to 5% after trigger
			const cfg = CONFIG.blackjackBonus;
			STATE.bonusChance = (STATE.bonusChance ?? 0) + cfg.chanceStep;
			if (STATE._forceBonusNextSpin || Math.random() < STATE.bonusChance) {
				STATE._forceBonusNextSpin = false;
				STATE.bonusChance  = cfg.chanceOnReset;
				round.isBonus      = true;
				round.bonusDetails = buildBlackjackBonus(STATE.session.currentBalance ?? STATE.session.startBalance);
			}
			return round;
		}
	}

	return buildSafeDefaultRound(player);
}

function runGenerationPipeline(player, allPlayers) {
	const otherPlayers = getOtherPlayers(player.id);

	const eligibleArchetypes = CONFIG.archetypes.filter(a =>
		!a.requiresOtherPlayer || otherPlayers.length > 0
	);
	const archetype = weightedRandom(eligibleArchetypes);

	const betProfileId = archetype.forceBetProfile
		? archetype.forceBetProfile
		: randomFrom(archetype.betProfiles || ['balanced']);
	const betProfile = CONFIG.betProfiles[betProfileId] || CONFIG.betProfiles.balanced;

	const balance         = STATE.session.currentBalance ?? STATE.session.startBalance;
	const bet             = pickBet(betProfile, balance);
	const spins           = pickSpinCount(betProfile, bet);
	const machineSelection = pickMachineSelection(archetype, otherPlayers);
	const playStyle       = pickPlayStyle(betProfile, spins);
	const socialEffect    = pickSocialEffect(archetype, otherPlayers, machineSelection);
	const modifier        = pickModifier(archetype, betProfile, otherPlayers);
	const bonusRule       = pickBonusRule();

	const involvedPlayerIds = [];
	if (machineSelection.involvedPlayerId) involvedPlayerIds.push(machineSelection.involvedPlayerId);
	if (socialEffect && socialEffect.playerId) involvedPlayerIds.push(socialEffect.playerId);
	if (modifier && modifier.involvedPlayerId) involvedPlayerIds.push(modifier.involvedPlayerId);

	const title   = buildTitle(archetype, player, machineSelection, socialEffect);
	const summary = buildSummary(player, spins, bet, machineSelection, playStyle, bonusRule, modifier);

	return {
		id: generateId('round'),
		createdAt: new Date().toISOString(),
		currentPlayerId: player.id,
		currentPlayerName: player.name,
		currentPlayerAvatar: player.avatar,
		currentPlayerColor: player.color,
		archetype: { id: archetype.id, name: archetype.name, nameNo: archetype.nameNo, emoji: archetype.emoji },
		betProfile: { id: betProfile.id, name: betProfile.name, nameNo: betProfile.nameNo },
		spins,
		bet,
		machineSelection,
		playStyle,
		socialEffect,
		modifier,
		bonusRule,
		involvedPlayerIds: [...new Set(involvedPlayerIds)],
		title,
		summary,
		reels: []
	};
}

// ---- Individual pipeline steps ----

function pickBet(betProfile, balance) {
	let eligible = CONFIG.betValues.filter(b => {
		if (!betProfile.betTiers.includes(b.tier)) return false;
		if (balance != null) {
			if (b.minBalance != null && balance < b.minBalance) return false;
			if (b.maxBalance != null && balance >= b.maxBalance) return false;
		}
		return true;
	});

	// Relax balance constraints if they eliminated all options
	if (eligible.length === 0) {
		eligible = CONFIG.betValues.filter(b => betProfile.betTiers.includes(b.tier));
	}

	return weightedRandom(eligible);
}

function pickSpinCount(betProfile, bet) {
	let tiers = [...betProfile.spinTiers];

	// High bet cannot combine with many spins
	if (bet.tier === 'high') {
		tiers = tiers.filter(t => t !== 'many');
		if (tiers.length === 0) tiers = ['medium'];
	}

	let eligible = CONFIG.spinCounts.filter(s => tiers.includes(s.tier));

	// Respect per-bet spin cap (€2 → max 25 spins, €3 → max 25 spins)
	if (bet.maxSpinsPerRound != null) {
		eligible = eligible.filter(s => s.value <= bet.maxSpinsPerRound);
	}

	if (eligible.length === 0) eligible = [CONFIG.spinCounts[0]];

	return weightedRandom(eligible);
}

function pickMachineSelection(archetype, otherPlayers) {
	const type = archetype.machineType;

	if (type === 'search_term') {
		const term = randomFrom(CONFIG.searchTerms);
		return { type: 'search_term', searchTerm: term, label: `Søk: ${term}` };
	}

	if (type === 'provider_by_player') {
		const other = randomFrom(otherPlayers);
		if (!other) return pickFallbackMachine();
		return {
			type: 'provider_by_player',
			involvedPlayerId: other.id,
			involvedPlayerName: other.name,
			involvedPlayerAvatar: other.avatar,
			label: `${other.name} velger provider`
		};
	}

	if (type === 'machine_by_player') {
		const other = randomFrom(otherPlayers);
		if (!other) return pickFallbackMachine();
		return {
			type: 'machine_by_player',
			involvedPlayerId: other.id,
			involvedPlayerName: other.name,
			involvedPlayerAvatar: other.avatar,
			label: `${other.name} velger maskinen`
		};
	}

	// category_<id> — look up in CONFIG.machineCategories
	if (type.startsWith('category_')) {
		const catId = type.slice('category_'.length);
		const cat   = CONFIG.machineCategories.find(c => c.id === catId);
		if (cat) return { type: 'category', category: cat.id, label: `${cat.label} ${cat.emoji}` };
	}

	if (type === 'fixed_provider') {
		const provider = randomFrom(CONFIG.providers);
		return { type: 'fixed_provider', provider, label: `Provider: ${provider}` };
	}

	if (type === 'any' || type === 'chaos') {
		const roll = Math.random();
		if (roll < 0.38) {
			const term = randomFrom(CONFIG.searchTerms);
			return { type: 'search_term', searchTerm: term, label: `Søk: ${term}` };
		} else if (roll < 0.72) {
			const provider = randomFrom(CONFIG.providers);
			return { type: 'fixed_provider', provider, label: `Provider: ${provider}` };
		} else {
			const cats = CONFIG.machineCategories.map(c => ({
				type: 'category', category: c.id, label: `${c.label} ${c.emoji}`
			}));
			return randomFrom(cats);
		}
	}

	return pickFallbackMachine();
}

function pickFallbackMachine() {
	const term = randomFrom(CONFIG.searchTerms);
	return { type: 'search_term', searchTerm: term, label: `Søk: ${term}` };
}

function pickPlayStyle(betProfile, spins) {
	let eligible = CONFIG.playStyles.filter(ps => ps.betProfiles.includes(betProfile.id));

	if (!betProfile.allowManualOnly || betProfile.id === 'safe_grind') {
		eligible = eligible.filter(ps => ps.id !== 'manual_only');
	}

	if (spins.tier === 'many' && !['high_roller', 'cursed'].includes(betProfile.id)) {
		eligible = eligible.filter(ps => ps.id !== 'manual_only');
	}

	if (betProfile.preferManual) {
		eligible = eligible.map(ps => ({
			...ps,
			weight: ps.id.includes('manual') ? (ps.weight || 10) * 2 : ps.weight
		}));
	}

	if (eligible.length === 0) eligible = CONFIG.playStyles.filter(ps => ps.id === 'free_choice');

	return weightedRandom(eligible);
}

function pickSocialEffect(archetype, otherPlayers, machineSelection) {
	if (!archetype.allowSocialEffect) return null;
	if (otherPlayers.length === 0) return null;

	if (machineSelection.type === 'machine_by_player') return null;

	if (!archetype.requireSocialEffect && Math.random() < 0.45) return null;

	const other = randomFrom(otherPlayers);

	let eligible = [...CONFIG.socialEffects];

	if (machineSelection.type === 'provider_by_player') {
		eligible = eligible.filter(se => !['provider_picker', 'machine_picker'].includes(se.id));
	}

	if (eligible.length === 0) return null;

	const effect = weightedRandom(eligible);
	const label  = effect.label.replace('{name}', other.name);

	return {
		id: effect.id,
		type: effect.type,
		playerId: other.id,
		playerName: other.name,
		playerAvatar: other.avatar,
		label
	};
}

function pickModifier(archetype, betProfile, otherPlayers) {
	let eligible = CONFIG.modifiers.filter(m => m.betProfiles.includes(betProfile.id));

	if (otherPlayers.length === 0) {
		eligible = eligible.filter(m => !m.requiresOtherPlayer);
	}

	if (eligible.length === 0) return CONFIG.modifiers.find(m => m.id === 'no_modifier');

	const modifier = weightedRandom(eligible);

	if (modifier.requiresOtherPlayer && otherPlayers.length > 0) {
		const other = randomFrom(otherPlayers);
		return { ...modifier, involvedPlayerId: other.id, involvedPlayerName: other.name };
	}

	return modifier;
}

function pickBonusRule() {
	return weightedRandom(CONFIG.bonusRules);
}

// ---- Title and summary builders ----

function buildTitle(archetype, player, machineSelection) {
	const template = archetype.titleTemplate || '{nameNo}';
	const resolved = template
		.replace('{player}',         player.name)
		.replace('{nameNo}',         archetype.nameNo || archetype.name)
		.replace('{involvedPlayer}', (machineSelection && machineSelection.involvedPlayerName) || '');
	return `${archetype.emoji} ${resolved}`;
}

function buildSummary(player, spins, bet, machineSelection, playStyle, bonusRule, modifier) {
	const parts = [];

	parts.push(`${player.name} skal spille ${spins.label} på ${bet.label}.`);
	parts.push(`${machineSelection.label}.`);

	if (playStyle.id !== 'free_choice') {
		parts.push(playStyle.labelNo || playStyle.label);
	}

	if (bonusRule && bonusRule.id !== 'no_bonus_rule') {
		parts.push(bonusRule.label);
	}

	if (modifier && modifier.id !== 'no_modifier') {
		parts.push(`Regel: ${modifier.labelNo || modifier.label}.`);
	}

	return parts.join(' ');
}

// ============================================================
// VALIDATOR
// ============================================================

const ERRORS = {
	HIGH_BET_MANY_SPINS:            'HIGH_BET_MANY_SPINS',
	MANUAL_ONLY_SAFE_MANY_SPINS:    'MANUAL_ONLY_SAFE_MANY_SPINS',
	PROVIDER_PLAYER_FIXED:          'PROVIDER_PLAYER_FIXED',
	MACHINE_PLAYER_WITH_CONSTRAINT: 'MACHINE_PLAYER_WITH_CONSTRAINT',
	AUTOPLAY_AND_MANUAL_ONLY:       'AUTOPLAY_AND_MANUAL_ONLY',
	NO_ELIGIBLE_PLAY_STYLE:         'NO_ELIGIBLE_PLAY_STYLE',
	TOTAL_SPEND_TOO_HIGH:           'TOTAL_SPEND_TOO_HIGH'
};

function validateRound(round) {
	const errors = [];
	const { bet, spins, machineSelection, playStyle, betProfile } = round;

	if (bet.tier === 'high' && spins.tier === 'many') {
		errors.push(ERRORS.HIGH_BET_MANY_SPINS);
	}

	if (playStyle.id === 'manual_only') {
		if (betProfile.id === 'safe_grind') {
			errors.push(ERRORS.MANUAL_ONLY_SAFE_MANY_SPINS);
		}
		if (spins.tier === 'many' && !['high_roller', 'cursed'].includes(betProfile.id)) {
			errors.push(ERRORS.MANUAL_ONLY_SAFE_MANY_SPINS);
		}
	}

	if (machineSelection.type === 'provider_by_player' && machineSelection.provider) {
		errors.push(ERRORS.PROVIDER_PLAYER_FIXED);
	}

	if (machineSelection.type === 'machine_by_player') {
		if (machineSelection.searchTerm || machineSelection.category || machineSelection.provider) {
			errors.push(ERRORS.MACHINE_PLAYER_WITH_CONSTRAINT);
		}
	}

	if (playStyle.id === 'autoplay_required' && playStyle.id === 'manual_only') {
		errors.push(ERRORS.AUTOPLAY_AND_MANUAL_ONLY);
	}

	// Total spend cap — prevents e.g. €3 × 75 spins (€225)
	const totalSpend = (bet.numeric || 0) * spins.value;
	if (totalSpend > 100) {
		errors.push(ERRORS.TOTAL_SPEND_TOO_HIGH);
	}

	return { valid: errors.length === 0, errors };
}

// ============================================================
// SAFE DEFAULT ROUND (fallback after 50 failed retries)
// ============================================================

function buildSafeDefaultRound(player) {
	const archetype  = CONFIG.archetypes.find(a => a.id === 'classic_search');
	const betProfile = CONFIG.betProfiles.balanced;
	const bet        = CONFIG.betValues.find(b => b.value === '€0.40');
	const spins      = CONFIG.spinCounts.find(s => s.value === 20);
	const machine    = { type: 'search_term', searchTerm: 'Wild', label: 'Søk: Wild' };
	const style      = CONFIG.playStyles.find(ps => ps.id === 'free_choice');
	const bonus      = CONFIG.bonusRules.find(br => br.id === 'bonus_toast');
	const modifier   = CONFIG.modifiers.find(m => m.id === 'no_modifier');

	const round = {
		id: generateId('round'),
		createdAt: new Date().toISOString(),
		currentPlayerId: player.id,
		currentPlayerName: player.name,
		currentPlayerAvatar: player.avatar,
		currentPlayerColor: player.color,
		archetype: { id: archetype.id, name: archetype.name, nameNo: archetype.nameNo, emoji: archetype.emoji },
		betProfile: { id: betProfile.id, name: betProfile.name, nameNo: betProfile.nameNo },
		spins, bet,
		machineSelection: machine,
		playStyle: style,
		socialEffect: null,
		modifier,
		bonusRule: bonus,
		involvedPlayerIds: [],
		title: `🔍 ${player.name} søker lykken`,
		summary: `${player.name} skal spille 20 spins på €0.40. Søk: Wild. Bonus = alle skåler! 🥂`
	};

	round.reels = buildReels(round);
	return round;
}

// ============================================================
// BLACKJACK BONUS CALCULATOR
// ============================================================

function buildBlackjackBonus(balance) {
	const cfg = CONFIG.blackjackBonus;
	const bal = balance ?? 200;

	// Number of side bets (0 = none, 1 = left only, 2 = both)
	// Weighted heavily towards having sidebets — two is the norm, none is rare
	const sideBetCount = weightedRandom([
		{ value: 0, weight: 12 },
		{ value: 1, weight: 28 },
		{ value: 2, weight: 60 }
	]).value;

	const leftSidebet  = sideBetCount >= 1 ? randomFrom(cfg.sideBetOptions) : null;
	const rightSidebet = sideBetCount >= 2 ? randomFrom(cfg.sideBetOptions) : null;
	const sidebetTotal = (leftSidebet ?? 0) + (rightSidebet ?? 0);

	// Pick hand bet affordable given balance
	const maxBudget = bal * cfg.maxHandsMultiplier;
	const eligible  = cfg.handBetOptions.filter(b => (b + sidebetTotal) <= maxBudget);
	const handBet   = eligible.length > 0 ? randomFrom(eligible) : cfg.handBetOptions[0];

	const totalPerHand = handBet + sidebetTotal;
	const hands = Math.max(
		cfg.minHands,
		Math.min(cfg.maxHands, Math.floor(maxBudget / totalPerHand))
	);

	return { handBet, leftSidebet, rightSidebet, hands, totalPerHand };
}

// ============================================================
// REEL BUILDER — converts round object to slot-machine presentation
// ============================================================

function buildReels(round) {
	const allBetLabels  = CONFIG.betValues.map(b => b.label);
	const allSpinLabels = CONFIG.spinCounts.map(s => s.label);

	const machineDecoys  = CONFIG.reelDecoys.machine;
	const modifierDecoys = CONFIG.reelDecoys.modifier;

	// Strip emoji from category labels for cleaner reel display
	const finalMachineLabel  = round.machineSelection.label.replace(/\p{Emoji}\s*/gu, '').trim();
	const finalModifierLabel = round.playStyle.labelNo || round.playStyle.label;

	return [
		{
			id: 'spins',
			label: 'Spins',
			emoji: '🎯',
			final: round.spins.label,
			decoys: allSpinLabels.filter(v => v !== round.spins.label)
		},
		{
			id: 'bet',
			label: 'Bet',
			emoji: '💶',
			final: round.bet.label,
			decoys: allBetLabels.filter(v => v !== round.bet.label)
		},
		{
			id: 'machine',
			label: 'Machine',
			emoji: '🎰',
			final: finalMachineLabel,
			decoys: machineDecoys.filter(v => v !== finalMachineLabel)
		},
		{
			id: 'modifier',
			label: 'Modifier',
			emoji: '⚡',
			final: finalModifierLabel,
			decoys: modifierDecoys.filter(v => v !== finalModifierLabel)
		}
	];
}

// ============================================================
// SLOT ANIMATION
// ============================================================

const REEL_ITEM_H    = 72; // must match --reel-item-height in CSS
const SPIN_DURATIONS = [2200, 2900, 3600, 4300]; // staggered stop times per reel

function initReels() {
	const container = document.getElementById('slotReels');
	if (!container) return;

	container.innerHTML = '';

	const reelDefs = [
		{ id: 'spins',    label: 'Spins',   emoji: '🎯' },
		{ id: 'bet',      label: 'Bet',     emoji: '💶' },
		{ id: 'machine',  label: 'Machine', emoji: '🎰' },
		{ id: 'modifier', label: 'Modifier',emoji: '⚡' }
	];

	for (const def of reelDefs) {
		const reel = document.createElement('div');
		reel.className = 'reel';
		reel.id = `reel-${def.id}`;
		reel.innerHTML = `
			<div class="reel-header">${def.emoji} ${def.label}</div>
			<div class="reel-window">
				<div class="reel-window-mask-top"></div>
				<div class="reel-window-mask-bottom"></div>
				<div class="reel-strip" id="strip-${def.id}"></div>
			</div>
		`;
		container.appendChild(reel);
		setReelIdle(reel, def.label);
	}
}

function setReelIdle(reelEl, placeholder) {
	const strip = reelEl.querySelector('.reel-strip');
	if (!strip) return;
	strip.style.transition = 'none';
	strip.style.transform  = 'translateY(0)';
	strip.innerHTML = [
		`<div class="reel-item" style="color:var(--text-dim)">—</div>`,
		`<div class="reel-item" style="color:var(--text-secondary)">?</div>`,
		`<div class="reel-item" style="color:var(--text-dim)">—</div>`
	].join('');
	reelEl.classList.remove('spinning', 'landed');
}

function buildStripItems(decoys, finalValue, spinCount) {
	// spinCount decoy items, then the final value (centre target), then 2 padding items
	const shuffled = shuffleArray(decoys.length > 0 ? [...decoys] : ['—']);
	const items = [];
	for (let i = 0; i < spinCount; i++) {
		items.push(shuffled[i % shuffled.length]);
	}
	items.push(finalValue);           // index = spinCount  (centre)
	items.push(shuffled[0] || '—');   // index = spinCount + 1
	items.push(shuffled[1] || '—');   // index = spinCount + 2
	return items;
}

const BONUS_SPIN_DURATIONS = [3600, 4700, 5800, 6900];

function animateAllReels(reels, onComplete, isBonus) {
	const app         = document.getElementById('app');
	const slotMachine = document.getElementById('slotMachine');
	let landedCount   = 0;
	const durations   = isBonus ? BONUS_SPIN_DURATIONS : SPIN_DURATIONS;

	// Bonus: stop bg music, start tension ramp
	if (isBonus) {
		SFX.bgMusic.fade(0.25, 0, 600);
		setTimeout(() => SFX.bgMusic.stop(), 650);
		SFX.tensionRampup.play();
	}

	reels.forEach((reelData, i) => {
		const reelEl = document.getElementById(`reel-${reelData.id}`);
		if (!reelEl) return;

		const spinCount  = isBonus ? 44 + i * 7 : 28 + i * 5;
		const finalValue = isBonus ? '🃏' : reelData.final;
		const items      = buildStripItems(reelData.decoys, finalValue, spinCount);
		const strip      = reelEl.querySelector('.reel-strip');

		strip.style.transition = 'none';
		strip.style.transform  = 'translateY(0)';
		strip.innerHTML = items.map((text, idx) => {
			const isFinal = idx === spinCount;
			return `<div class="reel-item${isFinal ? ' reel-final' : ''}">${escapeHtml(text)}</div>`;
		}).join('');

		const finalIndex = spinCount;
		const targetY    = REEL_ITEM_H * (1 - finalIndex);
		const duration   = durations[i];

		reelEl.classList.remove('landed');
		reelEl.classList.add('spinning');

		requestAnimationFrame(() => {
			requestAnimationFrame(() => {
				strip.style.transition = `transform ${duration}ms cubic-bezier(0.12, 0.0, 0.2, 1.0)`;
				strip.style.transform  = `translateY(${targetY}px)`;
			});
		});

		setTimeout(() => {
			reelEl.classList.remove('spinning');
			reelEl.classList.add('landed');

			landedCount++;

			// Thunk sounds during bonus: reveal sound on the final reel, drop on all others
			if (isBonus) {
				if (landedCount === reels.length) SFX.bonusModalReveal.play();
				else SFX.bonusDrop.play();
			} else {
				SFX.reelStop.play();
			}

			if (landedCount === reels.length) {
				// ── ALL REELS LANDED ──────────────────────────────
				if (isBonus) {
					SFX.tensionRampup.stop();
					if (app) app.classList.add('bonus-shake');
					setTimeout(() => {
						if (app) app.classList.remove('bonus-shake');
						SFX.bonusMusic.play();
						if (onComplete) onComplete();
					}, 1200);
				} else {
					if (slotMachine) slotMachine.classList.add('celebration');
					setTimeout(() => {
						if (slotMachine) slotMachine.classList.remove('celebration');
					}, 1000);
					if (onComplete) onComplete();
				}
			}
		}, duration + 50);
	});
}

function escapeHtml(str) {
	return String(str)
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;');
}

function hexToRgba(hex, alpha) {
	const r = parseInt(hex.slice(1, 3), 16);
	const g = parseInt(hex.slice(3, 5), 16);
	const b = parseInt(hex.slice(5, 7), 16);
	return `rgba(${r},${g},${b},${alpha})`;
}

// ============================================================
// UI — RENDERING
// ============================================================

function renderApp() {
	renderTurnBanner();
	renderPlayerTokens();
	renderHistory();
	renderLeaderboard();
	renderSessionPanel();
}

function applyPlayerTheme(player) {
	const color   = player ? player.color : '#ffc83c';
	const a60     = hexToRgba(color, 0.60);
	const a35     = hexToRgba(color, 0.35);
	const a20     = hexToRgba(color, 0.20);
	const a12     = hexToRgba(color, 0.12);

	// Slot machine border + ambient glow
	const machine = document.getElementById('slotMachine');
	if (machine) {
		machine.style.borderColor = color;
		machine.style.boxShadow   = `0 0 0 1px ${a12}, 0 0 50px ${a35}, inset 0 1px 0 ${a12}`;
	}

	// Spin button border + glow
	const spinBtn = document.getElementById('spinBtn');
	if (spinBtn) {
		spinBtn.style.borderColor = color;
		spinBtn.style.color       = color;
		spinBtn.style.boxShadow   = `0 0 12px ${a60}, 0 0 30px ${a20}, inset 0 1px 0 ${a20}`;
	}

	// Marquee: replace with player name while a player is active
	const marquee = document.getElementById('marqueeText');
	if (marquee) {
		if (player) {
			marquee.innerHTML   = `${player.avatar} &nbsp; ${escapeHtml(player.name.toUpperCase())} &nbsp; ${player.avatar}`;
			marquee.style.color = color;
			marquee.style.textShadow = `0 0 12px ${a60}, 0 0 30px ${a20}`;
		} else {
			marquee.innerHTML        = '🎰 &nbsp; BANDITTOMATEN &nbsp; 🎰';
			marquee.style.color      = 'var(--gold)';
			marquee.style.textShadow = 'var(--glow-gold)';
		}
	}
}

function renderTurnBanner() {
	const el = document.getElementById('currentTurnBanner');
	if (!el) return;
	const player = getCurrentPlayer();

	if (!player) {
		el.innerHTML = '<span style="color:var(--text-dim);font-size:0.7rem">Ingen spillere</span>';
		applyPlayerTheme(null);
		return;
	}

	const glow = `0 0 10px ${hexToRgba(player.color, 0.55)}, 0 0 25px ${hexToRgba(player.color, 0.25)}`;
	el.innerHTML = `
		<span class="turn-avatar">${player.avatar}</span>
		<span class="turn-name" style="color:${player.color};text-shadow:${glow}">${escapeHtml(player.name)}</span>
		<span class="turn-suffix">sin tur</span>
	`;
	applyPlayerTheme(player);
}

function renderPlayerTokens() {
	const container = document.getElementById('playerStrip');
	if (!container) return;

	const involvedIds   = STATE.currentRound ? STATE.currentRound.involvedPlayerIds : [];
	const currentPlayer = getCurrentPlayer();

	if (STATE.players.length === 0) {
		container.innerHTML = '<span style="font-size:0.7rem;color:var(--text-dim);font-style:italic">Ingen spillere</span>';
		return;
	}

	container.innerHTML = STATE.players.map(player => {
		const isActive   = currentPlayer && player.id === currentPlayer.id;
		const isInvolved = involvedIds.includes(player.id);
		let cls = 'player-chip';
		if (isActive)   cls += ' active';
		if (isInvolved) cls += ' involved';

		const borderColor = isActive ? player.color : 'rgba(255,255,255,0.12)';

		return `
			<div class="${cls}" data-player-id="${player.id}" title="${escapeHtml(player.name)}">
				<button class="chip-remove" data-remove-id="${player.id}" title="Fjern spiller">✕</button>
				<div class="chip-avatar-wrap" style="border-color:${borderColor}">
					${player.avatar}
				</div>
				<div class="chip-name" style="color:${isActive ? player.color : 'var(--text-secondary)'}">${escapeHtml(player.name)}</div>
				${isActive ? '<div class="chip-active-dot"></div>' : ''}
			</div>
		`;
	}).join('');
}

function renderAvatarGrid() {
	const grid = document.getElementById('avatarGrid');
	if (!grid) return;
	grid.innerHTML = CONFIG.avatarPresets.map(emoji => `
		<div class="avatar-option${emoji === STATE.selectedAvatar ? ' selected' : ''}"
			data-avatar="${emoji}">${emoji}</div>
	`).join('');
}

function renderColorPicker() {
	const picker = document.getElementById('colorPicker');
	if (!picker) return;
	picker.innerHTML = CONFIG.playerColors.map(color => `
		<div class="color-option${color === STATE.selectedColor ? ' selected' : ''}"
			data-color="${color}"
			style="background:${color}"
			title="${color}"></div>
	`).join('');
}

function renderResult(round) {
	const section   = document.getElementById('resultSection');
	const titleEl   = document.getElementById('resultTitle');
	const summaryEl = document.getElementById('resultSummary');
	const cardsEl   = document.getElementById('resultCards');
	const lineEl    = document.getElementById('slotResultLine');

	if (!section) return;

	const playerGlow = `0 0 12px ${hexToRgba(round.currentPlayerColor, 0.6)}, 0 0 30px ${hexToRgba(round.currentPlayerColor, 0.2)}`;

	const displayTitle   = round.isBonus ? `🃏 ${round.currentPlayerName} sin Blackjack Bonus!` : round.title;
	const displaySummary = round.isBonus ? buildBonusHistorySummary(round.bonusDetails) : round.summary;

	titleEl.innerHTML        = escapeHtml(displayTitle);
	titleEl.style.color      = round.currentPlayerColor;
	titleEl.style.textShadow = playerGlow;
	summaryEl.textContent    = displaySummary;

	if (lineEl) {
		lineEl.textContent      = displayTitle;
		lineEl.style.color      = round.currentPlayerColor;
		lineEl.style.textShadow = playerGlow;
		lineEl.style.display    = 'block';
	}

	cardsEl.innerHTML = buildResultCardsHTML(round);

	// Stagger-animate each result card on reveal
	cardsEl.querySelectorAll('.result-card').forEach((card, i) => {
		card.style.animationDelay = `${i * 70}ms`;
	});

	// Show saved balance badge if this round already has one (e.g. history re-open)
	const badgeEl = document.getElementById('resultBalanceBadge');
	if (badgeEl) {
		if (round.balanceDelta != null) {
			showResultBalanceBadge(round.balanceDelta, round.balanceSaved);
		} else {
			badgeEl.style.display = 'none';
		}
	}

	section.style.display = 'block';
	section.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function showResultBalanceBadge(delta, savedBalance) {
	const badge = document.getElementById('resultBalanceBadge');
	if (!badge) return;
	const sign  = delta >= 0 ? '+' : '';
	const color = delta >= 0 ? 'var(--green)' : 'var(--red)';
	badge.innerHTML = `
		<span>💰 Saldo etter runde:</span>
		<span style="color:${color};font-weight:800;font-size:0.92rem">${sign}€${delta.toFixed(2)}</span>
		<span style="color:var(--text-dim)">→ €${savedBalance.toFixed(2)}</span>
	`;
	badge.style.display = 'flex';
}

function buildBonusResultCardsHTML(round) {
	const bd    = round.bonusDetails || {};
	const left  = bd.leftSidebet  ? `€${bd.leftSidebet}`  : '€0';
	const right = bd.rightSidebet ? `€${bd.rightSidebet}` : '€0';
	const leftCls  = bd.leftSidebet  ? 'brb-active' : 'brb-zero';
	const rightCls = bd.rightSidebet ? 'brb-active' : 'brb-zero';

	return `
		<div class="result-card result-card-bonus-info" style="border-left:3px solid ${round.currentPlayerColor}">
			<div class="brb-header">
				<span class="brb-avatar">${round.currentPlayerAvatar}</span>
				<span class="brb-name" style="color:${round.currentPlayerColor}">${escapeHtml(round.currentPlayerName)}</span>
				<span class="brb-badge">🃏 Blackjack Bonus</span>
			</div>
			<div class="brb-bets">
				<div class="brb-slot ${leftCls}">
					<span class="brb-label">Venstre<br>sidebet</span>
					<span class="brb-value">${left}</span>
				</div>
				<div class="brb-slot brb-hand">
					<span class="brb-label">Hånd</span>
					<span class="brb-value">€${bd.handBet ?? '—'}</span>
				</div>
				<div class="brb-slot ${rightCls}">
					<span class="brb-label">Høyre<br>sidebet</span>
					<span class="brb-value">${right}</span>
				</div>
			</div>
			<div class="brb-hands">${bd.hands ?? '?'} ${(bd.hands ?? 0) === 1 ? 'hånd' : 'hender'} · €${bd.totalPerHand ?? '?'} per hånd</div>
		</div>
	`;
}

function buildResultCardsHTML(round) {
	if (round.isBonus) return buildBonusResultCardsHTML(round);

	// ── INFO CARDS (archive row — uniform styling) ─────────────
	const info = [];

	info.push(`
		<div class="result-card" style="border-left:3px solid ${round.currentPlayerColor}">
			<div class="card-icon">${round.currentPlayerAvatar}</div>
			<div class="card-label">Spiller</div>
			<div class="card-value" style="color:${round.currentPlayerColor}">${escapeHtml(round.currentPlayerName)}</div>
		</div>
	`);
	info.push(`
		<div class="result-card">
			<div class="card-icon">${round.archetype.emoji}</div>
			<div class="card-label">Runde type</div>
			<div class="card-value">${escapeHtml(round.archetype.nameNo)}</div>
		</div>
	`);
	info.push(`
		<div class="result-card">
			<div class="card-icon">🎯</div>
			<div class="card-label">Spins</div>
			<div class="card-value">${escapeHtml(round.spins.label)}</div>
		</div>
	`);
	info.push(`
		<div class="result-card">
			<div class="card-icon">💶</div>
			<div class="card-label">Bet</div>
			<div class="card-value">${escapeHtml(round.bet.label)}</div>
		</div>
	`);
	info.push(`
		<div class="result-card">
			<div class="card-icon">${getMachineIcon(round.machineSelection.type)}</div>
			<div class="card-label">Maskinvalg</div>
			<div class="card-value">${escapeHtml(round.machineSelection.label)}</div>
		</div>
	`);
	info.push(`
		<div class="result-card">
			<div class="card-icon">🕹️</div>
			<div class="card-label">Spillestil</div>
			<div class="card-value">${escapeHtml(round.playStyle.labelNo || round.playStyle.label)}</div>
		</div>
	`);
	// ── SPECIAL CARDS (social + bonus — always 50/50) ──────────
	const special = [];

	if (round.socialEffect) {
		const se             = round.socialEffect;
		const involvedPlayer = STATE.players.find(p => p.id === se.playerId);
		const avatar         = involvedPlayer ? involvedPlayer.avatar : '👤';
		const color          = involvedPlayer ? involvedPlayer.color  : 'var(--cyan)';
		special.push(`
			<div class="result-card result-card-special social">
				<div class="card-icon">👥</div>
				<div class="card-label">Sosial effekt</div>
				<div class="card-value">${escapeHtml(se.label)}</div>
				<div class="social-player-badge">
					<span>${avatar}</span>
					<span style="color:${color}">${escapeHtml(se.playerName)}</span>
				</div>
			</div>
		`);
	}

	if (round.bonusRule && round.bonusRule.id !== 'no_bonus_rule') {
		special.push(`
			<div class="result-card result-card-special bonus">
				<div class="card-icon">🎁</div>
				<div class="card-label">Bonusregel</div>
				<div class="card-value">${escapeHtml(round.bonusRule.label)}</div>
			</div>
		`);
	}

	// Modifier — full-width banner above info cards
	let modifierHtml = '';
	if (round.modifier && round.modifier.id !== 'no_modifier') {
		modifierHtml = `
			<div class="result-card result-card-modifier">
				<div class="card-icon">📋</div>
				<div class="card-label">Spesialregel</div>
				<div class="card-value">${escapeHtml(round.modifier.labelNo || round.modifier.label)}</div>
			</div>
		`;
	}

	let html = modifierHtml;
	html += `<div class="result-cards-info">${info.join('')}</div>`;
	if (special.length > 0) {
		html += `<div class="result-cards-special">${special.join('')}</div>`;
	}
	return html;
}

function getMachineIcon(type) {
	const icons = {
		search_term:        '🔍',
		fixed_provider:     '🏭',
		provider_by_player: '⚖️',
		machine_by_player:  '🎰',
		category:           '📁'
	};
	return icons[type] || '🎰';
}

function renderHistory() {
	const section = document.getElementById('historySection');
	const list    = document.getElementById('historyList');
	if (!section || !list) return;

	if (STATE.roundHistory.length === 0) {
		section.style.display = 'none';
		return;
	}

	section.style.display = '';
	list.innerHTML = [...STATE.roundHistory].reverse().map(round => {
		const time    = formatTime(round.createdAt);
		const tags    = buildHistoryTags(round);
		const title   = round.isBonus ? '🃏 Blackjack Bonus' : escapeHtml(round.title);
		const summary = round.isBonus
			? escapeHtml(buildBonusHistorySummary(round.bonusDetails))
			: `${escapeHtml(round.spins.label)} · ${escapeHtml(round.bet.label)} · ${escapeHtml(round.machineSelection.label)}`;
		return `
			<div class="history-entry" data-round-id="${round.id}">
				<div class="history-avatar">${round.currentPlayerAvatar}</div>
				<div class="history-info">
					<div class="history-title">${title}</div>
					<div class="history-summary">${summary}</div>
				</div>
				<div>
					<div class="history-time">${time}</div>
					<div class="history-tags">${tags}</div>
				</div>
			</div>
		`;
	}).join('');
}

function buildBonusHistorySummary(bd) {
	if (!bd) return 'Blackjack';
	const left  = bd.leftSidebet  ? `€${bd.leftSidebet}`  : '€0';
	const right = bd.rightSidebet ? `€${bd.rightSidebet}` : '€0';
	return `${bd.hands} hender · [${left}] €${bd.handBet} [${right}]`;
}

function buildHistoryTags(round) {
	const tags = [];
	if (round.isBonus) {
		tags.push(`<span class="tag gold">🃏 Blackjack</span>`);
	} else {
		tags.push(`<span class="tag">${round.archetype.emoji}</span>`);
		if (round.betProfile.id === 'high_roller') tags.push(`<span class="tag gold">High Roller</span>`);
		if (round.betProfile.id === 'cursed')      tags.push(`<span class="tag gold">Cursed</span>`);
		if (round.socialEffect)                    tags.push(`<span class="tag cyan">Social</span>`);
	}
	if (round.balanceDelta != null) {
		const cls  = round.balanceDelta > 0 ? 'pos' : round.balanceDelta < 0 ? 'neg' : '';
		const sign = round.balanceDelta >= 0 ? '+' : '';
		tags.push(`<span class="tag ${cls}">${sign}€${round.balanceDelta.toFixed(2)}</span>`);
	}
	return tags.join('');
}

function updateDebugPanel(round) {
	const el = document.getElementById('debugJson');
	if (el) el.textContent = JSON.stringify(round, null, 2);
}

// ============================================================
// MODAL (player edit)
// ============================================================

function openEditPlayerModal(playerId) {
	const player = STATE.players.find(p => p.id === playerId);
	if (!player) return;

	STATE.editingPlayerId = playerId;
	STATE.selectedAvatar  = player.avatar;
	STATE.selectedColor   = player.color;

	document.getElementById('modalTitle').textContent = `Rediger ${player.name}`;

	const body = document.getElementById('modalBody');
	body.innerHTML = `
		<div class="form-row">
			<label class="form-label">Navn</label>
			<input type="text" id="editNameInput" class="input" value="${escapeHtml(player.name)}" maxlength="20" autocomplete="off">
		</div>
		<div class="form-row form-row-avatar">
			<div class="avatar-preview-wrap">
				<div id="editAvatarPreview" class="avatar-preview">${player.avatar}</div>
			</div>
			<button class="btn btn-ghost btn-sm" id="editToggleAvatarPicker" type="button">Velg avatar</button>
		</div>
		<div id="editAvatarGrid" class="avatar-grid" style="display:none">
			${CONFIG.avatarPresets.map(emoji => `
				<div class="avatar-option${emoji === player.avatar ? ' selected' : ''}"
					data-edit-avatar="${emoji}">${emoji}</div>
			`).join('')}
		</div>
		<div class="form-row color-row">
			<span class="form-label">Farge:</span>
			<div id="editColorPicker" class="color-picker">
				${CONFIG.playerColors.map(c => `
					<div class="color-option${c === player.color ? ' selected' : ''}"
						data-edit-color="${c}" style="background:${c}"></div>
				`).join('')}
			</div>
		</div>
		<div class="modal-actions">
			<button class="btn btn-primary" id="savePlayerBtn">Lagre</button>
			<button class="btn btn-danger" id="deletePlayerBtn">Fjern spiller</button>
		</div>
	`;

	document.getElementById('modalOverlay').style.display = 'flex';
}

function closeModal() {
	document.getElementById('modalOverlay').style.display = 'none';
	STATE.editingPlayerId = null;
}

// ============================================================
// LOCALSTORAGE
// ============================================================

function saveState() {
	try {
		localStorage.setItem(LS_KEY_PLAYERS, JSON.stringify(STATE.players));
		localStorage.setItem(LS_KEY_TURN,    JSON.stringify(STATE.currentPlayerIndex));
		localStorage.setItem(LS_KEY_HISTORY, JSON.stringify(STATE.roundHistory));
		localStorage.setItem(LS_KEY_SESSION, JSON.stringify(STATE.session));
	} catch (e) {}
}

function loadState() {
	try {
		const players = localStorage.getItem(LS_KEY_PLAYERS);
		const turn    = localStorage.getItem(LS_KEY_TURN);
		const history = localStorage.getItem(LS_KEY_HISTORY);
		const session = localStorage.getItem(LS_KEY_SESSION);

		if (players) STATE.players            = JSON.parse(players);
		if (turn)    STATE.currentPlayerIndex = parseInt(turn, 10) || 0;
		if (history) STATE.roundHistory       = JSON.parse(history);
		if (session) STATE.session            = JSON.parse(session);
	} catch (e) {
		STATE.players            = [];
		STATE.currentPlayerIndex = 0;
		STATE.roundHistory       = [];
		STATE.session            = { startBalance: null, currentBalance: null, balanceHistory: [] };
	}
}

// ============================================================
// EVENT WIRING
// ============================================================

function setupEvents() {
	document.getElementById('spinBtn').addEventListener('click', onSpinClick);
	document.getElementById('nextBtn').addEventListener('click', onNextPlayerClick);
	document.getElementById('resetBtn').addEventListener('click', onResetNightClick);

	// Bonus modal close
	document.getElementById('bonusCloseBtn').addEventListener('click', hideBonusModal);

	// Start background music on first user interaction (browser autoplay policy)
	document.addEventListener('click', () => {
		if (!_bgMusicStarted) {
			_bgMusicStarted = true;
			SFX.bgMusic.play();
		}
	}, { once: true });

	// Pause/resume background music when the tab loses/gains focus
	document.addEventListener('visibilitychange', () => {
		if (document.hidden) {
			SFX.bgMusic.pause();
			SFX.bonusMusic.pause();
		} else {
			if (_bgMusicStarted && !SFX.bonusMusic.playing()) {
				SFX.bgMusic.volume(0.25);
				SFX.bgMusic.play();
			}
			if (SFX.bonusMusic.playing()) SFX.bonusMusic.play();
		}
	});

	document.getElementById('openAddPlayerBtn').addEventListener('click', openAddPlayerModal);
	document.getElementById('openAddPlayerSidebarBtn').addEventListener('click', openAddPlayerModal);

	document.getElementById('playerStrip').addEventListener('click', e => {
		const removeBtn = e.target.closest('[data-remove-id]');
		if (removeBtn) {
			e.stopPropagation();
			const id     = removeBtn.dataset.removeId;
			const player = STATE.players.find(p => p.id === id);
			if (player && confirm(`Fjern ${player.name}?`)) {
				removePlayer(id);
				renderApp();
			}
			return;
		}
		const chip = e.target.closest('[data-player-id]');
		if (chip) openEditPlayerModal(chip.dataset.playerId);
	});

	document.getElementById('modalClose').addEventListener('click', () => {
		document.getElementById('playerModal').classList.remove('modal--graph');
		closeModal();
	});
	document.getElementById('modalOverlay').addEventListener('click', e => {
		if (e.target === document.getElementById('modalOverlay')) {
			document.getElementById('playerModal').classList.remove('modal--graph');
			closeModal();
		}
	});

	// Balance graph zoom
	document.getElementById('balanceGraphWrap').addEventListener('click', openGraphModal);

	document.getElementById('modalBody').addEventListener('click', e => {
		if (e.target.id === 'modalToggleAvatarPicker' || e.target.id === 'editToggleAvatarPicker') {
			const gridId = e.target.id === 'modalToggleAvatarPicker' ? 'modalAvatarGrid' : 'editAvatarGrid';
			const grid   = document.getElementById(gridId);
			if (grid) grid.style.display = grid.style.display === 'none' ? 'grid' : 'none';
			return;
		}
		const addAvatar = e.target.closest('[data-modal-avatar]');
		if (addAvatar) {
			STATE.selectedAvatar = addAvatar.dataset.modalAvatar;
			const prev = document.getElementById('modalAvatarPreview');
			if (prev) prev.textContent = STATE.selectedAvatar;
			document.querySelectorAll('[data-modal-avatar]').forEach(el => el.classList.remove('selected'));
			addAvatar.classList.add('selected');
			return;
		}
		const editAvatar = e.target.closest('[data-edit-avatar]');
		if (editAvatar) {
			STATE.selectedAvatar = editAvatar.dataset.editAvatar;
			const prev = document.getElementById('editAvatarPreview');
			if (prev) prev.textContent = STATE.selectedAvatar;
			document.querySelectorAll('[data-edit-avatar]').forEach(el => el.classList.remove('selected'));
			editAvatar.classList.add('selected');
			return;
		}
		const addColor = e.target.closest('[data-modal-color]');
		if (addColor) {
			STATE.selectedColor = addColor.dataset.modalColor;
			document.querySelectorAll('[data-modal-color]').forEach(el => el.classList.remove('selected'));
			addColor.classList.add('selected');
			return;
		}
		const editColor = e.target.closest('[data-edit-color]');
		if (editColor) {
			STATE.selectedColor = editColor.dataset.editColor;
			document.querySelectorAll('[data-edit-color]').forEach(el => el.classList.remove('selected'));
			editColor.classList.add('selected');
			return;
		}
		if (e.target.id === 'confirmAddPlayerBtn') { onConfirmAddPlayer(); return; }
		if (e.target.id === 'cancelAddModalBtn')   { closeModal();         return; }
		if (e.target.id === 'savePlayerBtn') {
			const nameEl = document.getElementById('editNameInput');
			const name   = nameEl ? nameEl.value.trim() : '';
			if (!name) { alert('Navn kan ikke være tomt'); return; }
			updatePlayer(STATE.editingPlayerId, { name, avatar: STATE.selectedAvatar, color: STATE.selectedColor });
			closeModal();
			renderApp();
			return;
		}
		if (e.target.id === 'deletePlayerBtn') {
			const player = STATE.players.find(p => p.id === STATE.editingPlayerId);
			if (player && confirm(`Fjern ${player.name}?`)) {
				removePlayer(STATE.editingPlayerId);
				closeModal();
				renderApp();
			}
		}
	});

	document.getElementById('modalBody').addEventListener('keydown', e => {
		if (e.key === 'Enter' && e.target.id === 'modalPlayerNameInput') onConfirmAddPlayer();
	});

	// Session start
	document.getElementById('setSessionStartBtn').addEventListener('click', () => {
		const input = document.getElementById('sessionStartInput');
		const val   = parseFloat(input.value);
		if (isNaN(val) || val < 0) { input.focus(); return; }
		setSessionStart(val);
		input.value = '';
	});
	document.getElementById('sessionStartInput').addEventListener('keydown', e => {
		if (e.key === 'Enter') document.getElementById('setSessionStartBtn').click();
	});

	// Edit session start — lets user re-enter the opening balance
	document.getElementById('editSessionStartBtn').addEventListener('click', () => {
		STATE.session.startBalance = null;
		saveState();
		const startForm  = document.getElementById('sessionStartForm');
		const balDisplay = document.getElementById('sessionBalanceDisplay');
		if (startForm)  startForm.style.display  = '';
		if (balDisplay) balDisplay.style.display = 'none';
		const input = document.getElementById('sessionStartInput');
		if (input) {
			input.value = STATE.session.currentBalance !== null
				? STATE.session.currentBalance.toFixed(2)
				: '';
			input.focus();
		}
	});

	// Balance prompt (after spin)
	document.getElementById('saveBalanceBtn').addEventListener('click', onSaveBalance);
	document.getElementById('balanceInput').addEventListener('keydown', e => {
		if (e.key === 'Enter') onSaveBalance();
	});
	document.getElementById('skipBalanceBtn').addEventListener('click', () => {
		document.getElementById('balancePrompt').style.display = 'none';
	});

	// History — click entry to re-show result
	document.getElementById('historyList').addEventListener('click', e => {
		const entry = e.target.closest('.history-entry');
		if (!entry) return;
		const round = STATE.roundHistory.find(r => r.id === entry.dataset.roundId);
		if (round) { renderResult(round); updateDebugPanel(round); }
	});
}

function onSpinClick() {
	if (STATE.isSpinning) return;
	if (STATE.players.length === 0) {
		alert('Legg til minst én spiller først!');
		return;
	}

	STATE.isSpinning = true;

	const spinBtn   = document.getElementById('spinBtn');
	const nextBtn   = document.getElementById('nextBtn');
	const resultSec = document.getElementById('resultSection');
	const lineEl    = document.getElementById('slotResultLine');

	spinBtn.disabled = true;
	nextBtn.disabled = true;
	if (resultSec) resultSec.style.display = 'none';
	if (lineEl)    lineEl.style.display    = 'none';

	const round = generateRound();
	if (!round) {
		STATE.isSpinning = false;
		spinBtn.disabled = false;
		return;
	}

	STATE.currentRound = round;
	renderPlayerTokens();

	animateAllReels(round.reels, () => {
		STATE.isSpinning = false;
		spinBtn.disabled = false;
		nextBtn.disabled = false;

		const player = STATE.players.find(p => p.id === round.currentPlayerId);
		if (player) {
			if (!player.stats) player.stats = { roundsPlayed: 0 };
			player.stats.roundsPlayed++;
		}

		STATE.roundHistory.push(round);
		saveState();

		if (round.isBonus) {
			showBonusModal(round);
		} else {
			renderResult(round);
			renderHistory();
			renderLeaderboard();
			updateDebugPanel(round);
			showBalancePrompt(round);
		}
	}, round.isBonus);
}

function onNextPlayerClick() {
	advanceTurn();
	STATE.currentRound = null;
	document.getElementById('balancePrompt').style.display        = 'none';
	document.getElementById('balanceSavedFeedback').style.display = 'none';

	const reelLabels = { spins: 'Spins', bet: 'Bet', machine: 'Machine', modifier: 'Modifier' };
	['spins', 'bet', 'machine', 'modifier'].forEach(id => {
		const reelEl = document.getElementById(`reel-${id}`);
		if (reelEl) setReelIdle(reelEl, reelLabels[id]);
	});

	const lineEl = document.getElementById('slotResultLine');
	if (lineEl) lineEl.style.display = 'none';

	document.getElementById('nextBtn').disabled           = true;
	document.getElementById('resultSection').style.display = 'none';

	renderApp();
	document.getElementById('slotMachine').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function onResetNightClick() {
	if (!confirm('Reset hele kvelden? Saldoer, runder og historikk slettes.')) return;
	resetNight();   // saves state + clears session (graph will be hidden on load)
	location.reload(); // picks up any edits to config.js
}

function openAddPlayerModal() {
	STATE.editingPlayerId = null;
	STATE.selectedAvatar  = '🎩';
	const usedColors      = STATE.players.map(p => p.color);
	STATE.selectedColor   = CONFIG.playerColors.find(c => !usedColors.includes(c)) || CONFIG.playerColors[0];

	document.getElementById('modalTitle').textContent = 'Ny spiller';
	document.getElementById('modalBody').innerHTML    = buildAddPlayerFormHTML();
	document.getElementById('modalOverlay').style.display = 'flex';
	setTimeout(() => {
		const nameInput = document.getElementById('modalPlayerNameInput');
		if (nameInput) nameInput.focus();
	}, 80);
}

function buildAddPlayerFormHTML() {
	return `
		<div class="form-row">
			<label class="form-label">Navn</label>
			<input type="text" id="modalPlayerNameInput" class="input" placeholder="Navn..." maxlength="20" autocomplete="off">
		</div>
		<div class="form-row form-row-avatar">
			<div class="avatar-preview-wrap">
				<div id="modalAvatarPreview" class="avatar-preview">${STATE.selectedAvatar}</div>
			</div>
			<button class="btn btn-ghost btn-sm" id="modalToggleAvatarPicker" type="button">Velg avatar</button>
		</div>
		<div id="modalAvatarGrid" class="avatar-grid" style="display:none">
			${CONFIG.avatarPresets.map(e => `<div class="avatar-option${e === STATE.selectedAvatar ? ' selected' : ''}" data-modal-avatar="${e}">${e}</div>`).join('')}
		</div>
		<div class="form-row color-row">
			<span class="form-label">Farge:</span>
			<div id="modalColorPicker" class="color-picker">
				${CONFIG.playerColors.map(c => `<div class="color-option${c === STATE.selectedColor ? ' selected' : ''}" data-modal-color="${c}" style="background:${c}"></div>`).join('')}
			</div>
		</div>
		<div class="modal-actions">
			<button class="btn btn-primary" id="confirmAddPlayerBtn">Legg til</button>
			<button class="btn btn-ghost" id="cancelAddModalBtn">Avbryt</button>
		</div>
	`;
}

function onConfirmAddPlayer() {
	const nameEl = document.getElementById('modalPlayerNameInput');
	const name   = nameEl ? nameEl.value.trim() : '';
	if (!name) { if (nameEl) nameEl.focus(); return; }

	addPlayer(name, STATE.selectedAvatar, STATE.selectedColor);
	closeModal();
	renderApp();
}

// ============================================================
// INIT
// ============================================================

function init() {
	loadState();

	if (STATE.players.length === 0) {
		for (const p of CONFIG.defaultPlayers) {
			STATE.players.push({
				...p,
				stats: { roundsPlayed: 0 },
				joinedAt: new Date().toISOString()
			});
		}
		saveState();
	}

	// Ensure every player has a stats object (patch old saves)
	for (const p of STATE.players) {
		if (!p.stats) p.stats = { roundsPlayed: 0 };
	}

	// Patch old saves missing bonusChance
	if (typeof STATE.bonusChance !== 'number') STATE.bonusChance = 0;

	// Ensure session is properly shaped (patch old saves)
	if (!STATE.session || typeof STATE.session !== 'object') {
		STATE.session = { startBalance: null, currentBalance: null, balanceHistory: [] };
	}
	if (!Array.isArray(STATE.session.balanceHistory)) STATE.session.balanceHistory = [];

	initReels();
	setupEvents();
	renderApp();
}

document.addEventListener('DOMContentLoaded', init);

// ============================================================
// BALANCE TRACKING — SHARED SESSION
// ============================================================

// ============================================================
// BLACKJACK BONUS MODAL
// ============================================================

function showBonusModal(round) {
	const bd = round.bonusDetails;

	// Build bet display — always show all three slots, €0 when no sidebet
	const mkSide = (amt, label) => {
		const cls = amt ? 'side-active' : 'side-zero';
		const val = amt ? `€${amt}` : '€0';
		return `
			<div class="bonus-bet-slot ${cls}">
				<span class="bonus-bet-label">${label}</span>
				<span class="bonus-bet-value">${val}</span>
				${!amt ? '<span class="bonus-bet-none">ingen</span>' : ''}
			</div>`;
	};

	document.getElementById('bonusBetDisplay').innerHTML =
		mkSide(bd.leftSidebet, 'Venstre<br>sidebet') +
		`<div class="bonus-bet-slot hand">
			<span class="bonus-bet-label">Hånd</span>
			<span class="bonus-bet-value">€${bd.handBet}</span>
		</div>` +
		mkSide(bd.rightSidebet, 'Høyre<br>sidebet');

	const totalSession = bd.totalPerHand * bd.hands;
	document.getElementById('bonusHandsLabel').innerHTML = `
		<strong>${bd.hands} ${bd.hands === 1 ? 'hånd' : 'hender'}</strong>
		<span class="bonus-total">€${bd.totalPerHand} per hånd · totalt €${totalSession.toFixed(0)}</span>
	`;

	// Store round ref so hideBonusModal can continue the flow
	document.getElementById('bonusOverlay').dataset.roundId = round.id;
	document.getElementById('bonusOverlay').style.display = 'flex';
}

function hideBonusModal() {
	document.getElementById('bonusOverlay').style.display = 'none';
	SFX.bonusMusic.stop();
	// stop() first to prevent stacking multiple bgMusic instances
	SFX.bgMusic.stop();
	SFX.bgMusic.volume(0.25);
	SFX.bgMusic.play();

	const round = STATE.currentRound;
	if (round) {
		renderResult(round);   // shows bonus-specific card layout
		renderHistory();
		renderLeaderboard();
		updateDebugPanel(round);
		showBalancePrompt(round);
	}
}

// ─── Console test helper ──────────────────────────────────────
// Call testBonus() in DevTools to trigger the bonus sequence immediately.
window.testBonus = function () {
	STATE._forceBonusNextSpin = true;
	console.log('🃏 testBonus() armed — neste spin vil garantert bli bonus-spin. Klikk Spin!');
};

// ============================================================
// BALANCE PROMPT (post-round)
// ============================================================

function showBalancePrompt(round) {
	if (STATE.session.startBalance === null) return; // session not started yet

	const player = STATE.players.find(p => p.id === round.currentPlayerId);
	if (!player) return;

	const prompt     = document.getElementById('balancePrompt');
	const nameEl     = document.getElementById('balancePromptPlayer');
	const inputEl    = document.getElementById('balanceInput');
	const feedbackEl = document.getElementById('balanceSavedFeedback');

	nameEl.innerHTML = `${player.avatar} <span style="color:${player.color}">${escapeHtml(player.name)}</span>`;
	// Pre-fill with the current session balance so user only needs to change if it differs
	inputEl.value = STATE.session.currentBalance !== null
		? STATE.session.currentBalance.toFixed(2)
		: '';
	feedbackEl.style.display = 'none';

	prompt.dataset.playerId   = player.id;
	prompt.dataset.playerName = player.name;
	prompt.dataset.roundId    = round.id;
	prompt.dataset.roundTitle = round.title;

	prompt.style.display = 'block';
	setTimeout(() => inputEl.focus(), 100);
}

function onSaveBalance() {
	const prompt   = document.getElementById('balancePrompt');
	const inputEl  = document.getElementById('balanceInput');
	const feedback = document.getElementById('balanceSavedFeedback');
	const val      = parseFloat(inputEl.value);

	if (isNaN(val) || val < 0) { inputEl.focus(); return; }

	const playerId   = prompt.dataset.playerId;
	const playerName = prompt.dataset.playerName;
	const roundId    = prompt.dataset.roundId;
	const roundTitle = prompt.dataset.roundTitle;

	recordSessionBalance(val, roundId, roundTitle, playerId, playerName);

	// Show the balance badge in the result section
	if (STATE.currentRound && STATE.currentRound.balanceDelta != null) {
		showResultBalanceBadge(STATE.currentRound.balanceDelta, STATE.currentRound.balanceSaved);
	}

	const playerNet  = getPlayerNetProfit(playerId);
	const sessionNet = +(STATE.session.currentBalance - STATE.session.startBalance).toFixed(2);

	const pSign  = playerNet !== null && playerNet >= 0 ? '+' : '';
	const pColor = playerNet !== null ? (playerNet >= 0 ? 'var(--green)' : 'var(--red)') : 'var(--text-secondary)';
	const sSign  = sessionNet >= 0 ? '+' : '';
	const sColor = sessionNet >= 0 ? 'var(--green)' : 'var(--red)';

	const pDisplay = playerNet !== null ? `${pSign}€${playerNet.toFixed(2)}` : '—';
	feedback.innerHTML = `Saldo lagret ✓ &nbsp; Ditt bidrag: <span style="color:${pColor};font-weight:800">${pDisplay}</span> &nbsp; Kveld: <span style="color:${sColor};font-weight:800">${sSign}€${sessionNet.toFixed(2)}</span>`;
	feedback.style.display = 'block';
	inputEl.value = '';
}

// ============================================================
// AWARD CALCULATIONS
// ============================================================

function calculateAwards() {
	const players = STATE.players;
	const awards  = [];

	// Only consider players who have had at least one balance update
	const withHistory = players.filter(p => hasPlayerHistory(p.id));
	const withProfit  = players.filter(p => getPlayerNetProfit(p.id) !== null);

	if (withProfit.length === 0 && withHistory.length === 0) return awards;

	function best(list, fn, dir = 'max') {
		if (!list.length) return null;
		return list.reduce((a, b) => {
			const av = fn(a), bv = fn(b);
			return dir === 'max' ? (bv > av ? b : a) : (bv < av ? b : a);
		});
	}

	// 👑 Kveldets Vinner — most positive net contribution
	if (withProfit.length >= 1) {
		const p   = best(withProfit, p => getPlayerNetProfit(p.id), 'max');
		const val = getPlayerNetProfit(p.id);
		if (val !== null && val > 0)
			awards.push({ emoji: '👑', title: 'Kveldets Vinner', player: p, display: fmtDelta(val), cls: 'pos' });
	}

	// 😭 Kveldets Offer — most negative net contribution
	if (withProfit.length >= 1) {
		const p   = best(withProfit, p => getPlayerNetProfit(p.id), 'min');
		const val = getPlayerNetProfit(p.id);
		if (val !== null && val < 0)
			awards.push({ emoji: '😭', title: 'Kveldets Offer', player: p, display: fmtDelta(val), cls: 'neg' });
	}

	// ⚖️ Buddisten — net closest to zero (at least one update)
	if (withProfit.length >= 2) {
		const p   = best(withProfit, p => -Math.abs(getPlayerNetProfit(p.id)), 'max');
		const val = getPlayerNetProfit(p.id);
		if (val !== null)
			awards.push({ emoji: '⚖️', title: 'Buddisten', player: p, display: `≈ ${fmtDelta(val)}`, cls: val >= 0 ? 'pos' : 'neg' });
	}

	// 🚀 Rakettoppskudd — biggest single-round gain
	if (withHistory.length >= 1) {
		const p   = best(withHistory, p => getPlayerBiggestGain(p.id) ?? -Infinity, 'max');
		const val = getPlayerBiggestGain(p.id);
		if (val !== null && val > 0)
			awards.push({ emoji: '🚀', title: 'Rakettoppskudd', player: p, display: fmtDelta(val), cls: 'pos' });
	}

	// 💸 Krasjlanding — biggest single-round loss
	if (withHistory.length >= 1) {
		const p   = best(withHistory, p => getPlayerBiggestLoss(p.id) ?? Infinity, 'min');
		const val = getPlayerBiggestLoss(p.id);
		if (val !== null && val < 0)
			awards.push({ emoji: '💸', title: 'Krasjlanding', player: p, display: fmtDelta(val), cls: 'neg' });
	}

	// 📊 Volatilitetskonge — most total euros moved (sum of |deltas|)
	if (withHistory.length >= 1) {
		const p   = best(withHistory, p => getPlayerVolatility(p.id) ?? 0, 'max');
		const val = getPlayerVolatility(p.id);
		if (val !== null && val > 0)
			awards.push({ emoji: '📊', title: 'Volatilitetskonge', player: p, display: `€${val.toFixed(2)} svingning`, cls: '' });
	}

	// 🔥 Hot Streak — longest consecutive positive rounds
	if (withHistory.length >= 1) {
		const p   = best(withHistory, p => getPlayerLongestStreak(p.id, 'up'), 'max');
		const val = getPlayerLongestStreak(p.id, 'up');
		if (val >= 2)
			awards.push({ emoji: '🔥', title: 'Hot Streak', player: p, display: `${val} runder på rad`, cls: 'pos' });
	}

	// 🧊 Isblod — longest consecutive losing rounds
	if (withHistory.length >= 1) {
		const p   = best(withHistory, p => getPlayerLongestStreak(p.id, 'down'), 'max');
		const val = getPlayerLongestStreak(p.id, 'down');
		if (val >= 2)
			awards.push({ emoji: '🧊', title: 'Isblod', player: p, display: `${val} tap på rad`, cls: 'neg' });
	}

	// 🎭 Comeback-kid — biggest recovery from personal low point
	const withRecovery = withHistory.filter(p => getPlayerBiggestRecovery(p.id) !== null && getPlayerBiggestRecovery(p.id) > 0);
	if (withRecovery.length >= 1) {
		const p   = best(withRecovery, p => getPlayerBiggestRecovery(p.id), 'max');
		const val = getPlayerBiggestRecovery(p.id);
		if (val > 0)
			awards.push({ emoji: '🎭', title: 'Comeback-kid', player: p, display: fmtDelta(val), cls: 'pos' });
	}

	// 🎰 Grinder — most rounds played
	const withRounds = players.filter(p => p.stats && p.stats.roundsPlayed >= 1);
	if (withRounds.length >= 1) {
		const p = best(withRounds, p => p.stats.roundsPlayed, 'max');
		if (p.stats.roundsPlayed >= 1)
			awards.push({ emoji: '🎰', title: 'Grinder', player: p, display: `${p.stats.roundsPlayed} runder`, cls: '' });
	}

	// ⚡ Effektiv Spiller — best net per round played
	const withEff = withProfit.filter(p => {
		const eff = getPlayerEfficiency(p.id);
		return eff !== null && eff > 0;
	});
	if (withEff.length >= 1) {
		const p   = best(withEff, p => getPlayerEfficiency(p.id) ?? -Infinity, 'max');
		const val = getPlayerEfficiency(p.id);
		if (val !== null && val > 0)
			awards.push({ emoji: '⚡', title: 'Effektiv Spiller', player: p, display: `${fmtDelta(val)}/runde`, cls: 'pos' });
	}

	// ⭐ Konsistent — every balance update was positive
	const consistent = withHistory.filter(p => {
		const deltas = getPlayerDeltas(p.id);
		return deltas.length >= 2 && deltas.every(d => d >= 0);
	});
	if (consistent.length >= 1) {
		consistent.forEach(p =>
			awards.push({ emoji: '⭐', title: 'Konsistent', player: p, display: 'Aldri i minus', cls: 'pos' })
		);
	}

	return awards;
}

function fmtDelta(val) {
	if (val === null) return '—';
	const sign = val >= 0 ? '+' : '';
	return `${sign}€${val.toFixed(2)}`;
}

// ============================================================
// LEADERBOARD RENDERING
// ============================================================

function renderLeaderboard() {
	renderBalanceList();
	renderAwardsList();
}

function renderBalanceList() {
	const container = document.getElementById('balanceList');
	if (!container) return;

	if (STATE.players.length === 0) {
		container.innerHTML = '<div class="leaderboard-empty">Ingen spillere registrert</div>';
		return;
	}

	if (STATE.session.startBalance === null) {
		container.innerHTML = '<div class="leaderboard-empty">Start kvelden for å spore bidrag</div>';
		return;
	}

	const sorted = [...STATE.players].sort((a, b) => {
		const ap = getPlayerNetProfit(a.id), bp = getPlayerNetProfit(b.id);
		if (ap === null && bp === null) return 0;
		if (ap === null) return 1;
		if (bp === null) return -1;
		return bp - ap;
	});

	container.innerHTML = sorted.map((player, rank) => {
		const net      = getPlayerNetProfit(player.id);
		const rounds   = player.stats ? player.stats.roundsPlayed : 0;
		const isLeader = rank === 0 && net !== null && net > 0;

		let deltaHtml;
		if (net !== null) {
			const cls  = net > 0 ? 'positive' : net < 0 ? 'negative' : 'neutral';
			const sign = net > 0 ? '+' : '';
			deltaHtml  = `<div class="balance-entry-delta ${cls}">${sign}€${net.toFixed(2)}</div>`;
		} else {
			deltaHtml  = `<div class="balance-entry-delta neutral">—</div>`;
		}

		return `
			<div class="balance-entry${isLeader ? ' leader' : ''}" style="border-left: 3px solid ${player.color}">
				<div class="balance-entry-avatar">${player.avatar}</div>
				<div class="balance-entry-info">
					<div class="balance-entry-name" style="color:${player.color}">${escapeHtml(player.name)}</div>
					<div class="balance-entry-current">${rounds} runde${rounds !== 1 ? 'r' : ''}</div>
				</div>
				<div>${deltaHtml}</div>
			</div>
		`;
	}).join('');
}

function renderAwardsList() {
	const container = document.getElementById('awardsList');
	if (!container) return;

	const awards = calculateAwards();

	if (awards.length === 0) {
		container.innerHTML = '<div class="leaderboard-empty">Rekorder vises etter at saldoer er registrert</div>';
		return;
	}

	container.innerHTML = awards.map(award => `
		<div class="award-card ${award.cls || ''}">
			<div class="award-emoji">${award.emoji}</div>
			<div class="award-info">
				<div class="award-title">${escapeHtml(award.title)}</div>
				<div class="award-holder">${award.player.avatar} ${escapeHtml(award.player.name)}</div>
			</div>
			<div class="award-value ${award.cls || ''}">${escapeHtml(award.display)}</div>
		</div>
	`).join('');
}

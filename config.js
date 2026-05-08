// config.js — All game data for Bandittomaten
//
// HOW TO EXTEND:
// - Add providers: push to CONFIG.providers
// - Add search terms: push to CONFIG.searchTerms
// - Add an archetype: add entry to CONFIG.archetypes (see existing entries for structure)
// - Add a bet profile: add key to CONFIG.betProfiles (betTiers + spinTiers control valid ranges)
// - Add a play style: push to CONFIG.playStyles (betProfiles array controls eligibility)
// - Add a modifier: push to CONFIG.modifiers
// - Add a social effect: push to CONFIG.socialEffects (use {name} placeholder for player name)
// - Add a bonus rule: push to CONFIG.bonusRules
// Weights control relative frequency — higher weight = more likely to be picked.

const CONFIG = {

	providers: [
		'Pragmatic Play',
		'Hacksaw Gaming',
		'Nolimit City',
		"Play'n GO",
		'Relax Gaming',
		'Push Gaming',
		'ELK Studios',
		'Big Time Gaming',
		'NetEnt',
		'Thunderkick',
		'Yggdrasil',
		'Microgaming',
		'Quickspin',
		'Red Tiger'
	],

	searchTerms: [
		'Wild', 'Book', 'Gold', 'Wolf', 'Egypt', 'Candy', 'Viking',
		'Dragon', 'Fruit', 'Magic', 'Dead', 'Wanted', 'Buffalo', 'Fire',
		'Sweet', 'Gem', 'Pirate', 'Christmas', 'Dog', 'Cat',
		'Bonus', 'Spin', 'Jackpot', 'Mega', 'Mystery', 'Scatter', 'Reels',
		'Lucky', 'Fortune', 'Cash', 'Coin', 'Money', 'Diamond', 'Treasure',
		'Bank', 'Vault', 'Rich', 'Royal', 'King', 'Queen', 'Crown', 'Knight',
		'Castle', 'Empire', 'Pharaoh', 'Mummy', 'Pyramid', 'Temple', 'Aztec',
		'Maya', 'Jungle', 'Safari', 'Tiger', 'Lion', 'Panther', 'Eagle',
		'Shark', 'Kraken', 'Fish', 'Monkey', 'Panda', 'Bear', 'Horse',
		'Bull', 'Pig', 'Goat', 'Chicken', 'Rabbit', 'Fox', 'Owl', 'Raven',
		'Zombie', 'Vampire', 'Ghost', 'Witch', 'Wizard', 'Knight', 'Ninja',
		'Samurai', 'Alien', 'Robot', 'Monster', 'Demon', 'Angel', 'Heaven',
		'Hell', 'Inferno', 'Ice', 'Snow', 'Storm', 'Thunder', 'Lightning',
		'Rain', 'Sun', 'Moon', 'Star', 'Galaxy', 'Space', 'Planet', 'Rocket',
		'Mars', 'Neon', 'Cyber', 'Disco', 'Retro', 'Arcade', 'Party',
		'Beer', 'Wine', 'Shot', 'Bar', 'Pub', 'Vegas', 'Casino', 'Dice',
		'Card', 'Poker', 'Roulette', 'Blackjack', 'Seven', 'Cherry', 'Lemon',
		'Melon', 'Grape', 'Apple', 'Banana', 'Honey', 'Sugar', 'Donut',
		'Cake', 'Cookie', 'Coffee', 'Pizza', 'Burger', 'Taco', 'Chili',
		'Pirate', 'Ship', 'Ocean', 'Island', 'Beach', 'Volcano', 'Cave',
		'Mine', 'Train', 'Cowboy', 'Western', 'Sheriff', 'Outlaw', 'Bandit',
		'Heist', 'Prison', 'Mafia', 'Gangster', 'Detective', 'Secret',
		'Lab', 'Toxic', 'Mutant', 'Doctor', 'Nurse', 'School', 'Farm',
		'Fishing', 'Hunting', 'Racing', 'Football', 'Golf', 'Tennis',
		'Boxing', 'Workout', 'Gym', 'Love', 'Heart', 'Kiss', 'Rose',
		'Wedding', 'Summer', 'Winter', 'Easter', 'Halloween', 'Santa'
	],

	// numeric:          actual euro value (used for total-spend checks)
	// minBalance:       bet not offered when session balance is below this
	// maxBalance:       bet not offered when session balance is at or above this (null = no cap)
	// maxSpinsPerRound: hard limit on spins when this bet is chosen (prevents e.g. €3 × 75)
	// weight:           relative pick frequency when multiple bets are eligible
	betValues: [
		{ value: '€0.20', label: '€0.20', tier: 'low',    numeric: 0.20, minBalance: 0,   maxBalance: 60,   weight: 8  },
		{ value: '€0.40', label: '€0.40', tier: 'low',    numeric: 0.40, minBalance: 0,   maxBalance: null, weight: 20 },
		{ value: '€0.60', label: '€0.60', tier: 'medium', numeric: 0.60, minBalance: 20,  maxBalance: null, weight: 18 },
		{ value: '€0.80', label: '€0.80', tier: 'medium', numeric: 0.80, minBalance: 30,  maxBalance: null, weight: 15 },
		{ value: '€1.00', label: '€1.00', tier: 'high',   numeric: 1.00, minBalance: 50,  maxBalance: null, weight: 12, maxSpinsPerRound: 50 },
		{ value: '€2.00', label: '€2.00', tier: 'high',   numeric: 2.00, minBalance: 100, maxBalance: null, weight: 8,  maxSpinsPerRound: 25 },
		{ value: '€3.00', label: '€3.00', tier: 'high',   numeric: 3.00, minBalance: 150, maxBalance: null, weight: 5,  maxSpinsPerRound: 25 }
	],

	// weight: relative pick frequency — 25, 50, 100 are the sweet-spot counts
	spinCounts: [
		{ value: 10,  label: '10 spins',  tier: 'few',    weight: 8  },
		{ value: 20,  label: '20 spins',  tier: 'few',    weight: 12 },
		{ value: 25,  label: '25 spins',  tier: 'medium', weight: 22 },
		{ value: 50,  label: '50 spins',  tier: 'medium', weight: 22 },
		{ value: 75,  label: '75 spins',  tier: 'many',   weight: 10 },
		{ value: 100, label: '100 spins', tier: 'many',   weight: 20 }
	],

	// Each archetype defines the template/flavor for a round.
	// machineType controls how the machine is selected (see pickMachineSelection in app.js).
	// forceBetProfile: if set, overrides betProfiles array.
	// allowSocialEffect / requireSocialEffect: whether a social effect can/must be added.
	// titleTemplate placeholders:
	//   {player}         — current player's name
	//   {nameNo}         — the nameNo field on this archetype
	//   {involvedPlayer} — the other player's name (tribunal-style archetypes)
	archetypes: [
		{
			id: 'classic_search',
			name: 'Classic Search',
			nameNo: 'Klassisk Søk',
			emoji: '🔍',
			titleTemplate: '{player} søker lykken',
			weight: 20,
			machineType: 'search_term',
			betProfiles: ['safe_grind', 'balanced'],
			allowSocialEffect: false,
			requireSocialEffect: false
		},
		{
			id: 'provider_tribunal',
			name: 'Provider Tribunal',
			nameNo: 'Leverandørens Lojale',
			emoji: '⚖️',
			titleTemplate: '{nameNo} — {involvedPlayer} velger',
			weight: 14,
			machineType: 'provider_by_player',
			betProfiles: ['balanced', 'high_roller', 'cursed'],
			allowSocialEffect: true,
			requireSocialEffect: true,
			requiresOtherPlayer: true
		},
		{
			id: 'machine_tribunal',
			name: 'Machine Tribunal',
			nameNo: 'Maskinens Mester',
			emoji: '🎰',
			titleTemplate: '{nameNo} — {involvedPlayer} bestemmer',
			weight: 10,
			machineType: 'machine_by_player',
			betProfiles: ['balanced', 'high_roller', 'cursed'],
			allowSocialEffect: false,
			requireSocialEffect: false,
			requiresOtherPlayer: true
		},
		{
			id: 'jackpot_hunt',
			name: 'Jackpot Hunt',
			nameNo: 'Jackpot-Jakt',
			emoji: '💰',
			titleTemplate: '{player} jakter jackpot!',
			weight: 10,
			machineType: 'category_jackpot',
			betProfiles: ['balanced', 'high_roller'],
			allowSocialEffect: true,
			requireSocialEffect: false
		},
		{
			id: 'megaways_madness',
			name: 'Megaways Madness',
			nameNo: 'Megaways Galskap',
			emoji: '🌀',
			titleTemplate: '{nameNo}',
			weight: 12,
			machineType: 'category_megaways',
			betProfiles: ['safe_grind', 'balanced', 'high_roller'],
			allowSocialEffect: true,
			requireSocialEffect: false
		},
		{
			id: 'high_roller_trial',
			name: 'High Roller Trial',
			nameNo: 'storspiller-test',
			emoji: '💎',
			titleTemplate: '{player} sin {nameNo}',
			weight: 10,
			machineType: 'any',
			forceBetProfile: 'high_roller',
			allowSocialEffect: true,
			requireSocialEffect: false
		},
		{
			id: 'safe_grind',
			name: 'Safe Grind',
			nameNo: 'trygge kosetur',
			emoji: '🛡️',
			titleTemplate: '{player} sin {nameNo}',
			weight: 8,
			machineType: 'any',
			forceBetProfile: 'safe_grind',
			allowSocialEffect: false,
			requireSocialEffect: false
		},
		{
			id: 'chaos_council',
			name: 'Chaos Council',
			nameNo: 'Kaosrådet',
			emoji: '🃏',
			titleTemplate: '{nameNo} har talt!',
			weight: 8,
			machineType: 'chaos',
			forceBetProfile: 'cursed',
			allowSocialEffect: true,
			requireSocialEffect: false,
			allowWeirdModifiers: true
		},
		{
			id: 'provider_pick',
			name: 'Provider Pick',
			nameNo: 'Leverandør-låsen',
			emoji: '🏭',
			titleTemplate: '{player} velger leverandør',
			weight: 12,
			machineType: 'fixed_provider',
			betProfiles: ['safe_grind', 'balanced', 'high_roller'],
			allowSocialEffect: true,
			requireSocialEffect: false
		}
	],

	// Bet profiles control which bet/spin tiers are valid and which play styles are preferred.
	betProfiles: {
		safe_grind: {
			id: 'safe_grind',
			name: 'Safe Grind',
			nameNo: 'Trygg Grind',
			betTiers: ['low'],
			spinTiers: ['many'],
			preferManual: false,
			allowManualOnly: false
		},
		balanced: {
			id: 'balanced',
			name: 'Balanced',
			nameNo: 'Balansert',
			betTiers: ['low', 'medium'],
			spinTiers: ['few', 'medium', 'many'],
			preferManual: false,
			allowManualOnly: true
		},
		high_roller: {
			id: 'high_roller',
			name: 'High Roller',
			nameNo: 'Storspiller',
			betTiers: ['high'],
			spinTiers: ['few', 'medium'],
			preferManual: true,
			allowManualOnly: true
		},
		cursed: {
			id: 'cursed',
			name: 'Cursed',
			nameNo: 'Forbannet',
			betTiers: ['low', 'medium', 'high'],
			spinTiers: ['few', 'medium', 'many'],
			preferManual: false,
			allowManualOnly: true,
			allowWeirdRules: true
		}
	},

	playStyles: [
		{
			id: 'free_choice',
			label: 'Free choice',
			labelNo: 'Valgfri spillestil',
			betProfiles: ['safe_grind', 'balanced', 'high_roller', 'cursed'],
			weight: 15
		},
		{
			id: 'autoplay_required',
			label: 'Autoplay required',
			labelNo: 'Autoplay påkrevd',
			betProfiles: ['safe_grind', 'cursed'],
			weight: 10
		},
		{
			id: 'manual_only',
			label: 'Manual spins only',
			labelNo: 'KUN manuelle spins',
			betProfiles: ['high_roller'],
			// Only valid when spin count is few/medium — enforced in validator
			weight: 12
		},
	],

	modifiers: [
		{
			id: 'no_modifier',
			label: 'Ingen spesialregel',
			labelNo: 'Ingen spesialregel',
			betProfiles: ['safe_grind', 'balanced', 'high_roller', 'cursed'],
			weight: 25
		},
		{
			id: 'change_after_dead',
			label: 'Change machine after 10 dead spins',
			labelNo: 'Bytt maskin etter 10 dead-spins',
			betProfiles: ['balanced', 'cursed'],
			weight: 8
		},
		{
			id: 'big_win_keep_turn',
			label: 'Win above 50x = keep the turn',
			labelNo: '10x gevinst = behold turen, spinn igjen!',
			betProfiles: ['balanced', 'high_roller', 'cursed'],
			weight: 10
		},
	],

	socialEffects: [
		{
			id: 'veto_once',
			label: '{name} kan veto maskin én gang',
			weight: 18
		},
		{
			id: 'veto_once',
			label: '{name} kan avgjøre om bandittomaten skal respinnes',
			weight: 18
		},
		{
			id: 'vendor_decider',
			label: '{name} bestemmer leverandør',
			weight: 12
		},
		{
			id: 'search_term_picker',
			label: '{name} velger søkeord',
			weight: 15
		},
		{
			id: 'search_term_picker',
			label: '{name} kan justere innsatsen ett hakk opp eller ned.',
			weight: 12
		},
	],

	bonusRules: [
		{
			id: 'keep_turn_on_bonus',
			label: 'Bonus = behold turen. Spinn bandittomaten om igjen!',
			weight: 12
		},
		{
			id: 'stop_on_bonus',
			label: 'Bonus = Stopp maskinen å bytt spiller!',
			weight: 12
		},
		{
			id: 'bonus_extend_25',
			label: 'Bonus = legg til 25 ekstra spins på samme maskin',
			weight: 14
		},
		{
			id: 'bonus_extend_half',
			label: 'Bonus = spill halvparten av opprinnelige spins én gang til',
			weight: 12
		},
		{
			id: 'bonus_double_bet_10',
			label: 'Bonus = 10 ekstra spins med dobbel innsats',
			weight: 8
		},
		{
			id: 'bonus_raise_one_tier',
			label: 'Bonus = øk innsatsen ett hakk og spill 10 ekstra spins',
			weight: 10
		},
		{
			id: 'bonus_change_provider_keep_theme',
			label: 'Bonus = bytt provider, behold vilkår!',
			weight: 7
		},
		{
			id: 'bonus_new_machine_same_rules',
			label: 'Bonus = velg ny maskin, men behold spins og innsats',
			weight: 8
		},
	],

	// Machine categories — used by category_* machineTypes and as the random pool in 'any'/'chaos'.
	// Add a new entry here to make it available as both a dedicated archetype machineType
	// (name it category_<id> in the archetype) and as a random option in general rounds.
	machineCategories: [
		{ id: 'jackpot',      label: 'Jackpot maskin',        emoji: '💰' },
		{ id: 'megaways',     label: 'Megaways maskin',       emoji: '🌀' },
		{ id: 'cluster_win',  label: 'Cluster Win maskin',    emoji: '🧩' },
		{ id: 'cascading',    label: 'Cascading Maskin',      emoji: '💎' },
		{ id: 'tumble',       label: 'Tumble Maskin',         emoji: '🌊' },
		{ id: 'hold_win',     label: '"Hold and Win" Maskin', emoji: '🔒' },
		{ id: 'three_reel',   label: '3-Reel Maskin',         emoji: '🍒' },
	],

	// Decoy items shown on the spinning reels — purely cosmetic, never affect the actual result.
	reelDecoys: {
		machine: [
			'Søk: Wild', 'Søk: Book', 'Søk: Dragon', 'Megaways 🌀',
			'Jackpot 💰', 'Pragmatic Play', 'Hacksaw Gaming', "Play'n GO",
			'Nolimit City', 'Bonus Buy 🛒', 'Push Gaming', 'Søk: Gold',
			'Big Time Gaming', 'Red Tiger', 'Søk: Viking', 'ELK Studios'
		],
		modifier: [
			'Autoplay', 'Turbo spins', 'Ingen turbo', 'Free choice',
			'Manuelle spins', 'KUN manuell', 'Autoplay påkrevd',
			'Stop after win', 'Bytt etter 10 null', 'Valgfritt'
		]
	},

	// Blackjack bonus — rolls after every spin.
	// chance:              probability per spin (0.10 = 10 %)
	// handBetOptions:      possible main-hand bets (€)
	// sideBetOptions:      possible sidebet amounts (€, min 1)
	// maxHandsMultiplier:  fraction of balance used to calculate hand count
	// maxHands / minHands: caps
	blackjackBonus: {
		chanceStep:          0.05,  // added to bonusChance each spin
		chanceOnReset:       0.05,  // bonusChance value after a bonus triggers
		handBetOptions:      [5, 6, 7, 8, 9, 10, 12, 15, 20],
		sideBetOptions:      [1, 2, 3, 4],
		maxHandsMultiplier:  0.35,
		maxHands:            8,
		minHands:            1
	},

	// Balance delta (€) that triggers big-win fanfare instead of normal confetti
	bigWinThreshold: 20,

	defaultPlayers: [

	],

	avatarPresets: [
		'🎩', '🧢', '🤠', '🥸', '🧐', '😎', '🤓', '🧔',
		'👴', '🧓', '👨‍🦳', '👨‍🦲', '👨‍💼', '🕵️', '👑', '💀',
		'🎲', '🃏', '🎰', '♠️', '♥️', '♦️', '♣️', '💎',
		'🏆', '🎯', '🍀', '🔥', '⚡', '💰', '💵', '🥃',
		'🍺', '🍷', '🥂', '🚬', '🐻', '🦊', '🐺', '🦁',
		'🐯', '🦅', '🐗', '🦍', '🐉', '🦹', '🧙', '🤡'
	],

    playerColors: [
    	'#FF6B6B', // coral red
    	'#4D96FF', // bright blue
    	'#B983FF', // lavender purple
    	'#FFD166', // warm yellow
    	'#06D6A0', // mint green
    	'#FF9F1C', // orange
    	'#F15BB5', // pink
    	'#7BDFF2', // sky cyan
    	'#A0E426', // lime
    	'#5EEAD4', // aqua teal
    	'#C77DFF', // vivid violet
    	'#FF8FAB'  // soft rose
    ]
};

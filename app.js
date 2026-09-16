const MIN_PLAYERS = 2;
const MAX_PLAYERS = 8;
const TURN_SECONDS = 30 * 60;
const STORAGE_KEY = 'mesa-arcana-game-v1';
const PROFILES_KEY = 'mesa-arcana-player-profiles-v1';
const COLORS = [
  '4, 42, 43',
  '36, 22, 35',
  '252, 208, 161',
  '10, 16, 13',
  '163, 124, 64',
  '229, 116, 188',
  '80, 128, 142',
  '91, 48, 0',
];
const COLOR_CHOICES = [
  '42, 39, 44',
  '14, 104, 171',
  '202, 55, 45',
  '0, 115, 62',
  '238, 230, 197',
];
const PLAYER_COUNTER_TYPES = {
  poison: {
    label: 'Veneno',
    property: 'poisonCounters',
    image: 'assets/poison.svg',
    color: '35, 91, 54',
  },
  radiation: {
    label: 'Radiação',
    property: 'radiationCounters',
    image: 'assets/rad.svg',
    color: '188, 91, 24',
  },
};
const SOUND_PATHS = {
  death: 'assets/soms/morte.mp3',
  commanderDamage: 'assets/soms/dano_comandante.mp3',
  randomTurn: [1, 3, 4, 5, 6, 7, 8, 9].map((number) => `assets/soms/botao_aleatorio/${number}.mp3`),
  foolishToken: Array.from({ length: 9 }, (_, index) => `assets/soms/burro/${index + 1}.mp3`),
  victory: Array.from({ length: 4 }, (_, index) => `assets/soms/vitoria/${index + 1}.mp3`),
};
const ALL_SOUND_PATHS = [
  SOUND_PATHS.death,
  SOUND_PATHS.commanderDamage,
  ...SOUND_PATHS.randomTurn,
  ...SOUND_PATHS.foolishToken,
  ...SOUND_PATHS.victory,
];

const app = document.querySelector('#app');
const template = document.querySelector('#player-template');
const imageDialog = document.querySelector('#image-dialog');
const searchForm = document.querySelector('#image-search');
const searchInput = document.querySelector('#image-query');
const searchStatus = document.querySelector('#search-status');
const imageResults = document.querySelector('#image-results');
const passTurnButton = document.querySelector('#pass-turn');
const turnControls = document.querySelector('#turn-controls');
const pauseGameButton = document.querySelector('#pause-game');
const pauseGameLabel = document.querySelector('#pause-game-label');
const arrangeTableButton = document.querySelector('#arrange-table');
const arrangeTableLabel = document.querySelector('#arrange-table-label');
const newGameDialog = document.querySelector('#new-game-dialog');
const newGamePlayerCount = document.querySelector('#new-game-player-count');
const newGameCustomTime = document.querySelector('#new-game-custom-time');
const newGameCustomLife = document.querySelector('#new-game-custom-life');
const newGameUseFoolishToken = document.querySelector('#new-game-use-foolish-token');
const customTimeField = document.querySelector('#custom-time-field');
const customLifeField = document.querySelector('#custom-life-field');
const profilesDialog = document.querySelector('#profiles-dialog');
const gameLogDialog = document.querySelector('#game-log-dialog');
const gameLogList = document.querySelector('#game-log-list');
const gameLogEmpty = document.querySelector('#game-log-empty');
const logRestoreDialog = document.querySelector('#log-restore-dialog');
const logRestoreMessage = document.querySelector('#log-restore-message');
const playerSettingsName = document.querySelector('#player-settings-name');
const colorOptions = document.querySelector('#color-options');
const customColor = document.querySelector('#custom-color');
const soundButton = document.querySelector('#toggle-sound');
const soundLabel = document.querySelector('#sound-label');
const victoryConfetti = document.querySelector('#victory-confetti');

let imagePlayerId = null;
let isReordering = false;
let draftTableOrder = null;
let isChoosingStarter = false;
let isGameLogOpen = false;
const pendingLifeChanges = new Map();
const lifeChangeTimers = new Map();
let lastTimerTick = Date.now();
let soundContext = null;
const soundBuffers = new Map();
const soundLoads = new Map();
const mediaSounds = new Map();
const activeSoundSources = new Set();
let victoryAnimation = null;
let victorySoundTimer = null;
let victoryConfettiTimer = null;
let reverseTurnHoldTimer = null;
let reverseTurnTriggered = false;
let turnButtonRotation = 0;
let turnButtonSide = 0;
let pendingLogRestoreId = null;
const timerBlockingModals = new Set();

function randomBytes(length) {
  const bytes = new Uint8Array(length);
  if (globalThis.crypto?.getRandomValues) return globalThis.crypto.getRandomValues(bytes);
  for (let index = 0; index < length; index += 1) bytes[index] = Math.floor(Math.random() * 256);
  return bytes;
}

function createId() {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
  const bytes = randomBytes(16);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function randomIndex(length) {
  const bytes = randomBytes(4);
  const value = new DataView(bytes.buffer).getUint32(0);
  return value % length;
}

function initializeMediaSounds() {
  ALL_SOUND_PATHS.forEach((path) => {
    if (mediaSounds.has(path)) return;
    const audio = new Audio(path);
    audio.preload = 'auto';
    audio.load();
    mediaSounds.set(path, audio);
  });
}

function initializeSounds() {
  if (location.protocol === 'file:') {
    initializeMediaSounds();
    return null;
  }
  const AudioContextClass = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!AudioContextClass) return null;
  if (navigator.audioSession) {
    try {
      navigator.audioSession.type = 'playback';
    } catch {}
  }
  if (!soundContext) soundContext = new AudioContextClass();
  soundContext.resume().catch(() => {});
  ALL_SOUND_PATHS.forEach((path) => {
    if (soundLoads.has(path)) return;
    const load = fetch(path)
      .then((response) => response.arrayBuffer())
      .then((data) => soundContext.decodeAudioData(data))
      .then((buffer) => {
        soundBuffers.set(path, buffer);
        return buffer;
      })
      .catch(() => null);
    soundLoads.set(path, load);
  });
  return soundContext;
}

function unlockSounds() {
  const context = initializeSounds();
  if (!context) return;
  context.resume().then(() => {
    const source = context.createBufferSource();
    source.buffer = context.createBuffer(1, 1, context.sampleRate);
    source.connect(context.destination);
    source.start();
  }).catch(() => {});
}

async function playSound(path) {
  if (state.soundMuted) return;
  const context = initializeSounds();
  if (!context) {
    const audio = mediaSounds.get(path) || new Audio(path);
    audio.pause();
    audio.volume = 1;
    const play = () => {
      audio.currentTime = path === SOUND_PATHS.death ? 0.33 : 0;
      audio.play().catch(() => {});
    };
    if (audio.readyState >= HTMLMediaElement.HAVE_METADATA) play();
    else audio.addEventListener('loadedmetadata', play, { once: true });
    return;
  }
  const buffer = soundBuffers.get(path) || await soundLoads.get(path);
  if (!buffer || state.soundMuted) return;
  if (context.state !== 'running') await context.resume().catch(() => {});
  const source = context.createBufferSource();
  const gain = context.createGain();
  gain.gain.value = 1;
  source.buffer = buffer;
  source.connect(gain).connect(context.destination);
  activeSoundSources.add(source);
  source.addEventListener('ended', () => activeSoundSources.delete(source), { once: true });
  source.start(0, path === SOUND_PATHS.death ? 0.33 : 0);
}

function stopAllSounds() {
  clearTimeout(victorySoundTimer);
  victorySoundTimer = null;
  activeSoundSources.forEach((source) => {
    try {
      source.stop();
    } catch {}
  });
  activeSoundSources.clear();
  mediaSounds.forEach((audio) => {
    audio.pause();
    audio.currentTime = 0;
  });
}

function startVictoryCelebration() {
  clearTimeout(victoryConfettiTimer);
  victoryConfettiTimer = null;
  const winnerCard = app.querySelector(`[data-player-id="${state.winnerPlayerId}"]`);
  const winnerRect = winnerCard?.getBoundingClientRect();
  const originX = winnerRect ? winnerRect.left + winnerRect.width / 2 : innerWidth / 2;
  const originY = winnerRect ? winnerRect.top + winnerRect.height / 2 : innerHeight / 2;
  victoryConfetti.style.setProperty('--victory-x', `${originX}px`);
  victoryConfetti.style.setProperty('--victory-y', `${originY}px`);
  victoryConfetti.style.setProperty('--victory-shift-x', `${originX - innerWidth / 2}px`);
  victoryConfetti.style.setProperty('--victory-shift-y', `${originY - innerHeight / 2}px`);
  victoryConfetti.hidden = false;
  if (location.protocol === 'file:' || !globalThis.lottie) {
    victoryConfetti.classList.add('css-confetti');
    victoryConfettiTimer = setTimeout(hideVictoryConfetti, 9200);
    return;
  }
  victoryConfetti.classList.remove('css-confetti');
  if (victoryAnimation) return;
  let completedLoops = 0;
  victoryAnimation = globalThis.lottie.loadAnimation({
    container: victoryConfetti,
    renderer: 'svg',
    loop: false,
    autoplay: true,
    path: 'assets/confetti.json',
  });
  victoryAnimation.addEventListener('complete', () => {
    completedLoops += 1;
    if (state.winnerPlayerId && completedLoops < 2) victoryAnimation?.goToAndPlay(0, true);
    else hideVictoryConfetti();
  });
}

function hideVictoryConfetti() {
  clearTimeout(victoryConfettiTimer);
  victoryConfettiTimer = null;
  victoryAnimation?.destroy();
  victoryAnimation = null;
  victoryConfetti.replaceChildren();
  victoryConfetti.classList.remove('css-confetti');
  victoryConfetti.hidden = true;
}

function stopVictoryCelebration() {
  hideVictoryConfetti();
}

function checkForWinner() {
  if (!state.gameStarted) return;
  const survivors = state.players.filter((player) => !isPlayerEliminated(player));
  const nextWinnerId = survivors.length === 1 ? survivors[0].id : null;
  if (state.winnerPlayerId === nextWinnerId) return;
  const previousWinnerId = state.winnerPlayerId;
  state.winnerPlayerId = nextWinnerId;
  app.querySelectorAll('.player-card').forEach((card) => {
    card.classList.toggle('is-winner', card.dataset.playerId === nextWinnerId);
  });
  if (nextWinnerId) {
    state.priorityPlayerId = null;
    startVictoryCelebration();
    victorySoundTimer = setTimeout(() => {
      if (state.winnerPlayerId === nextWinnerId) {
        playSound(SOUND_PATHS.victory[randomIndex(SOUND_PATHS.victory.length)]);
      }
    }, 700);
  } else if (previousWinnerId) {
    stopAllSounds();
    stopVictoryCelebration();
  }
  updateControls();
  saveState();
}

function playDeathSoundIfNeeded(player, wasEliminated) {
  if (!wasEliminated && isPlayerEliminated(player)) {
    playSound(SOUND_PATHS.death);
    checkForWinner();
  }
}

function isPlayerEliminated(player) {
  return player.life <= 0
    || (Number.isFinite(player.timerSeconds) && player.timerSeconds <= 0)
    || player.poisonCounters >= 10
    || Object.values(player.commanderDamage || {}).some((damage) => damage >= 21);
}

function pauseTimerForPlayerModal(playerId, modal) {
  if (state.timerMinutes === null || !state.gameStarted) return;
  if (playerId !== (state.priorityPlayerId || state.turnPlayerId)) return;
  tickTimer();
  timerBlockingModals.add(modal);
  lastTimerTick = Date.now();
}

function releaseTimerForModal(modal) {
  if (!timerBlockingModals.delete(modal)) return;
  lastTimerTick = Date.now();
}

function makePlayer(index, life = 40, timerSeconds = TURN_SECONDS) {
  return {
    id: createId(),
    profileId: createId(),
    name: `Jogador ${index + 1}`,
    color: COLORS[index],
    life,
    timerSeconds,
    commanderDamage: {},
    poisonCounters: 0,
    radiationCounters: 0,
    foolishTokenAvailable: true,
    image: null,
    artist: null,
    cardName: null,
  };
}

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (saved?.players?.length >= MIN_PLAYERS && saved.players.length <= MAX_PLAYERS) {
      const timerMinutes = saved.timerMinutes === null
        ? null
        : Number.isInteger(saved.timerMinutes) && saved.timerMinutes > 0 ? saved.timerMinutes : 30;
      const players = saved.players.map((player, index) => ({
        ...player,
        color: player.color || COLORS[index],
        life: Number.isFinite(player.life) ? Math.max(0, player.life) : (saved.startingLife || 40),
        commanderDamage: player.commanderDamage || {},
        poisonCounters: Number.isFinite(player.poisonCounters) ? Math.max(0, player.poisonCounters) : 0,
        radiationCounters: Number.isFinite(player.radiationCounters) ? Math.max(0, player.radiationCounters) : 0,
        foolishTokenAvailable: player.foolishTokenAvailable !== false,
        timerSeconds: timerMinutes === null
          ? null
          : Number.isFinite(player.timerSeconds) ? player.timerSeconds : timerMinutes * 60,
      }));
      const priorityPlayerId = players.some((player) => player.id === saved.priorityPlayerId && !isPlayerEliminated(player))
        ? saved.priorityPlayerId
        : null;
      const turnPlayerId = players.some((player) => player.id === saved.turnPlayerId)
        ? saved.turnPlayerId
        : players[0].id;
      const turnNumber = Number.isInteger(saved.turnNumber) && saved.turnNumber > 0 ? saved.turnNumber : 1;
      const gameStarted = typeof saved.gameStarted === 'boolean' ? saved.gameStarted : true;
      const gamePaused = timerMinutes === null
        ? false
        : typeof saved.gamePaused === 'boolean' ? saved.gamePaused : false;
      const soundMuted = saved.soundMuted === true;
      const useFoolishToken = saved.useFoolishToken !== false;
      const winnerPlayerId = players.some((player) => player.id === saved.winnerPlayerId)
        ? saved.winnerPlayerId
        : null;
      const savedTableOrder = Array.isArray(saved.tableOrder) ? saved.tableOrder : [];
      const tableOrder = savedTableOrder.length === players.length
        && new Set(savedTableOrder).size === players.length
        && savedTableOrder.every((id) => players.some((player) => player.id === id))
        ? savedTableOrder
        : players.map((player) => player.id);
      const roundStartPlayerId = players.some((player) => player.id === saved.roundStartPlayerId)
        ? saved.roundStartPlayerId
        : tableOrder[0];
      const gameLog = Array.isArray(saved.gameLog) ? saved.gameLog : [];
      const redoLog = Array.isArray(saved.redoLog) ? saved.redoLog : [];
      const savedPendingLifeChanges = Array.isArray(saved.pendingLifeChanges) ? saved.pendingLifeChanges : [];
      return { ...saved, players, tableOrder, priorityPlayerId: timerMinutes === null ? null : priorityPlayerId, turnPlayerId, roundStartPlayerId, turnNumber, gameStarted, gamePaused, soundMuted, useFoolishToken, winnerPlayerId, timerMinutes, gameLog, redoLog, savedPendingLifeChanges };
    }
  } catch (_) {
    // A partida simplesmente recomeça se os dados locais estiverem inválidos.
  }
  const players = Array.from({ length: 4 }, (_, i) => makePlayer(i));
  return {
    startingLife: 40,
    timerMinutes: 30,
    useFoolishToken: true,
    players,
    tableOrder: players.map((player) => player.id),
    priorityPlayerId: null,
    turnPlayerId: players[0].id,
    roundStartPlayerId: players[0].id,
    turnNumber: 1,
    gameStarted: false,
    gamePaused: false,
    soundMuted: false,
    winnerPlayerId: null,
    gameLog: [],
    redoLog: [],
    savedPendingLifeChanges: [],
  };
}

function loadProfiles() {
  try {
    const saved = JSON.parse(localStorage.getItem(PROFILES_KEY));
    return Array.isArray(saved) ? saved : [];
  } catch (_) {
    return [];
  }
}

let profiles = loadProfiles();
let state = loadState();
state.savedPendingLifeChanges.forEach(([playerId, pending]) => {
  if (state.players.some((player) => player.id === playerId) && Number.isFinite(pending?.delta) && pending.before) {
    pendingLifeChanges.set(playerId, pending);
  }
});
delete state.savedPendingLifeChanges;

function saveProfiles() {
  localStorage.setItem(PROFILES_KEY, JSON.stringify(profiles));
}

function savePlayerProfile(player) {
  const profile = {
    id: player.profileId,
    name: player.name,
    image: player.image,
    artist: player.artist,
    cardName: player.cardName,
    color: player.color,
  };
  const index = profiles.findIndex((item) => item.id === profile.id);
  if (index >= 0) profiles[index] = profile;
  else profiles.push(profile);
  saveProfiles();
}

state.players.forEach((player) => {
  if (!player.profileId) player.profileId = createId();
  if (!profiles.some((profile) => profile.id === player.profileId)) savePlayerProfile(player);
});
saveState();

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    startingLife: state.startingLife,
    timerMinutes: state.timerMinutes,
    useFoolishToken: state.useFoolishToken,
    priorityPlayerId: state.priorityPlayerId,
    turnPlayerId: state.turnPlayerId,
    roundStartPlayerId: state.roundStartPlayerId,
    turnNumber: state.turnNumber,
    gameStarted: state.gameStarted,
    gamePaused: state.gamePaused,
    soundMuted: state.soundMuted,
    winnerPlayerId: state.winnerPlayerId,
    tableOrder: state.tableOrder,
    players: state.players,
    gameLog: state.gameLog,
    redoLog: state.redoLog,
    pendingLifeChanges: [...pendingLifeChanges.entries()],
  }));
}

function formatTime(totalSeconds) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function gameSnapshot() {
  return {
    players: state.players.map((player) => ({
      id: player.id,
      life: player.life,
      timerSeconds: player.timerSeconds,
      commanderDamage: { ...player.commanderDamage },
      poisonCounters: player.poisonCounters,
      radiationCounters: player.radiationCounters,
      foolishTokenAvailable: player.foolishTokenAvailable,
    })),
    priorityPlayerId: state.priorityPlayerId,
    turnPlayerId: state.turnPlayerId,
    roundStartPlayerId: state.roundStartPlayerId,
    turnNumber: state.turnNumber,
    gamePaused: state.gamePaused,
    winnerPlayerId: state.winnerPlayerId,
    tableOrder: [...state.tableOrder],
  };
}

function restoreGameSnapshot(snapshot) {
  const hadWinner = Boolean(state.winnerPlayerId);
  snapshot.players.forEach((savedPlayer) => {
    const player = state.players.find((item) => item.id === savedPlayer.id);
    if (!player) return;
    player.life = savedPlayer.life;
    if (Number.isFinite(savedPlayer.timerSeconds) || savedPlayer.timerSeconds === null) {
      player.timerSeconds = savedPlayer.timerSeconds;
    }
    player.commanderDamage = { ...savedPlayer.commanderDamage };
    player.poisonCounters = savedPlayer.poisonCounters || 0;
    player.radiationCounters = savedPlayer.radiationCounters || 0;
    player.foolishTokenAvailable = savedPlayer.foolishTokenAvailable !== false;
  });
  state.priorityPlayerId = snapshot.priorityPlayerId;
  state.turnPlayerId = snapshot.turnPlayerId;
  state.roundStartPlayerId = snapshot.roundStartPlayerId;
  state.turnNumber = snapshot.turnNumber;
  state.gamePaused = snapshot.gamePaused;
  state.winnerPlayerId = snapshot.winnerPlayerId || null;
  if (Array.isArray(snapshot.tableOrder)
    && snapshot.tableOrder.length === state.players.length
    && snapshot.tableOrder.every((id) => state.players.some((player) => player.id === id))) {
    state.tableOrder = [...snapshot.tableOrder];
  }
  if (state.winnerPlayerId) startVictoryCelebration();
  else if (hadWinner) {
    stopAllSounds();
    stopVictoryCelebration();
  }
}

function addLogEntry(type, message, before, undoable = true, playerId = null) {
  if (!state.gameStarted) return;
  const player = state.players.find((item) => item.id === playerId);
  state.gameLog.push({
    id: createId(),
    type,
    message,
    timestamp: new Date().toISOString(),
    undoable,
    before,
    after: gameSnapshot(),
    playerId: player?.id || null,
    playerVisual: player ? { name: player.name, color: player.color, image: player.image } : null,
  });
  state.redoLog = [];
  saveState();
  updateControls();
}

function logPlayerEliminationChange(player, wasEliminated, before) {
  const eliminated = isPlayerEliminated(player);
  if (eliminated === wasEliminated) return;
  addLogEntry(
    eliminated ? 'death' : 'revival',
    eliminated ? `${player.name} morreu` : `${player.name} ressuscitou`,
    before,
    true,
    player.id,
  );
}

function updateControls() {
  document.querySelector('#turn-number').textContent = state.turnNumber;
  const passLabel = passTurnButton.querySelector('.pass-label');
  const turnStatus = passTurnButton.querySelector('.turn-status');
  const pausedStatus = passTurnButton.querySelector('.paused-status');
  const priorityActive = state.timerMinutes !== null && Boolean(state.priorityPlayerId);
  const gameWon = state.gameStarted && Boolean(state.winnerPlayerId);
  turnStatus.hidden = gameWon || isReordering || !state.gameStarted || state.gamePaused || priorityActive;
  pausedStatus.hidden = gameWon || !state.gameStarted || !state.gamePaused || isReordering;
  passLabel.textContent = gameWon
    ? 'GG'
    : isChoosingStarter
    ? 'Sorteando…'
    : isReordering
      ? 'Confirmar'
      : state.gamePaused
        ? 'Continuar jogo'
        : priorityActive ? 'Encerrar prioridade' : state.gameStarted ? 'Passar turno' : 'Começar jogo';
  passTurnButton.classList.toggle('no-status', turnStatus.hidden && pausedStatus.hidden);
  passTurnButton.classList.toggle('game-paused', state.gameStarted && state.gamePaused);
  passTurnButton.classList.toggle('priority-active', priorityActive);
  passTurnButton.classList.toggle('game-over', gameWon);
  passTurnButton.classList.toggle('confirm-reorder', isReordering);
  passTurnButton.classList.toggle(
    'ready-to-start',
    !gameWon && !isReordering && !isChoosingStarter && (!state.gameStarted || state.gamePaused),
  );
  passTurnButton.disabled = isChoosingStarter || gameWon;
  const orientedPlayerId = state.winnerPlayerId || state.priorityPlayerId || state.turnPlayerId;
  const turnPlayerTableIndex = tableIndexForPlayer(orientedPlayerId);
  const nextTurnButtonSide = !isReordering && turnPlayerTableIndex < opponentCount(state.players.length)
    ? 1
    : 0;
  if (!isReordering && nextTurnButtonSide !== turnButtonSide) {
    turnButtonRotation += 180;
    turnButtonSide = nextTurnButtonSide;
  }
  turnControls.style.setProperty('--turn-button-rotation', `${turnButtonRotation}deg`);
  passTurnButton.setAttribute('aria-label', isReordering
    ? 'Confirmar reorganização da mesa'
    : gameWon
      ? 'GG — partida encerrada'
    : state.gamePaused
      ? 'Continuar jogo'
      : priorityActive ? 'Encerrar prioridade' : state.gameStarted ? `Passar o turno ${state.turnNumber}` : 'Começar jogo');
  arrangeTableButton.classList.toggle('active', isReordering);
  arrangeTableButton.setAttribute('aria-pressed', String(isReordering));
  arrangeTableLabel.textContent = isReordering ? 'Confirmar' : 'Reorganizar';
  document.body.classList.toggle('is-reordering', isReordering);
  document.body.classList.toggle('is-choosing-starter', isChoosingStarter);
  document.body.classList.toggle('is-game-paused', state.gamePaused);
  pauseGameButton.disabled = !state.gameStarted || state.timerMinutes === null || isChoosingStarter;
  pauseGameButton.classList.toggle('is-paused', state.gamePaused);
  pauseGameLabel.textContent = state.gamePaused ? 'Continuar' : 'Pausar';
  soundButton.classList.toggle('is-muted', state.soundMuted);
  soundButton.setAttribute('aria-pressed', String(state.soundMuted));
  soundLabel.textContent = state.soundMuted ? 'Ativar som' : 'Mutar';
}

function opponentCount(playerCount) {
  return { 2: 1, 3: 1, 4: 2, 5: 2, 6: 3, 7: 4, 8: 4 }[playerCount];
}

function discardPendingLifeChanges() {
  lifeChangeTimers.forEach(clearTimeout);
  lifeChangeTimers.clear();
  pendingLifeChanges.clear();
}

function finishLifeChange(playerId) {
  const pending = pendingLifeChanges.get(playerId);
  if (!pending) return;
  clearTimeout(lifeChangeTimers.get(playerId));
  lifeChangeTimers.delete(playerId);
  pendingLifeChanges.delete(playerId);
  app.querySelector(`[data-player-id="${playerId}"] .life-change`)?.classList.remove('visible');
  if (pending.delta === 0) {
    saveState();
    return;
  }
  const player = state.players.find((item) => item.id === playerId);
  if (!player) return;
  const action = pending.delta > 0 ? 'ganhou' : 'perdeu';
  addLogEntry('life', `${player.name} ${action} ${Math.abs(pending.delta)} de vida`, pending.before, true, player.id);
}

function finishPendingLifeChanges() {
  [...pendingLifeChanges.keys()].forEach(finishLifeChange);
}

function playersInTableOrder() {
  const order = draftTableOrder || state.tableOrder;
  return order.map((id) => state.players.find((player) => player.id === id)).filter(Boolean);
}

function otherPlayersClockwiseFrom(playerId) {
  const orderedPlayers = playersInTableOrder();
  const playerIndex = orderedPlayers.findIndex((player) => player.id === playerId);
  return [...orderedPlayers.slice(playerIndex + 1), ...orderedPlayers.slice(0, playerIndex)];
}

function tableIndexForPlayer(playerId) {
  return (draftTableOrder || state.tableOrder).indexOf(playerId);
}

function moveNamesClearOfTurnButton() {
  const buttonRect = passTurnButton.getBoundingClientRect();
  const buttonCenterX = buttonRect.left + buttonRect.width / 2;
  const buttonCenterY = buttonRect.top + buttonRect.height / 2;
  const buttonRadius = buttonRect.width / 2;
  const textContext = document.createElement('canvas').getContext('2d');
  app.querySelectorAll('.player-card').forEach((card) => {
    const name = card.querySelector('.player-name-wrap');
    const input = name.querySelector('.player-name');
    name.style.removeProperty('top');
    card.classList.remove('name-near-center');
    const inputRect = input.getBoundingClientRect();
    textContext.font = getComputedStyle(input).font;
    const displayedName = input instanceof HTMLInputElement ? input.value : input.textContent;
    const textWidth = Math.min(inputRect.width, textContext.measureText(displayedName).width + 8);
    const nameRect = {
      top: inputRect.top,
      right: inputRect.left + (inputRect.width + textWidth) / 2,
      bottom: inputRect.bottom,
      left: inputRect.left + (inputRect.width - textWidth) / 2,
    };
    const closestX = Math.max(nameRect.left, Math.min(buttonCenterX, nameRect.right));
    const closestY = Math.max(nameRect.top, Math.min(buttonCenterY, nameRect.bottom));
    const overlapsButton = Math.hypot(closestX - buttonCenterX, closestY - buttonCenterY) < buttonRadius + 4;
    if (!overlapsButton) return;
    const clearance = card.classList.contains('is-opponent')
      ? nameRect.bottom - buttonRect.top + 8
      : buttonRect.bottom - nameRect.top + 8;
    name.style.top = `${parseFloat(getComputedStyle(name).top) + clearance}px`;
    card.classList.add('name-near-center');
  });
}

function bindPlayerNameButton(button, player, fallbackName) {
  button.textContent = player.name;
  button.addEventListener('click', (event) => {
    event.stopPropagation();
    const input = document.createElement('input');
    input.className = 'player-name is-editing';
    input.maxLength = 20;
    input.setAttribute('aria-label', 'Nome do jogador');
    input.value = player.name;
    const sizeNameInput = () => {
      input.style.width = `${Math.min(21, Math.max(3, input.value.length + 1))}ch`;
    };
    sizeNameInput();
    button.replaceWith(input);
    input.focus({ preventScroll: true });
    input.select();
    let finished = false;
    const finish = (saveChanges = true) => {
      if (finished) return;
      finished = true;
      if (saveChanges) {
        player.name = input.value.trim() || fallbackName;
        savePlayerProfile(player);
        saveState();
      }
      const nextButton = document.createElement('button');
      nextButton.type = 'button';
      nextButton.className = 'player-name';
      nextButton.setAttribute('aria-label', 'Editar nome do jogador');
      input.replaceWith(nextButton);
      bindPlayerNameButton(nextButton, player, fallbackName);
      moveNamesClearOfTurnButton();
    };
    input.addEventListener('blur', () => finish());
    input.addEventListener('input', sizeNameInput);
    input.addEventListener('keydown', (keyEvent) => {
      if (keyEvent.key === 'Enter') input.blur();
      if (keyEvent.key === 'Escape') finish(false);
    });
  });
}

function render() {
  finishPendingLifeChanges();
  app.replaceChildren();
  timerBlockingModals.forEach((modal) => {
    if (!modal.isConnected) releaseTimerForModal(modal);
  });
  app.className = `count-${state.players.length}${isReordering ? ' reorder-mode' : ''}`;

  playersInTableOrder().forEach((player, index) => {
    const card = template.content.firstElementChild.cloneNode(true);
    card.dataset.playerId = player.id;
    card.style.setProperty('--player-color', player.color || COLORS[index]);
    if (index < opponentCount(state.players.length)) {
      card.classList.add('is-opponent');
      card.style.setProperty('--player-rotation', '180deg');
    }
    if (player.id === state.turnPlayerId && !state.priorityPlayerId) card.classList.add('is-turn');
    if (isChoosingStarter && player.id === state.turnPlayerId) card.classList.add('is-lottery');
    if (state.timerMinutes !== null && player.id === state.priorityPlayerId) card.classList.add('has-priority');
    if (isPlayerEliminated(player)) card.classList.add('is-eliminated');
    if (player.id === state.winnerPlayerId) card.classList.add('is-winner');
    if (state.timerMinutes !== null && state.gameStarted && !state.gamePaused && !isPlayerEliminated(player)
      && player.id === (state.priorityPlayerId || state.turnPlayerId)) {
      card.classList.add('is-timing');
    }
    if (Number.isFinite(player.timerSeconds) && player.timerSeconds <= 5 * 60) card.classList.add('time-low');

    const backdrop = card.querySelector('.player-backdrop');
    if (player.image) {
      backdrop.style.backgroundImage = `linear-gradient(180deg, rgba(5,7,5,.46), rgba(5,7,5,.05) 43%, rgba(5,7,5,.65)), url("${player.image}")`;
      card.classList.add('has-image');
    }

    const nameButton = card.querySelector('.player-name');
    nameButton.disabled = isReordering;
    bindPlayerNameButton(nameButton, player, `Jogador ${index + 1}`);
    card.querySelector('.first-player-mark').hidden = player.id !== state.roundStartPlayerId;

    card.querySelector('.life-total').textContent = player.life;
    card.querySelector('.turn-toolbar-group').hidden = state.timerMinutes === null;
    card.querySelector('.timer-value').textContent = state.timerMinutes === null ? '' : formatTime(player.timerSeconds);
    const decrease = card.querySelector('.decrease');
    const increase = card.querySelector('.increase');
    decrease.disabled = isReordering || !state.gameStarted;
    increase.disabled = isReordering || !state.gameStarted;
    bindLifeControl(decrease, player.id, -1);
    bindLifeControl(increase, player.id, 1);
    const settingsButton = card.querySelector('.choose-image');
    settingsButton.disabled = isReordering;
    settingsButton.addEventListener('click', () => openImagePicker(player.id));
    const foolishToken = card.querySelector('.foolish-token');
    foolishToken.hidden = !state.gameStarted || !state.useFoolishToken
      || !player.foolishTokenAvailable || isPlayerEliminated(player);
    foolishToken.disabled = isReordering;
    foolishToken.addEventListener('click', () => openFoolishTokenConfirmation(player.id, card));
    const toolbar = card.querySelector('.player-toolbar');
    if (isReordering) {
      toolbar.replaceChildren();
      const handle = document.createElement('button');
      handle.type = 'button';
      handle.className = 'reorder-handle';
      handle.innerHTML = '<span aria-hidden="true">⠿</span><strong>Arraste para mover</strong>';
      handle.setAttribute('aria-label', `Mover ${player.name}`);
      bindReorderHandle(handle, card, player.id);
      toolbar.append(handle);
    } else if (!state.gameStarted) {
      const starterButton = document.createElement('button');
      starterButton.type = 'button';
      starterButton.className = 'first-player-button';
      starterButton.classList.toggle('selected', player.id === state.turnPlayerId);
      starterButton.disabled = isChoosingStarter;
      starterButton.innerHTML = player.id === state.turnPlayerId
        ? '<span aria-hidden="true">✓</span><strong>Primeiro jogador</strong>'
        : '<span aria-hidden="true">○</span><strong>Definir como primeiro</strong>';
      starterButton.addEventListener('click', () => setFirstPlayer(player.id));
      toolbar.replaceChildren(starterButton);
    } else {
      const countersButton = card.querySelector('.player-counters');
      countersButton.setAttribute(
        'aria-label',
        `${player.poisonCounters} de veneno e ${player.radiationCounters} de radiação de ${player.name}`,
      );
      countersButton.addEventListener('click', () => openCounterTypePopover(player.id, card, countersButton));
      const priorityButton = card.querySelector('.priority-button');
      priorityButton.hidden = state.timerMinutes === null;
      priorityButton.lastChild.textContent = player.id === state.priorityPlayerId
        ? ' Encerrar'
        : ' Prioridade';
      priorityButton.addEventListener('click', () => takePriority(player.id));
      const commanderGroup = document.createElement('div');
      commanderGroup.className = 'commander-counter-group player-commander-counters';
      otherPlayersClockwiseFrom(player.id).forEach((commander) => {
        const damage = player.commanderDamage[commander.id] || 0;
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'counter-chip commander-chip';
        button.dataset.commanderId = commander.id;
        button.classList.toggle('has-damage', damage > 0);
        button.classList.toggle('is-lethal', damage > 20);
        button.setAttribute('aria-label', `${damage} de dano do comandante de ${commander.name}`);
        const avatar = document.createElement('span');
        avatar.className = 'counter-avatar';
        avatar.style.background = commander.image
          ? `url("${commander.image}") center / cover`
          : `rgb(${commander.color})`;
        const total = document.createElement('strong');
        total.textContent = damage;
        button.append(avatar, total);
        button.addEventListener('click', () => openCommanderDamage(player.id, commander.id, card));
        commanderGroup.append(button);
      });
      card.querySelector('.player-content').append(commanderGroup);
      syncStatusCounterChips(player, card);
    }

    const credit = card.querySelector('.art-credit');
    credit.textContent = player.artist ? `Arte: ${player.artist} · Scryfall` : '';
    app.append(card);
    const cardRect = card.getBoundingClientRect();
    const tableRect = app.getBoundingClientRect();
    const cornerClass = cardRect.left + cardRect.width / 2 < tableRect.left + tableRect.width / 2
      ? 'settings-left'
      : 'settings-right';
    settingsButton.classList.add(cornerClass);
    foolishToken.classList.add(cornerClass);
  });

  updateControls();
  moveNamesClearOfTurnButton();
}

function bindReorderHandle(handle, card, playerId) {
  let activePointer = null;
  let targetCard = null;
  let dragPreview = null;

  function clearDrag() {
    card.classList.remove('is-dragging');
    targetCard?.classList.remove('is-drop-target');
    dragPreview?.remove();
    dragPreview = null;
    targetCard = null;
  }

  handle.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    activePointer = event.pointerId;
    handle.setPointerCapture(event.pointerId);
    card.classList.add('is-dragging');
    const cardRect = card.getBoundingClientRect();
    dragPreview = card.cloneNode(true);
    dragPreview.removeAttribute('data-player-id');
    dragPreview.classList.remove('is-dragging', 'is-drop-target');
    dragPreview.classList.add('drag-card-preview');
    dragPreview.setAttribute('aria-hidden', 'true');
    dragPreview.style.left = `${event.clientX}px`;
    dragPreview.style.top = `${event.clientY}px`;
    dragPreview.style.width = `${cardRect.width}px`;
    dragPreview.style.height = `${cardRect.height}px`;
    document.body.append(dragPreview);
  });

  handle.addEventListener('pointermove', (event) => {
    if (event.pointerId !== activePointer) return;
    dragPreview.style.left = `${event.clientX}px`;
    dragPreview.style.top = `${event.clientY}px`;
    const nextTarget = document.elementFromPoint(event.clientX, event.clientY)?.closest('.player-card');
    if (nextTarget === card || nextTarget === targetCard) return;
    targetCard?.classList.remove('is-drop-target');
    targetCard = nextTarget;
    targetCard?.classList.add('is-drop-target');
  });

  handle.addEventListener('pointerup', (event) => {
    if (event.pointerId !== activePointer) return;
    const targetId = targetCard?.dataset.playerId;
    clearDrag();
    activePointer = null;
    if (!targetId) return;
    const sourceIndex = draftTableOrder.indexOf(playerId);
    const targetIndex = draftTableOrder.indexOf(targetId);
    [draftTableOrder[sourceIndex], draftTableOrder[targetIndex]] = [draftTableOrder[targetIndex], draftTableOrder[sourceIndex]];
    render();
  });

  handle.addEventListener('pointercancel', () => {
    clearDrag();
    activePointer = null;
  });
}

function startReordering() {
  tickTimer();
  isReordering = true;
  draftTableOrder = [...state.tableOrder];
  lastTimerTick = Date.now();
  render();
}

function finishReordering() {
  state.tableOrder = draftTableOrder;
  draftTableOrder = null;
  isReordering = false;
  lastTimerTick = Date.now();
  saveState();
  render();
}

function setFirstPlayer(playerId) {
  if (state.gameStarted || isChoosingStarter) return;
  state.turnPlayerId = playerId;
  state.roundStartPlayerId = playerId;
  state.priorityPlayerId = null;
  state.turnNumber = 1;
  saveState();
  render();
}

function changeLife(playerId, amount) {
  if (!state.gameStarted) return;
  const player = state.players.find((item) => item.id === playerId);
  if (!player) return;
  const wasEliminated = isPlayerEliminated(player);
  const beforeChange = gameSnapshot();
  const pending = pendingLifeChanges.get(playerId) || { delta: 0, before: gameSnapshot() };
  const nextLife = Math.max(0, player.life + amount);
  const appliedChange = nextLife - player.life;
  if (appliedChange === 0) return;
  player.life = nextLife;
  playDeathSoundIfNeeded(player, wasEliminated);
  checkForWinner();
  const priorityEnded = isPlayerEliminated(player) && state.priorityPlayerId === player.id;
  if (priorityEnded) state.priorityPlayerId = null;

  const card = app.querySelector(`[data-player-id="${playerId}"]`);
  const total = card.querySelector('.life-total');
  const change = card.querySelector('.life-change');
  total.textContent = player.life;
  card.classList.toggle('is-eliminated', isPlayerEliminated(player));
  if (priorityEnded) {
    card.classList.remove('has-priority', 'is-timing');
    const turnPlayer = state.players.find((item) => item.id === state.turnPlayerId);
    if (!state.gamePaused && turnPlayer && !isPlayerEliminated(turnPlayer)) {
      app.querySelector(`[data-player-id="${turnPlayer.id}"]`)?.classList.add('is-turn', 'is-timing');
    }
  }
  logPlayerEliminationChange(player, wasEliminated, beforeChange);
  total.classList.remove('bump-up', 'bump-down');
  void total.offsetWidth;
  total.classList.add(appliedChange > 0 ? 'bump-up' : 'bump-down');

  pending.delta += appliedChange;
  pendingLifeChanges.set(playerId, pending);
  state.redoLog = [];
  change.textContent = pending.delta > 0
    ? `+${pending.delta}`
    : pending.delta < 0 ? `−${Math.abs(pending.delta)}` : '0';
  change.classList.toggle('change-left', amount < 0);
  change.classList.toggle('change-right', amount > 0);
  change.classList.toggle('visible', pending.delta !== 0);
  clearTimeout(lifeChangeTimers.get(playerId));
  lifeChangeTimers.set(playerId, setTimeout(() => finishLifeChange(playerId), 6000));
  saveState();
  updateControls();
}

function bindLifeControl(button, playerId, amount) {
  bindAmountControl(button, amount, (change) => changeLife(playerId, change));
}

function bindAmountControl(button, amount, onChange) {
  let holdTimer;
  let holdRepeater;
  let activePointer = null;
  let held = false;

  function stopHold() {
    clearTimeout(holdTimer);
    clearInterval(holdRepeater);
  }

  button.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    stopHold();
    activePointer = event.pointerId;
    held = false;
    button.setPointerCapture(event.pointerId);
    holdTimer = setTimeout(() => {
      held = true;
      onChange(amount * 10);
      holdRepeater = setInterval(() => onChange(amount * 10), 500);
    }, 550);
  });

  button.addEventListener('pointerup', (event) => {
    if (event.pointerId !== activePointer) return;
    stopHold();
    if (!held) onChange(amount);
    activePointer = null;
  });

  button.addEventListener('pointercancel', () => {
    stopHold();
    activePointer = null;
  });
  button.addEventListener('contextmenu', (event) => event.preventDefault());
  button.addEventListener('click', (event) => {
    if (event.detail === 0) onChange(amount);
  });
}

function loadCounterIcon(element, counter) {
  if (location.protocol === 'file:') {
    const image = document.createElement('img');
    image.src = counter.image;
    image.alt = '';
    element.replaceChildren(image);
    return;
  }
  fetch(counter.image)
    .then((response) => response.text())
    .then((svg) => {
      element.innerHTML = svg;
    })
    .catch(() => {});
}

function openFoolishTokenConfirmation(playerId, card) {
  const player = state.players.find((item) => item.id === playerId);
  if (!player || !state.gameStarted || !state.useFoolishToken || !player.foolishTokenAvailable
    || isPlayerEliminated(player) || card.querySelector('.card-counter-panel')) return;
  const panel = document.createElement('section');
  panel.className = 'card-counter-panel foolish-token-panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', `Usar Ficha da Burrice de ${player.name}`);
  const background = document.createElement('div');
  background.className = 'card-counter-background foolish-token-background';
  background.style.backgroundImage = 'url("assets/ficha_burrice.png")';
  const orientation = document.createElement('div');
  orientation.className = 'card-counter-orientation';
  const content = document.createElement('div');
  content.className = 'foolish-token-confirmation';
  const tokenPreview = document.createElement('img');
  tokenPreview.className = 'foolish-token-preview';
  tokenPreview.src = 'assets/ficha_burrice.png';
  tokenPreview.alt = 'Ficha da Burrice';
  const title = document.createElement('strong');
  title.textContent = 'Usar a Ficha da Burrice?';
  const description = document.createElement('span');
  description.textContent = `${player.name} só pode usar esta ficha uma vez por partida.`;
  const actions = document.createElement('div');
  actions.className = 'foolish-token-actions';
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.textContent = 'Cancelar';
  const confirm = document.createElement('button');
  confirm.type = 'button';
  confirm.className = 'confirm-foolish-token';
  confirm.textContent = 'Usar ficha';
  actions.append(cancel, confirm);
  content.append(tokenPreview, title, description, actions);
  orientation.append(content);
  panel.append(background, orientation);
  card.append(panel);
  pauseTimerForPlayerModal(player.id, panel);

  const close = () => {
    panel.remove();
    releaseTimerForModal(panel);
  };
  cancel.addEventListener('click', close);
  confirm.addEventListener('click', () => {
    const before = gameSnapshot();
    player.foolishTokenAvailable = false;
    playSound(SOUND_PATHS.foolishToken[randomIndex(SOUND_PATHS.foolishToken.length)]);
    addLogEntry('token', `${player.name} usou a Ficha da Burrice`, before, true, player.id);
    render();
  });
  panel.addEventListener('click', (event) => {
    if (event.target === panel || event.target === background) close();
  });
}

function syncStatusCounterChips(player, card) {
  card.querySelectorAll('.status-counter-chip').forEach((chip) => chip.remove());
  const container = card.querySelector('.player-status-counters');
  if (!container) return;
  Object.entries(PLAYER_COUNTER_TYPES).forEach(([type, counter]) => {
    const value = player[counter.property];
    if (value <= 0) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `player-status-counter status-counter-chip ${type}-counter-chip`;
    button.dataset.counterType = type;
    button.style.setProperty('--counter-color', counter.color);
    button.setAttribute('aria-label', `${value} de ${counter.label.toLowerCase()} de ${player.name}`);
    const avatar = document.createElement('span');
    avatar.className = 'counter-avatar';
    loadCounterIcon(avatar, counter);
    const total = document.createElement('strong');
    total.textContent = value;
    button.append(avatar, total);
    button.addEventListener('click', () => openPlayerCounter(player.id, type, card));
    container.append(button);
  });
}

function openCounterTypePopover(playerId, card, anchor) {
  const existing = card.querySelector('.counter-type-popover');
  if (existing) {
    existing.closePopover();
    return;
  }
  if (card.querySelector('.card-counter-panel')) return;
  const popover = document.createElement('div');
  popover.className = 'counter-type-popover';
  popover.setAttribute('role', 'menu');
  const closePopover = () => {
    popover.remove();
    document.removeEventListener('pointerdown', closeOnOutsidePointer, true);
  };
  const closeOnOutsidePointer = (event) => {
    if (!popover.isConnected) {
      document.removeEventListener('pointerdown', closeOnOutsidePointer, true);
      return;
    }
    if (popover.contains(event.target) || anchor.contains(event.target)) return;
    event.preventDefault();
    event.stopPropagation();
    closePopover();
  };
  popover.closePopover = closePopover;
  const cardRect = card.getBoundingClientRect();
  const anchorRect = anchor.getBoundingClientRect();
  const center = anchorRect.left + anchorRect.width / 2 - cardRect.left;
  const popoverEdge = cardRect.width <= 260 ? 37 : 72;
  popover.style.left = `${Math.max(popoverEdge, Math.min(cardRect.width - popoverEdge, center))}px`;
  if (card.classList.contains('is-opponent')) {
    popover.style.top = `${anchorRect.bottom - cardRect.top + 8}px`;
    popover.classList.add('is-opponent-popover');
  } else {
    popover.style.bottom = `${cardRect.bottom - anchorRect.top + 8}px`;
  }
  Object.entries(PLAYER_COUNTER_TYPES).forEach(([type, counter]) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.setAttribute('role', 'menuitem');
    button.style.setProperty('--counter-color', counter.color);
    const image = document.createElement('span');
    loadCounterIcon(image, counter);
    const label = document.createElement('strong');
    label.textContent = counter.label;
    button.append(image, label);
    button.addEventListener('click', () => {
      closePopover();
      openPlayerCounter(playerId, type, card);
    });
    popover.append(button);
  });
  card.append(popover);
  setTimeout(() => document.addEventListener('pointerdown', closeOnOutsidePointer, true));
}

function createCardCounterPanel(card, backgroundPlayer, label) {
  const panel = document.createElement('section');
  panel.className = 'card-counter-panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', label);

  const background = document.createElement('div');
  background.className = 'card-counter-background';
  background.style.backgroundColor = `rgb(${backgroundPlayer.color})`;
  background.style.backgroundImage = backgroundPlayer.image
    ? `url("${backgroundPlayer.image}")`
    : 'radial-gradient(circle at 75% 10%, rgba(255,255,255,.2), transparent 38%), linear-gradient(145deg, transparent, rgba(5,12,19,.38))';

  const orientation = document.createElement('div');
  orientation.className = 'card-counter-orientation';
  const closeButton = document.createElement('button');
  closeButton.type = 'button';
  closeButton.className = 'card-counter-finish';
  closeButton.textContent = 'Concluir';
  const content = document.createElement('div');
  content.className = 'card-counter-content';
  orientation.append(content, closeButton);
  panel.append(background, orientation);
  card.append(panel);
  pauseTimerForPlayerModal(card.dataset.playerId, panel);
  return { panel, background, closeButton, content };
}

function createCounterControl(label, value, onChange) {
  const group = document.createElement('div');
  group.className = 'card-counter-group';
  const title = document.createElement('strong');
  title.textContent = label;
  const controls = document.createElement('div');
  controls.className = 'card-counter-controls';
  const decrease = document.createElement('button');
  decrease.type = 'button';
  decrease.className = 'card-counter-adjust';
  decrease.setAttribute('aria-label', `Remover ${label.toLowerCase()}`);
  decrease.textContent = '−';
  const output = document.createElement('output');
  output.textContent = value;
  const increase = document.createElement('button');
  increase.type = 'button';
  increase.className = 'card-counter-adjust';
  increase.setAttribute('aria-label', `Adicionar ${label.toLowerCase()}`);
  increase.textContent = '+';
  bindAmountControl(decrease, -1, (amount) => onChange(amount, output));
  bindAmountControl(increase, 1, (amount) => onChange(amount, output));
  controls.append(decrease, output, increase);
  group.append(title, controls);
  return group;
}

function syncGameCardStates() {
  state.players.forEach((player) => {
    const card = app.querySelector(`[data-player-id="${player.id}"]`);
    if (!card) return;
    const eliminated = isPlayerEliminated(player);
    card.classList.toggle('is-eliminated', eliminated);
    card.classList.toggle('is-turn', player.id === state.turnPlayerId && !state.priorityPlayerId);
    card.classList.toggle('has-priority', state.timerMinutes !== null && player.id === state.priorityPlayerId);
    card.classList.toggle('is-winner', player.id === state.winnerPlayerId);
    card.classList.toggle(
      'is-timing',
      state.timerMinutes !== null && state.gameStarted && !state.gamePaused && !eliminated
        && player.id === (state.priorityPlayerId || state.turnPlayerId),
    );
    card.querySelector('.life-total').textContent = player.life;
    const countersButton = card.querySelector('.player-counters');
    countersButton?.setAttribute(
      'aria-label',
      `${player.poisonCounters} de veneno e ${player.radiationCounters} de radiação de ${player.name}`,
    );
    card.querySelectorAll('.commander-chip').forEach((chip) => {
      const damage = player.commanderDamage[chip.dataset.commanderId] || 0;
      chip.querySelector('strong').textContent = damage;
      chip.classList.toggle('has-damage', damage > 0);
      chip.classList.toggle('is-lethal', damage > 20);
    });
    card.querySelectorAll('.status-counter-chip').forEach((chip) => {
      const counter = PLAYER_COUNTER_TYPES[chip.dataset.counterType];
      chip.querySelector('strong').textContent = player[counter.property];
    });
  });
}

function openCommanderDamage(targetId, sourceId, card) {
  finishPendingLifeChanges();
  const target = state.players.find((player) => player.id === targetId);
  const source = state.players.find((player) => player.id === sourceId);
  if (!target || !source || card.querySelector('.card-counter-panel')) return;
  const damageOnOpen = target.commanderDamage[sourceId] || 0;
  const snapshotOnOpen = gameSnapshot();
  const { panel, background, closeButton, content } = createCardCounterPanel(
    card,
    source,
    `Dano do comandante de ${source.name}`,
  );
  background.classList.add('commander-panel-background');
  const matchup = document.createElement('div');
  matchup.className = 'card-counter-matchup';
  const sourceName = document.createElement('strong');
  sourceName.textContent = source.name;
  const description = document.createElement('span');
  description.textContent = `em ${target.name}`;
  matchup.append(sourceName, description);

  const control = createCounterControl('Dano de comandante', damageOnOpen, (amount, output) => {
    const wasEliminated = isPlayerEliminated(target);
    const beforeChange = gameSnapshot();
    const current = target.commanderDamage[sourceId] || 0;
    const next = Math.max(0, current + amount);
    const appliedDamage = next - current;
    if (appliedDamage === 0) return;
    target.commanderDamage[sourceId] = next;
    target.life = Math.max(0, target.life - appliedDamage);
    playDeathSoundIfNeeded(target, wasEliminated);
    checkForWinner();
    if (isPlayerEliminated(target) && state.priorityPlayerId === target.id) state.priorityPlayerId = null;
    output.textContent = next;
    syncGameCardStates();
    logPlayerEliminationChange(target, wasEliminated, beforeChange);
    saveState();
  });
  control.classList.add('single-player-counter');
  const hint = document.createElement('p');
  hint.className = 'card-counter-hint';
  hint.textContent = 'Toque para alterar 1 · Segure para alterar 10 continuamente';
  content.append(matchup, control, hint);

  function closePanel() {
    const damageAfter = target.commanderDamage[sourceId] || 0;
    const damageChange = damageAfter - damageOnOpen;
    panel.remove();
    releaseTimerForModal(panel);
    if (damageChange !== 0) {
      const action = damageChange > 0 ? 'causou' : 'removeu';
      const direction = damageChange > 0 ? 'a' : 'de';
      addLogEntry(
        'commander',
        `${source.name} ${action} ${Math.abs(damageChange)} de dano de comandante ${direction} ${target.name}`,
        snapshotOnOpen,
        true,
        target.id,
      );
    }
    syncGameCardStates();
    if (damageChange > 0) {
      if (randomIndex(2) === 0) playSound(SOUND_PATHS.commanderDamage);
      requestAnimationFrame(() => animateCommanderAttack(sourceId, targetId));
    }
  }
  closeButton.addEventListener('click', closePanel);
  panel.addEventListener('click', (event) => {
    if (!event.target.closest('.card-counter-adjust, .card-counter-finish')) closePanel();
  });
}

function openPlayerCounter(playerId, type, card) {
  finishPendingLifeChanges();
  const player = state.players.find((item) => item.id === playerId);
  const counter = PLAYER_COUNTER_TYPES[type];
  if (!player || !counter || card.querySelector('.card-counter-panel')) return;
  card.querySelector('.counter-type-popover')?.remove();
  const valueOnOpen = player[counter.property];
  const snapshotOnOpen = gameSnapshot();
  const { panel, background, closeButton, content } = createCardCounterPanel(
    card,
    player,
    `${counter.label} de ${player.name}`,
  );
  panel.classList.add('player-counter-panel', `${type}-counter-panel`);
  panel.style.setProperty('--counter-color', counter.color);
  background.classList.add('player-counters-background');
  const icon = document.createElement('div');
  icon.className = `player-counter-icon ${type}-counter-icon`;
  loadCounterIcon(icon, counter);
  panel.append(icon);
  const heading = document.createElement('div');
  heading.className = 'card-counter-matchup';
  const title = document.createElement('strong');
  title.textContent = counter.label;
  const description = document.createElement('span');
  description.textContent = player.name;
  heading.append(title, description);

  const control = createCounterControl(counter.label, valueOnOpen, (amount, output) => {
    const wasEliminated = isPlayerEliminated(player);
    const beforeChange = gameSnapshot();
    const next = Math.max(0, player[counter.property] + amount);
    if (next === player[counter.property]) return;
    player[counter.property] = next;
    playDeathSoundIfNeeded(player, wasEliminated);
    checkForWinner();
    if (isPlayerEliminated(player) && state.priorityPlayerId === player.id) state.priorityPlayerId = null;
    output.textContent = next;
    syncGameCardStates();
    logPlayerEliminationChange(player, wasEliminated, beforeChange);
    saveState();
  });
  control.classList.add('single-player-counter');
  const hint = document.createElement('p');
  hint.className = 'card-counter-hint';
  hint.textContent = type === 'poison'
    ? '10 marcadores de veneno eliminam o jogador'
    : 'Toque e segure para alterar de 10 em 10';
  content.append(heading, control, hint);

  function closePanel() {
    const change = player[counter.property] - valueOnOpen;
    panel.remove();
    releaseTimerForModal(panel);
    if (change) {
      addLogEntry(
        'counters',
        `${player.name}: ${counter.label.toLowerCase()} ${change > 0 ? '+' : '−'}${Math.abs(change)}`,
        snapshotOnOpen,
        true,
        player.id,
      );
    }
    syncStatusCounterChips(player, card);
    syncGameCardStates();
  }
  closeButton.addEventListener('click', closePanel);
  panel.addEventListener('click', (event) => {
    if (!event.target.closest('.card-counter-adjust, .card-counter-finish')) closePanel();
  });
}

function animateCommanderAttack(sourceId, targetId) {
  const source = state.players.find((player) => player.id === sourceId);
  const sourceCard = app.querySelector(`[data-player-id="${sourceId}"]`);
  const targetCard = app.querySelector(`[data-player-id="${targetId}"]`);
  if (!source?.image || !sourceCard || !targetCard || matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const sourceRect = sourceCard.getBoundingClientRect();
  const targetRect = targetCard.getBoundingClientRect();
  const startX = sourceRect.left + sourceRect.width / 2;
  const startY = sourceRect.top + sourceRect.height / 2;
  const travelX = targetRect.left + targetRect.width / 2 - startX;
  const travelY = targetRect.top + targetRect.height / 2 - startY;
  const sourceRotation = sourceCard.classList.contains('is-opponent') ? 180 : 0;
  const floatY = sourceRotation === 180 ? 60 : -60;
  const attackCard = document.createElement('div');
  attackCard.className = 'commander-attack-card';
  attackCard.style.left = `${startX}px`;
  attackCard.style.top = `${startY}px`;
  attackCard.style.backgroundImage = `linear-gradient(rgba(5,7,5,.08), rgba(5,7,5,.28)), url("${source.image}")`;
  document.body.append(attackCard);

  const pose = (x, y, scale, rotation = sourceRotation) => (
    `translate(-50%, -50%) translate(${x}px, ${y}px) rotate(${rotation}deg) scale(${scale})`
  );
  const attack = attackCard.animate([
    { opacity: 0, transform: pose(0, 0, .4), offset: 0 },
    { opacity: 1, transform: pose(0, floatY * .45, .9, sourceRotation - 2), offset: .14 },
    { opacity: 1, transform: pose(0, floatY, 1, sourceRotation + 2), offset: .31 },
    { opacity: 1, transform: pose(travelX * .82, travelY * .82, 1.02, sourceRotation + 4), offset: .53 },
    { opacity: 1, transform: pose(travelX, travelY, 1.1, sourceRotation - 2), offset: .62 },
    { opacity: 1, transform: pose(travelX * .88, travelY * .88, .96, sourceRotation + 2), offset: .7 },
    { opacity: .95, transform: pose(0, floatY * .6, .9, sourceRotation), offset: .91 },
    { opacity: 0, transform: pose(0, 0, .55, sourceRotation), offset: 1 },
  ], { duration: 1900, easing: 'cubic-bezier(.3,.75,.25,1)' });

  targetCard.animate([
    { filter: 'brightness(1)' },
    { filter: 'brightness(1)', offset: .58 },
    { filter: 'brightness(1.55)', offset: .64 },
    { filter: 'brightness(1)', offset: .78 },
  ], { duration: 1900, easing: 'ease-out' });
  attack.finished.finally(() => attackCard.remove());
}

function tickTimer() {
  if (state.timerMinutes === null || !state.gameStarted || state.gamePaused || isReordering
    || isGameLogOpen || timerBlockingModals.size > 0 || state.winnerPlayerId) {
    lastTimerTick = Date.now();
    return;
  }
  const now = Date.now();
  const elapsedSeconds = Math.floor((now - lastTimerTick) / 1000);
  if (elapsedSeconds < 1) return;
  lastTimerTick += elapsedSeconds * 1000;

  const timerPlayerId = state.priorityPlayerId || state.turnPlayerId;
  const player = state.players.find((item) => item.id === timerPlayerId);
  if (!player || isPlayerEliminated(player) || player.timerSeconds <= 0) return;
  const before = gameSnapshot();
  player.timerSeconds = Math.max(0, player.timerSeconds - elapsedSeconds);

  if (player.timerSeconds === 0) {
    const timedOutTurnPlayer = player.id === state.turnPlayerId;
    if (state.priorityPlayerId === player.id) state.priorityPlayerId = null;
    playDeathSoundIfNeeded(player, false);
    addLogEntry('timeout', `Tempo de ${player.name} esgotou`, before, false, player.id);
    logPlayerEliminationChange(player, false, before);
    if (timedOutTurnPlayer && !state.winnerPlayerId) passTurn();
    else render();
    return;
  }

  const card = app.querySelector(`[data-player-id="${player.id}"]`);
  if (!card) return;
  card.querySelector('.timer-value').textContent = formatTime(player.timerSeconds);
  card.classList.toggle('time-low', player.timerSeconds <= 5 * 60);
  const timerGroup = card.querySelector('.turn-toolbar-group');
  timerGroup.classList.remove('low-time-tick');
  if (player.timerSeconds <= 5 * 60) {
    void timerGroup.offsetWidth;
    timerGroup.classList.add('low-time-tick');
  }
  saveState();
}

function passTurn(direction = 1) {
  finishPendingLifeChanges();
  tickTimer();
  const before = gameSnapshot();
  const currentIndex = state.tableOrder.indexOf(state.turnPlayerId);
  const roundStartIndex = state.tableOrder.indexOf(state.roundStartPlayerId);
  let nextIndex = currentIndex;
  let crossedRoundStart = false;
  for (let step = 1; step <= state.tableOrder.length; step += 1) {
    const candidateIndex = (currentIndex + direction * step + state.tableOrder.length) % state.tableOrder.length;
    const reverseBoundary = (roundStartIndex - 1 + state.tableOrder.length) % state.tableOrder.length;
    if ((direction > 0 && candidateIndex === roundStartIndex)
      || (direction < 0 && candidateIndex === reverseBoundary)) crossedRoundStart = true;
    const candidate = state.players.find((player) => player.id === state.tableOrder[candidateIndex]);
    if (!isPlayerEliminated(candidate)) {
      nextIndex = candidateIndex;
      break;
    }
  }
  const nextPlayer = state.players.find((player) => player.id === state.tableOrder[nextIndex]);
  if (!nextPlayer || isPlayerEliminated(nextPlayer)) return;
  state.turnPlayerId = state.tableOrder[nextIndex];
  state.priorityPlayerId = null;
  if (crossedRoundStart) state.turnNumber = Math.max(1, state.turnNumber + direction);
  lastTimerTick = Date.now();
  addLogEntry(
    'turn',
    `Turno ${state.turnNumber} de ${nextPlayer.name} iniciou`,
    before,
    true,
    nextPlayer.id,
  );
  if (randomIndex(100) < 3) {
    playSound(SOUND_PATHS.randomTurn[randomIndex(SOUND_PATHS.randomTurn.length)]);
  }
  render();
}

function startOrPassTurn() {
  if (isChoosingStarter) return;
  if (isReordering) {
    finishReordering();
    return;
  }
  if (state.gamePaused) {
    toggleGamePause();
    return;
  }
  if (state.priorityPlayerId) {
    takePriority(state.priorityPlayerId);
    return;
  }
  if (state.gameStarted) {
    passTurn();
    return;
  }
  const firstPlayer = state.players.find((player) => player.id === state.turnPlayerId);
  state.gameStarted = true;
  state.gamePaused = false;
  lastTimerTick = Date.now();
  addLogEntry(
    'turn',
    `Turno ${state.turnNumber} de ${firstPlayer.name} iniciou`,
    null,
    false,
    firstPlayer.id,
  );
  render();
}

function takePriority(playerId) {
  if (state.timerMinutes === null) return;
  const player = state.players.find((item) => item.id === playerId);
  if (!player || isPlayerEliminated(player)) return;
  finishPendingLifeChanges();
  tickTimer();
  const before = gameSnapshot();
  state.priorityPlayerId = playerId === state.priorityPlayerId ? null : playerId;
  lastTimerTick = Date.now();
  const message = state.priorityPlayerId
    ? `${player.name} pegou a prioridade`
    : `${player.name} encerrou a prioridade`;
  addLogEntry('priority', message, before, true, player.id);
  render();
}

function toggleGamePause() {
  if (!state.gameStarted) return;
  finishPendingLifeChanges();
  if (!state.gamePaused) tickTimer();
  const before = gameSnapshot();
  state.gamePaused = !state.gamePaused;
  lastTimerTick = Date.now();
  addLogEntry(state.gamePaused ? 'pause' : 'resume', state.gamePaused ? 'Partida pausada' : 'Partida retomada', before);
  render();
}

function openImagePicker(playerId) {
  imagePlayerId = playerId;
  const player = state.players.find((item) => item.id === playerId);
  const playerIndex = tableIndexForPlayer(playerId);
  imageDialog.classList.toggle('player-oriented-opponent', playerIndex < opponentCount(state.players.length));
  document.querySelector('#remove-current-image').hidden = !player?.image;
  playerSettingsName.value = player.name;
  renderColorOptions(player);
  imageResults.replaceChildren();
  searchStatus.textContent = 'Busque pelo nome de uma carta para usar sua arte como fundo.';
  pauseTimerForPlayerModal(playerId, imageDialog);
  imageDialog.showModal();
}

function selectPlayerColor(color) {
  const player = state.players.find((item) => item.id === imagePlayerId);
  if (!player) return;
  const colorAlreadyUsed = state.players.some((item) => (
    item.id !== player.id && !item.image && item.color.replaceAll(' ', '') === color.replaceAll(' ', '')
  ));
  if (colorAlreadyUsed) {
    searchStatus.textContent = 'Essa cor já está sendo usada por outro jogador.';
    return;
  }
  Object.assign(player, { color, image: null, artist: null, cardName: null });
  document.querySelector('#remove-current-image').hidden = true;
  renderColorOptions(player);
  savePlayerProfile(player);
  saveState();
  render();
}

function renderColorOptions(player) {
  colorOptions.replaceChildren();
  COLOR_CHOICES.forEach((color) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'color-option';
    button.style.background = `rgb(${color})`;
    const selected = !player.image && player.color === color;
    const usedByAnotherPlayer = state.players.some((item) => (
      item.id !== player.id && !item.image && item.color.replaceAll(' ', '') === color.replaceAll(' ', '')
    ));
    button.classList.toggle('selected', selected);
    button.disabled = selected || usedByAnotherPlayer;
    button.setAttribute('aria-label', `Usar a cor rgb ${color}`);
    button.addEventListener('click', () => selectPlayerColor(color));
    colorOptions.append(button);
  });
}

function renderSavedPlayers() {
  const grid = document.querySelector('#saved-player-grid');
  const player = state.players.find((item) => item.id === imagePlayerId);
  grid.replaceChildren();
  profiles.forEach((profile) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'saved-player-card';
    button.classList.toggle('selected', profile.id === player?.profileId);
    const background = document.createElement('span');
    background.className = 'profile-background';
    background.style.background = profile.image
      ? `url("${profile.image}") center / cover`
      : `rgb(${profile.color || COLORS[0]})`;
    const name = document.createElement('strong');
    name.textContent = profile.name;
    button.append(background, name);
    button.addEventListener('click', () => applySavedPlayer(profile));
    grid.append(button);
  });
}

function applySavedPlayer(profile) {
  const player = state.players.find((item) => item.id === imagePlayerId);
  if (!player) return;
  Object.assign(player, {
    profileId: profile.id,
    name: profile.name,
    image: profile.image,
    artist: profile.artist,
    cardName: profile.cardName,
    color: profile.color || player.color,
  });
  playerSettingsName.value = player.name;
  document.querySelector('#remove-current-image').hidden = !player.image;
  renderColorOptions(player);
  saveState();
  profilesDialog.close();
  render();
}

function imageForCard(card) {
  return card.image_uris?.art_crop ?? card.card_faces?.find((face) => face.image_uris?.art_crop)?.image_uris.art_crop;
}

searchForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const query = searchInput.value.trim();
  if (!query) return;
  searchStatus.textContent = 'Buscando artes…';
  imageResults.replaceChildren();

  try {
    const params = new URLSearchParams({ q: query, unique: 'art', order: 'name' });
    const response = await fetch(`https://api.scryfall.com/cards/search?${params}`);
    const payload = await response.json();
    if (response.status === 404) {
      searchStatus.textContent = 'Nenhuma carta encontrada. Tente outro nome.';
      return;
    }
    if (!response.ok) throw new Error(payload.details || 'Não foi possível fazer a busca.');

    const cards = payload.data.filter(imageForCard).slice(0, 20);
    searchStatus.textContent = cards.length ? `${cards.length} artes encontradas` : 'Nenhuma arte encontrada.';
    cards.forEach((card) => {
      const button = document.createElement('button');
      const image = imageForCard(card);
      button.type = 'button';
      button.className = 'image-result';
      button.innerHTML = `<img src="${image}" alt="" loading="lazy"><span></span>`;
      button.querySelector('span').textContent = card.name;
      button.setAttribute('aria-label', `Usar arte de ${card.name}, por ${card.artist || 'artista desconhecido'}`);
      button.addEventListener('click', () => selectImage(image, card.artist, card.name));
      imageResults.append(button);
    });
  } catch (error) {
    searchStatus.textContent = error.message;
  }
});

function selectImage(image, artist, cardName) {
  const player = state.players.find((item) => item.id === imagePlayerId);
  if (!player) return;
  Object.assign(player, {
    name: playerSettingsName.value.trim() || player.name,
    image,
    artist,
    cardName,
  });
  savePlayerProfile(player);
  saveState();
  imageDialog.close();
  render();
}

function setPlayerCount(playerCount) {
  while (state.players.length < playerCount) {
    const timerSeconds = state.timerMinutes === null ? null : state.timerMinutes * 60;
    const player = makePlayer(state.players.length, state.startingLife, timerSeconds);
    state.players.push(player);
    state.tableOrder.push(player.id);
    savePlayerProfile(player);
  }
  while (state.players.length > playerCount) state.players.pop();
  const playerIds = new Set(state.players.map((player) => player.id));
  state.tableOrder = state.tableOrder.filter((playerId) => playerIds.has(playerId));
  state.players.forEach((player) => {
    player.commanderDamage = Object.fromEntries(
      Object.entries(player.commanderDamage).filter(([commanderId]) => playerIds.has(commanderId)),
    );
  });
  if (!state.players.some((player) => player.id === state.turnPlayerId)) state.turnPlayerId = state.players[0].id;
  if (!state.players.some((player) => player.id === state.roundStartPlayerId)) {
    state.roundStartPlayerId = state.turnPlayerId;
  }
  if (!state.players.some((player) => player.id === state.priorityPlayerId)) state.priorityPlayerId = null;
  state.gameLog = [];
  state.redoLog = [];
}

function setNewGamePlayerCount(playerCount) {
  const nextCount = Math.max(MIN_PLAYERS, Math.min(MAX_PLAYERS, playerCount));
  newGamePlayerCount.value = String(nextCount);
  newGamePlayerCount.textContent = String(nextCount);
  document.querySelector('#new-game-remove-player').disabled = nextCount === MIN_PLAYERS;
  document.querySelector('#new-game-add-player').disabled = nextCount === MAX_PLAYERS;
}

function updateCustomTimeField() {
  const selectedTime = document.querySelector('input[name="new-game-time"]:checked')?.value;
  customTimeField.hidden = selectedTime !== 'custom';
}

function updateCustomLifeField() {
  const selectedLife = document.querySelector('input[name="new-game-life"]:checked')?.value;
  customLifeField.hidden = selectedLife !== 'custom';
}

function openNewGameDialog() {
  setNewGamePlayerCount(state.players.length);
  const lifePreset = [20, 30, 40].includes(state.startingLife) ? String(state.startingLife) : 'custom';
  document.querySelector(`input[name="new-game-life"][value="${lifePreset}"]`).checked = true;
  if (lifePreset === 'custom') newGameCustomLife.value = String(state.startingLife);
  const preset = state.timerMinutes === null
    ? 'none'
    : [5, 10, 15, 30].includes(state.timerMinutes) ? String(state.timerMinutes) : 'custom';
  document.querySelector(`input[name="new-game-time"][value="${preset}"]`).checked = true;
  if (preset === 'custom') newGameCustomTime.value = String(state.timerMinutes);
  newGameUseFoolishToken.checked = state.useFoolishToken;
  updateCustomLifeField();
  updateCustomTimeField();
  newGameDialog.showModal();
}

function selectedNewGameMinutes() {
  const selectedTime = document.querySelector('input[name="new-game-time"]:checked')?.value;
  if (selectedTime === 'none') return null;
  if (selectedTime !== 'custom') return Number(selectedTime);
  const customMinutes = Math.round(Number(newGameCustomTime.value) || 1);
  return Math.max(1, Math.min(180, customMinutes));
}

function selectedNewGameLife() {
  const selectedLife = document.querySelector('input[name="new-game-life"]:checked')?.value;
  if (selectedLife !== 'custom') return Number(selectedLife) || 40;
  const customLife = Math.round(Number(newGameCustomLife.value) || 1);
  return Math.max(1, Math.min(999, customLife));
}

function restoreLogStep(entryId) {
  finishPendingLifeChanges();
  const entryIndex = state.gameLog.findIndex((entry) => entry.id === entryId);
  const entry = state.gameLog[entryIndex];
  if (entryIndex < 0 || !entry?.after) return;
  const discardedEntries = state.gameLog.splice(entryIndex + 1);
  state.redoLog = [...discardedEntries].reverse();
  restoreGameSnapshot(entry.after);
  lastTimerTick = Date.now();
  saveState();
  render();
  renderGameLog();
}

function requestLogRestore(entry) {
  pendingLogRestoreId = entry.id;
  logRestoreMessage.textContent = `A partida voltará para “${entry.message}”. Todos os eventos posteriores serão desfeitos.`;
  logRestoreDialog.showModal();
}

function renderGameLog() {
  gameLogList.replaceChildren();
  gameLogEmpty.hidden = state.gameLog.length > 0;
  [...state.gameLog].reverse().forEach((entry) => {
    const item = document.createElement('li');
    item.className = `game-log-entry log-${entry.type}`;
    const action = document.createElement('button');
    action.type = 'button';
    action.className = 'game-log-entry-action';
    action.disabled = !entry.after;
    action.setAttribute('aria-label', `${entry.message}. Voltar a este ponto da partida`);
    const marker = document.createElement('span');
    marker.className = 'game-log-marker';
    const visual = entry.playerVisual
      || state.players.find((player) => player.id === entry.playerId);
    let thumb = null;
    if (visual) {
      item.classList.add('has-player-thumb');
      thumb = document.createElement('span');
      thumb.className = 'game-log-player-thumb';
      thumb.style.backgroundColor = `rgb(${visual.color})`;
      if (visual.image) thumb.style.backgroundImage = `url("${visual.image}")`;
      thumb.setAttribute('aria-hidden', 'true');
    }
    const content = document.createElement('div');
    const message = document.createElement('strong');
    message.textContent = entry.message;
    const time = document.createElement('time');
    const date = new Date(entry.timestamp);
    time.dateTime = entry.timestamp;
    time.textContent = Number.isNaN(date.getTime())
      ? ''
      : date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    content.append(message, time);
    action.append(marker);
    if (thumb) action.append(thumb);
    action.append(content);
    action.addEventListener('click', () => requestLogRestore(entry));
    item.append(action);
    gameLogList.append(item);
  });
}

function undoLogEntry() {
  finishPendingLifeChanges();
  const entry = state.gameLog.at(-1);
  if (!entry?.undoable || !entry.before) return;
  state.gameLog.pop();
  state.redoLog.push(entry);
  restoreGameSnapshot(entry.before);
  lastTimerTick = Date.now();
  saveState();
  render();
}

function redoLogEntry() {
  const entry = state.redoLog.pop();
  if (!entry?.after) return;
  restoreGameSnapshot(entry.after);
  state.gameLog.push(entry);
  lastTimerTick = Date.now();
  saveState();
  render();
}

passTurnButton.addEventListener('pointerdown', (event) => {
  if (event.button !== 0 || !state.gameStarted || state.gamePaused || state.priorityPlayerId
    || isReordering || isChoosingStarter || state.winnerPlayerId) return;
  reverseTurnTriggered = false;
  clearTimeout(reverseTurnHoldTimer);
  reverseTurnHoldTimer = setTimeout(() => {
    reverseTurnTriggered = true;
    passTurn(-1);
  }, 2000);
});
passTurnButton.addEventListener('pointerup', () => clearTimeout(reverseTurnHoldTimer));
passTurnButton.addEventListener('pointercancel', () => {
  clearTimeout(reverseTurnHoldTimer);
  reverseTurnTriggered = false;
});
passTurnButton.addEventListener('click', (event) => {
  if (reverseTurnTriggered) {
    event.preventDefault();
    reverseTurnTriggered = false;
    return;
  }
  startOrPassTurn();
});
pauseGameButton.addEventListener('click', toggleGamePause);
soundButton.addEventListener('click', () => {
  state.soundMuted = !state.soundMuted;
  if (state.soundMuted) stopAllSounds();
  saveState();
  updateControls();
});
arrangeTableButton.addEventListener('click', () => {
  if (isReordering) finishReordering();
  else startReordering();
});

async function startNewGame() {
  discardPendingLifeChanges();
  stopAllSounds();
  stopVictoryCelebration();
  setPlayerCount(Number(newGamePlayerCount.value));
  state.startingLife = selectedNewGameLife();
  state.timerMinutes = selectedNewGameMinutes();
  state.useFoolishToken = newGameUseFoolishToken.checked;
  if (state.timerMinutes !== null) newGameCustomTime.value = String(state.timerMinutes);
  state.players.forEach((player) => {
    player.life = state.startingLife;
    player.timerSeconds = state.timerMinutes === null ? null : state.timerMinutes * 60;
    player.commanderDamage = {};
    player.poisonCounters = 0;
    player.radiationCounters = 0;
    player.foolishTokenAvailable = state.useFoolishToken;
  });
  state.turnPlayerId = state.players[0].id;
  state.roundStartPlayerId = state.players[0].id;
  state.priorityPlayerId = null;
  state.turnNumber = 1;
  state.gameStarted = false;
  state.gamePaused = false;
  state.winnerPlayerId = null;
  lastTimerTick = Date.now();
  state.gameLog = [];
  state.redoLog = [];
  newGameDialog.close();
  isChoosingStarter = true;

  const targetIndex = randomIndex(state.tableOrder.length);
  const lastStep = state.tableOrder.length * 3 + targetIndex;
  for (let step = 0; step <= lastStep; step += 1) {
    state.turnPlayerId = state.tableOrder[step % state.tableOrder.length];
    render();
    const delay = 70 + Math.round((step / lastStep) * 130);
    await new Promise((resolve) => setTimeout(resolve, delay));
  }

  state.turnPlayerId = state.tableOrder[targetIndex];
  state.roundStartPlayerId = state.turnPlayerId;
  isChoosingStarter = false;
  saveState();
  render();
}

document.querySelector('#new-game').addEventListener('click', openNewGameDialog);
document.querySelector('#open-game-log').addEventListener('click', () => {
  finishPendingLifeChanges();
  tickTimer();
  isGameLogOpen = true;
  lastTimerTick = Date.now();
  renderGameLog();
  gameLogDialog.showModal();
});
gameLogDialog.addEventListener('close', () => {
  isGameLogOpen = false;
  lastTimerTick = Date.now();
});
imageDialog.addEventListener('close', () => releaseTimerForModal(imageDialog));
document.querySelector('.cancel-log-restore').addEventListener('click', () => logRestoreDialog.close());
document.querySelector('#confirm-log-restore').addEventListener('click', () => {
  const entryId = pendingLogRestoreId;
  logRestoreDialog.close();
  if (entryId) restoreLogStep(entryId);
});
logRestoreDialog.addEventListener('close', () => {
  pendingLogRestoreId = null;
});
document.querySelector('#confirm-new-game').addEventListener('click', startNewGame);
document.querySelector('.cancel-new-game').addEventListener('click', () => newGameDialog.close());
document.querySelector('#new-game-remove-player').addEventListener('click', () => {
  setNewGamePlayerCount(Number(newGamePlayerCount.value) - 1);
});
document.querySelector('#new-game-add-player').addEventListener('click', () => {
  setNewGamePlayerCount(Number(newGamePlayerCount.value) + 1);
});
document.querySelectorAll('input[name="new-game-time"]').forEach((input) => {
  input.addEventListener('change', updateCustomTimeField);
});
document.querySelectorAll('input[name="new-game-life"]').forEach((input) => {
  input.addEventListener('change', updateCustomLifeField);
});
newGameCustomTime.addEventListener('focus', () => {
  document.querySelector('input[name="new-game-time"][value="custom"]').checked = true;
  updateCustomTimeField();
});
newGameCustomLife.addEventListener('focus', () => {
  document.querySelector('input[name="new-game-life"][value="custom"]').checked = true;
  updateCustomLifeField();
});

document.querySelector('#open-saved-players').addEventListener('click', () => {
  renderSavedPlayers();
  profilesDialog.classList.toggle('player-oriented-opponent', imageDialog.classList.contains('player-oriented-opponent'));
  profilesDialog.showModal();
});

customColor.addEventListener('input', () => {
  const hex = customColor.value;
  const color = [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16)).join(', ');
  selectPlayerColor(color);
});

document.querySelector('#save-player-profile').addEventListener('click', () => {
  const player = state.players.find((item) => item.id === imagePlayerId);
  if (!player) return;
  player.name = playerSettingsName.value.trim() || player.name;
  savePlayerProfile(player);
  saveState();
  imageDialog.close();
  render();
});

document.querySelector('#remove-current-image').addEventListener('click', () => {
  const player = state.players.find((item) => item.id === imagePlayerId);
  if (!player) return;
  Object.assign(player, { image: null, artist: null, cardName: null });
  savePlayerProfile(player);
  saveState();
  imageDialog.close();
  render();
});

document.querySelector('#fullscreen').addEventListener('click', async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
  } catch (_) {
    // Alguns navegadores, especialmente no iOS, não oferecem a API de tela cheia.
  }
});

document.querySelectorAll('.close-modal').forEach((button) => {
  button.addEventListener('click', () => button.closest('dialog').close());
});

[imageDialog, profilesDialog, gameLogDialog, logRestoreDialog, newGameDialog].forEach((dialog) => {
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });
});

document.addEventListener('pointerdown', unlockSounds, { capture: true });
document.addEventListener('pointerup', unlockSounds, { capture: true });
document.addEventListener('touchstart', unlockSounds, { capture: true, passive: true });
document.addEventListener('touchend', unlockSounds, { capture: true, passive: true });
document.addEventListener('click', unlockSounds, { capture: true });
initializeSounds();
render();
if (state.winnerPlayerId) startVictoryCelebration();
else checkForWinner();
setInterval(tickTimer, 250);
window.addEventListener('resize', moveNamesClearOfTurnButton);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    tickTimer();
    saveState();
  } else {
    lastTimerTick = Date.now();
  }
});

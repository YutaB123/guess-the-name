const socket = io({ transports: ['websocket'] });

let myId      = null;
let myRoomId  = null;
let scores    = {};

// ── Helpers ──────────────────────────────────────────
const $ = id => document.getElementById(id);
const SCREENS = ['lobby', 'hinter', 'guesser', 'result', 'gameover'];

function show(name) {
  SCREENS.forEach(s => $(`screen-${s}`)?.classList.toggle('hidden', s !== name));
}

function lobbyState(name) {
  ['loading','waiting','error'].forEach(s =>
    $(`lobby-${s}`).classList.toggle('hidden', s !== name));
}

function hinterState(name) {
  $('hinter-setup').classList.toggle('hidden',   name !== 'setup');
  $('hinter-waiting').classList.toggle('hidden', name !== 'waiting');
}

function guesserState(name) {
  $('guesser-waiting').classList.toggle('hidden',  name !== 'waiting');
  $('guesser-playing').classList.toggle('hidden',  name !== 'playing');
}

function oppId() {
  return Object.keys(scores).find(id => id !== myId);
}

function updateHeaders() {
  const me  = scores[myId]     ?? 0;
  const opp = scores[oppId()]  ?? 0;
  const html = `<span>You <b>${me}</b></span><span class="sep">/</span><span>Opp <b>${opp}</b></span><span class="goal">First to 20</span>`;
  if ($('hdr-scores'))   $('hdr-scores').innerHTML   = html;
  if ($('hdr-scores-g')) $('hdr-scores-g').innerHTML = html;
}

function renderScoreBars(containerId) {
  const me  = scores[myId]    ?? 0;
  const opp = scores[oppId()] ?? 0;
  $(containerId).innerHTML = `
    <div class="score-bar-row">
      <span class="sb-label">You</span>
      <div class="sb-track"><div class="sb-fill you" style="width:${Math.min(me/20*100,100)}%"></div></div>
      <span class="sb-val">${me} / 20</span>
    </div>
    <div class="score-bar-row">
      <span class="sb-label">Opp</span>
      <div class="sb-track"><div class="sb-fill opp" style="width:${Math.min(opp/20*100,100)}%"></div></div>
      <span class="sb-val">${opp} / 20</span>
    </div>`;
}

function catLabel(cat) {
  return { person:'👤 Person', food:'🍕 Food', object:'📦 Object', place:'📍 Place', movie:'🎬 Movie / Show' }[cat] || cat;
}

// ── Boot ─────────────────────────────────────────────
lobbyState('loading');
show('lobby');

socket.on('connect', () => {
  myId = socket.id;
  const params    = new URLSearchParams(location.search);
  const roomParam = params.get('room');
  if (roomParam) {
    myRoomId = roomParam.toUpperCase();
    socket.emit('join_room', { roomId: myRoomId });
  } else {
    socket.emit('create_room');
  }
});

// ── Lobby ────────────────────────────────────────────
socket.on('room_created', ({ roomId }) => {
  myRoomId = roomId;
  $('room-code-display').textContent = roomId;
  $('share-link').value = `${location.origin}/game.html?room=${roomId}`;
  lobbyState('waiting');
});

socket.on('join_error', ({ message }) => {
  $('error-msg').textContent = message;
  lobbyState('error');
});

$('copy-btn').addEventListener('click', () => {
  navigator.clipboard.writeText($('share-link').value).then(() => {
    $('copy-btn').textContent = 'Copied!';
    setTimeout(() => $('copy-btn').textContent = 'Copy', 2000);
  });
});

// ── Hinter ───────────────────────────────────────────
socket.on('your_turn_hint', ({ roundNumber, scores: s }) => {
  scores = s;
  updateHeaders();
  $('hinter-round').textContent = `Round ${roundNumber}`;
  resetHinterForm();
  hinterState('setup');
  show('hinter');
});

socket.on('hints_submitted', ({ answer }) => {
  $('hw-answer').textContent = answer;
  document.querySelectorAll('.ht-item').forEach(el => el.classList.remove('active','used'));
  hinterState('waiting');
});

socket.on('hint_progress', ({ hintNumber }) => {
  document.querySelectorAll('.ht-item').forEach(el => {
    const n = +el.dataset.n;
    el.classList.toggle('active', n === hintNumber);
    el.classList.toggle('used',   n < hintNumber);
  });
});

// ── Hinter form ───────────────────────────────────────
let selectedCat = null;

document.querySelectorAll('.cat-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.cat-btn').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
    selectedCat = btn.dataset.cat;
    validateForm();
  });
});

$('answer-input').addEventListener('input', validateForm);
document.querySelectorAll('.hint-input').forEach(i => i.addEventListener('input', validateForm));

function validateForm() {
  const answer = $('answer-input').value.trim();
  const hints  = [...document.querySelectorAll('.hint-input')].map(i => i.value.trim());
  $('submit-hints-btn').disabled = !(selectedCat && answer && hints.every(h => h));
}

$('submit-hints-btn').addEventListener('click', () => {
  socket.emit('submit_hints', {
    category: selectedCat,
    answer:   $('answer-input').value.trim(),
    hints:    [...document.querySelectorAll('.hint-input')].map(i => i.value.trim()),
  });
});

function resetHinterForm() {
  selectedCat = null;
  document.querySelectorAll('.cat-btn').forEach(b => b.classList.remove('selected'));
  $('answer-input').value = '';
  document.querySelectorAll('.hint-input').forEach(i => i.value = '');
  $('submit-hints-btn').disabled = true;
}

// ── Guesser ───────────────────────────────────────────
socket.on('waiting_for_hints', ({ roundNumber, scores: s }) => {
  scores = s;
  updateHeaders();
  $('guesser-round').textContent = `Round ${roundNumber}`;
  guesserState('waiting');
  show('guesser');
});

socket.on('round_playing', ({ category }) => {
  $('cat-tag').textContent = catLabel(category);
  $('hints-list').innerHTML = '';
  $('guess-input').value = '';
  $('guess-feedback').innerHTML = '';
  $('pts-pill').innerHTML = 'Worth <b>5</b> pts';
  $('next-hint-btn').classList.remove('hidden');
  $('give-up-btn').classList.add('hidden');
  guesserState('playing');
});

socket.on('hint_revealed', ({ allHints, hintNumber, pointsAvailable, isLastHint }) => {
  $('pts-pill').innerHTML = `Worth <b>${pointsAvailable}</b> pts`;
  $('hints-list').innerHTML = allHints.map((h, i) => `
    <div class="hint-bubble ${i === allHints.length - 1 ? 'latest' : ''}">
      <span class="hb-num">${i + 1}</span>
      <span class="hb-text">${h}</span>
    </div>
  `).join('');
  $('hints-list').scrollTop = $('hints-list').scrollHeight;
  $('guess-input').value = '';
  $('guess-feedback').innerHTML = '';
  $('guess-input').focus();

  if (isLastHint) {
    $('next-hint-btn').classList.add('hidden');
    $('give-up-btn').classList.remove('hidden');
  } else {
    $('next-hint-btn').classList.remove('hidden');
    $('give-up-btn').classList.add('hidden');
  }
});

socket.on('wrong_guess', () => {
  $('guess-feedback').innerHTML = '<span class="wrong-flash">❌ Wrong! Try again.</span>';
  $('guess-input').select();
});

$('submit-guess-btn').addEventListener('click', submitGuess);
$('guess-input').addEventListener('keydown', e => { if (e.key === 'Enter') submitGuess(); });

function submitGuess() {
  const guess = $('guess-input').value.trim();
  if (!guess) return;
  socket.emit('submit_guess', { guess });
}

$('next-hint-btn').addEventListener('click', () => {
  $('guess-feedback').innerHTML = '';
  socket.emit('next_hint');
});

$('give-up-btn').addEventListener('click', () => socket.emit('give_up'));

// ── Round result ─────────────────────────────────────
socket.on('round_over', ({ correct, answer, points, scorer, scores: s, hinter, guesser, gameOver, winner }) => {
  scores = s;

  const iGuesser  = guesser === myId;
  const iScored   = scorer  === myId;

  let icon, title;
  if (correct && iGuesser) { icon = '🎉'; title = `You got it! +${points} pts`; }
  else if (correct)        { icon = '😅'; title = `They guessed it! +${points} pts for them`; }
  else if (!iGuesser)      { icon = '🏆'; title = `They gave up! +${points} pts for you`; }
  else                     { icon = '😔'; title = `You couldn't get it — +${points} pts for opponent`; }

  $('result-icon').textContent  = icon;
  $('result-title').textContent = title;
  $('result-answer').textContent = `The answer was: "${answer}"`;
  renderScoreBars('result-scores');

  $('ready-btn').classList.remove('hidden');
  $('ready-waiting').classList.add('hidden');

  if (gameOver) {
    setTimeout(() => {
      const iWon = winner === myId;
      $('gameover-icon').textContent  = iWon ? '🏆' : '😔';
      $('gameover-title').textContent = iWon ? 'You win!' : 'You lose!';
      renderScoreBars('final-scores');
      show('gameover');
    }, 2500);
  } else {
    show('result');
  }
});

socket.on('opponent_ready', () => {
  $('ready-waiting').classList.remove('hidden');
});

$('ready-btn').addEventListener('click', () => {
  socket.emit('ready_next_round');
  $('ready-btn').classList.add('hidden');
  $('ready-waiting').classList.remove('hidden');
});

socket.on('opponent_left', () => {
  alert('Your opponent left the game.');
  location.href = '/';
});

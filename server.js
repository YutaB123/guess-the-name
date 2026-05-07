const express = require('express');
const http    = require('http');
const path    = require('path');
const { Server } = require('socket.io');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

const rooms = new Map();

function generateRoomId() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let id;
  do {
    id = Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  } while (rooms.has(id));
  return id;
}

function startRound(roomId) {
  const room = rooms.get(roomId);
  if (!room) return;

  room.roundNumber++;
  room.readyCount = 0;

  // Alternate who hints each round
  const hinter  = room.roundNumber % 2 === 1 ? room.player1 : room.player2;
  const guesser = hinter === room.player1 ? room.player2 : room.player1;

  room.round = {
    hinter,
    guesser,
    category:      null,
    answer:        null,
    answerDisplay: null,
    hints:         [],
    hintsRevealed: 0,
    status:        'entering',
  };

  io.to(hinter).emit('your_turn_hint', {
    roundNumber: room.roundNumber,
    scores:      room.scores,
  });

  io.to(guesser).emit('waiting_for_hints', {
    roundNumber: room.roundNumber,
    scores:      room.scores,
  });
}

function revealHint(roomId) {
  const room = rooms.get(roomId);
  if (!room?.round) return;

  room.round.hintsRevealed++;
  const idx             = room.round.hintsRevealed - 1;
  const pointsAvailable = 6 - room.round.hintsRevealed;
  const isLastHint      = room.round.hintsRevealed >= 5;

  io.to(room.round.guesser).emit('hint_revealed', {
    allHints:       room.round.hints.slice(0, room.round.hintsRevealed),
    hintNumber:     room.round.hintsRevealed,
    pointsAvailable,
    isLastHint,
  });

  io.to(room.round.hinter).emit('hint_progress', {
    hintNumber: room.round.hintsRevealed,
  });
}

function endRound(roomId, { correct }) {
  const room = rooms.get(roomId);
  if (!room?.round) return;

  room.round.status = 'done';
  const { hinter, guesser } = room.round;

  let points, scorer;
  if (correct) {
    points = 6 - room.round.hintsRevealed;
    scorer = guesser;
  } else {
    points = 5;
    scorer = hinter;
  }

  room.scores[scorer] = (room.scores[scorer] || 0) + points;

  const gameOver = Object.values(room.scores).some(s => s >= 20);
  const winner   = gameOver
    ? Object.keys(room.scores).find(id => room.scores[id] >= 20)
    : null;

  if (gameOver) room.status = 'gameover';

  io.to(roomId).emit('round_over', {
    correct,
    answer:  room.round.answerDisplay,
    points,
    scorer,
    scores:  room.scores,
    hinter,
    guesser,
    gameOver,
    winner,
  });
}

io.on('connection', (socket) => {

  socket.on('create_room', () => {
    const roomId = generateRoomId();
    rooms.set(roomId, {
      player1:     socket.id,
      player2:     null,
      scores:      {},
      roundNumber: 0,
      readyCount:  0,
      status:      'waiting',
      round:       null,
    });
    socket.join(roomId);
    socket.data.roomId = roomId;
    socket.emit('room_created', { roomId });
  });

  socket.on('join_room', ({ roomId }) => {
    const id   = roomId?.toUpperCase();
    const room = rooms.get(id);
    if (!room)        { socket.emit('join_error', { message: 'Room not found.' }); return; }
    if (room.player2) { socket.emit('join_error', { message: 'Room is full.' });   return; }

    room.player2 = socket.id;
    room.status  = 'playing';
    room.scores[room.player1] = 0;
    room.scores[socket.id]    = 0;

    socket.join(id);
    socket.data.roomId = id;

    startRound(id);
  });

  socket.on('submit_hints', ({ category, answer, hints }) => {
    const { roomId } = socket.data;
    const room = rooms.get(roomId);
    if (!room?.round || room.round.hinter !== socket.id) return;
    if (room.round.status !== 'entering') return;
    if (!answer?.trim() || !hints?.every(h => h?.trim())) return;

    room.round.category      = category;
    room.round.answer        = answer.trim().toLowerCase();
    room.round.answerDisplay = answer.trim();
    room.round.hints         = hints.map(h => h.trim());
    room.round.status        = 'playing';

    socket.emit('hints_submitted', { answer: answer.trim() });
    io.to(room.round.guesser).emit('round_playing', { category });

    revealHint(roomId);
  });

  socket.on('submit_guess', ({ guess }) => {
    const { roomId } = socket.data;
    const room = rooms.get(roomId);
    if (!room?.round || room.round.guesser !== socket.id) return;
    if (room.round.status !== 'playing') return;

    const correct = guess.trim().toLowerCase() === room.round.answer;
    if (correct) {
      endRound(roomId, { correct: true });
    } else {
      socket.emit('wrong_guess');
    }
  });

  socket.on('next_hint', () => {
    const { roomId } = socket.data;
    const room = rooms.get(roomId);
    if (!room?.round || room.round.guesser !== socket.id) return;
    if (room.round.status !== 'playing') return;

    if (room.round.hintsRevealed >= 5) {
      endRound(roomId, { correct: false });
    } else {
      revealHint(roomId);
    }
  });

  socket.on('give_up', () => {
    const { roomId } = socket.data;
    const room = rooms.get(roomId);
    if (!room?.round || room.round.guesser !== socket.id) return;
    if (room.round.status !== 'playing') return;
    endRound(roomId, { correct: false });
  });

  socket.on('ready_next_round', () => {
    const { roomId } = socket.data;
    const room = rooms.get(roomId);
    if (!room || room.status === 'gameover') return;
    room.readyCount = (room.readyCount || 0) + 1;
    socket.to(roomId).emit('opponent_ready');
    if (room.readyCount >= 2) startRound(roomId);
  });

  socket.on('disconnect', () => {
    const { roomId } = socket.data;
    if (!roomId) return;
    socket.to(roomId).emit('opponent_left');
    rooms.delete(roomId);
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => console.log(`Guess the Name running on http://localhost:${PORT}`));

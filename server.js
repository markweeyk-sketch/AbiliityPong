const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.static(path.join(__dirname, 'public')));

// ── Socket.io room scaffolding (not active until ONLINE_MODE = true in game.js) ──
const rooms = new Map();

io.on('connection', (socket) => {
  console.log('client connected:', socket.id);

  socket.on('create_room', ({ roomId, playerAbility }) => {
    rooms.set(roomId, { players: [{ id: socket.id, ability: playerAbility }], state: null });
    socket.join(roomId);
    socket.emit('room_created', { roomId });
  });

  socket.on('join_room', ({ roomId, playerAbility }) => {
    const room = rooms.get(roomId);
    if (!room || room.players.length >= 2) {
      socket.emit('room_error', { message: 'Room full or not found' });
      return;
    }
    room.players.push({ id: socket.id, ability: playerAbility });
    socket.join(roomId);
    io.to(roomId).emit('game_start', {
      players: room.players,
      roomId,
    });
  });

  socket.on('player_input', ({ roomId, paddleY }) => {
    socket.to(roomId).emit('opponent_input', { paddleY });
  });

  socket.on('game_state', ({ roomId, state }) => {
    socket.to(roomId).emit('game_state', state);
  });

  socket.on('ability_used', ({ roomId, ability, side }) => {
    socket.to(roomId).emit('ability_used', { ability, side });
  });

  socket.on('game_over', ({ roomId, winner }) => {
    io.to(roomId).emit('game_over', { winner });
    rooms.delete(roomId);
  });

  socket.on('disconnect', () => {
    console.log('client disconnected:', socket.id);
    for (const [roomId, room] of rooms.entries()) {
      if (room.players.some(p => p.id === socket.id)) {
        io.to(roomId).emit('opponent_disconnected');
        rooms.delete(roomId);
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Pong Abilities running at http://localhost:${PORT}`));

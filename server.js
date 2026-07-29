const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

// Указываем серверу раздавать файлы из папки, где лежит игра
app.use(express.static(path.join(__dirname, './')));

// Хранилище для активных игроков на сервере
let onlinePlayers = {};

io.on('connection', (socket) => {
  console.log(`Игрок подключился: ${socket.id}`);

  // 1. Создаем начальное состояние для нового подключившегося игрока
  onlinePlayers[socket.id] = {
    id: socket.id,
    x: 520,
    y: 400,
    targetX: 520,
    targetY: 400,
    currentLocation: 'square',
    name: 'Игрок_' + socket.id.substring(0, 4),
    color: '#3b82f6',
    equipped: { hat: null, accessory: null }, // Хранение одежды
    speechBubble: { text: '', timer: 0 }
  };

  // 2. Отправляем новому игроку список всех, кто уже в сети
  socket.emit('currentPlayers', onlinePlayers);

  // 3. Сообщаем остальным игрокам, что зашел новый пользователь
  socket.broadcast.emit('newPlayer', onlinePlayers[socket.id]);

  // 4. Обработка движения
  socket.on('playerMovement', (movementData) => {
    if (onlinePlayers[socket.id]) {
      onlinePlayers[socket.id].targetX = movementData.targetX;
      onlinePlayers[socket.id].targetY = movementData.targetY;
      onlinePlayers[socket.id].currentLocation = movementData.currentLocation;
      
      socket.broadcast.emit('playerMoved', onlinePlayers[socket.id]);
    }
  });

  // 5. Обработка телепортации
  socket.on('locationTeleport', (teleportData) => {
    if (onlinePlayers[socket.id]) {
      onlinePlayers[socket.id].x = teleportData.x;
      onlinePlayers[socket.id].y = teleportData.y;
      onlinePlayers[socket.id].targetX = teleportData.targetX;
      onlinePlayers[socket.id].targetY = teleportData.targetY;
      onlinePlayers[socket.id].currentLocation = teleportData.currentLocation;
      
      socket.broadcast.emit('playerTeleported', onlinePlayers[socket.id]);
    }
  });

  // 6. Обработка изменения внешности (цвет + одежда) - Этап 1
  socket.on('playerAppearance', (data) => {
    if (onlinePlayers[socket.id]) {
      onlinePlayers[socket.id].color = data.color;
      onlinePlayers[socket.id].equipped = data.equipped;

      socket.broadcast.emit('playerAppearanceChanged', {
        id: socket.id,
        color: data.color,
        equipped: data.equipped
      });
    }
  });

  // 7. Синхронизация текста в чате
  socket.on('chatMessage', (chatData) => {
    if (onlinePlayers[socket.id]) {
      onlinePlayers[socket.id].speechBubble = chatData;
      socket.broadcast.emit('playerSpoke', {
        id: socket.id,
        speechBubble: chatData
      });
    }
  });

  // 8. Игрок отключился
  socket.on('disconnect', () => {
    console.log(`Игрок отключился: ${socket.id}`);
    delete onlinePlayers[socket.id];
    io.emit('playerDisconnected', socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Сервер игры запущен на порту ${PORT}`);
});

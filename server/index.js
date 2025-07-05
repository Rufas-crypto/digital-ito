const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const cors = require('cors');

const app = express();
app.use(cors());

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "http://localhost:3000",
    methods: ["GET", "POST"]
  }
});

const rooms = {};
const themes = ["一番人気な映画", "もらって嬉しいプレゼント", "最強の動物", "住みたい街", "あったら嬉しいドラえもんの道具"];

const generateNumbers = () => Array.from({ length: 100 }, (_, i) => i + 1);

// ルームの初期状態に hostId を追加
const createNewRoomState = () => ({
  players: {},
  hostId: null, // ホストのソケットID
  orderedPlayerIds: [],
  availableNumbers: generateNumbers(),
  theme: themes[Math.floor(Math.random() * themes.length)],
  isResultShown: false,
});

io.on('connection', (socket) => {
  console.log(`ユーザーが接続しました: ${socket.id}`);

  socket.on("join_room", (data) => {
    const { room, nickname } = data;
    socket.join(room);
    console.log(`ユーザー ${socket.id} (ニックネーム: ${nickname}) がルーム ${room} に参加しました`);

    if (!rooms[room]) {
      rooms[room] = createNewRoomState();
      // 最初のプレイヤーをホストに設定
      rooms[room].hostId = socket.id;
    }

    const availableNumbers = rooms[room].availableNumbers;
    if (availableNumbers.length === 0) {
      socket.emit("error_message", "このルームは満員です。");
      return;
    }
    const randomIndex = Math.floor(Math.random() * availableNumbers.length);
    const assignedNumber = availableNumbers.splice(randomIndex, 1)[0];

    rooms[room].players[socket.id] = {
      id: socket.id,
      nickname: nickname,
      number: assignedNumber,
      answer: "",
      isReady: false
    };

    socket.emit("your_card", { number: assignedNumber });
    io.to(room).emit("game_update", rooms[room]);
  });

  socket.on("submit_answer", (data) => {
    const { answer } = data;
    for (const roomName in rooms) {
      if (rooms[roomName].players[socket.id]) {
        const room = rooms[roomName];
        const player = room.players[socket.id];
        const sanitizedAnswer = answer.replace(/[<>]/g, '');
        player.answer = sanitizedAnswer;
        player.isReady = true;
        if (!room.orderedPlayerIds.includes(player.id)) {
          room.orderedPlayerIds.push(player.id);
        }
        io.to(roomName).emit("game_update", room);
        break;
      }
    }
  });

  socket.on("update_order", (data) => {
    const { orderedIds } = data;
    for (const roomName in rooms) {
      if (rooms[roomName].players[socket.id]) {
        const room = rooms[roomName];
        room.orderedPlayerIds = orderedIds;
        socket.to(roomName).emit("game_update", room);
        break;
      }
    }
  });

  socket.on("show_result", () => {
    for (const roomName in rooms) {
      const room = rooms[roomName];
      if (room.players[socket.id] && socket.id === room.hostId) { // ホストのみ実行可能
        room.isResultShown = true;
        io.to(roomName).emit("game_update", room);
        break;
      }
    }
  });

  socket.on("reset_game", () => {
    for (const roomName in rooms) {
      const room = rooms[roomName];
      if (room.players[socket.id] && socket.id === room.hostId) { // ホストのみ実行可能
        console.log(`ルーム ${roomName} のゲームをリセットします`);
        const newAvailableNumbers = generateNumbers();
        room.theme = themes[Math.floor(Math.random() * themes.length)];
        room.isResultShown = false;
        room.orderedPlayerIds = [];

        for (const playerId in room.players) {
          const player = room.players[playerId];
          player.answer = "";
          player.isReady = false;
          const randomIndex = Math.floor(Math.random() * newAvailableNumbers.length);
          const assignedNumber = newAvailableNumbers.splice(randomIndex, 1)[0];
          player.number = assignedNumber;
          io.to(playerId).emit("your_card", { number: assignedNumber });
        }
        room.availableNumbers = newAvailableNumbers;
        io.to(roomName).emit("game_update", room);
        break;
      }
    }
  });

  // 新しい解散イベント
  socket.on("disband_room", () => {
    for (const roomName in rooms) {
      const room = rooms[roomName];
      if (room.players[socket.id] && socket.id === room.hostId) { // ホストのみ実行可能
        console.log(`ホストがルーム ${roomName} を解散しました`);
        io.to(roomName).emit("room_disbanded"); // 全員に解散を通知
        delete rooms[roomName]; // サーバーからルーム情報を削除
        break;
      }
    }
  });

  socket.on('disconnect', () => {
    console.log(`ユーザーが切断しました: ${socket.id}`);
    for (const roomName in rooms) {
      if (rooms[roomName].players[socket.id]) {
        const room = rooms[roomName];
        const disconnectedPlayer = room.players[socket.id];
        if(disconnectedPlayer) {
            room.availableNumbers.push(disconnectedPlayer.number);
        }
        delete room.players[socket.id];
        room.orderedPlayerIds = room.orderedPlayerIds.filter(id => id !== socket.id);

        if (Object.keys(room.players).length === 0) {
          delete rooms[roomName];
          console.log(`ルーム ${roomName} を削除しました`);
        } else {
          // ホストが抜けたら、残っている誰かを新しいホストにする
          if (room.hostId === socket.id) {
            room.hostId = Object.keys(room.players)[0];
            console.log(`新しいホストは ${room.hostId} です`);
          }
          io.to(roomName).emit("game_update", room);
        }
        break;
      }
    }
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`サーバーがポート ${PORT} で起動しました`);
});
const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const cors = require('cors');
const sanitizeHtml = require('sanitize-html');

const app = express();
app.use(cors());

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: process.env.CLIENT_URL || "http://localhost:3000",
    methods: ["GET", "POST"]
  }
});

const rooms = {};
const themes = require('./data/themes.json');

const generateNumbers = () => Array.from({ length: 100 }, (_, i) => i + 1);

// レートリミット設定
const RATE_LIMIT_INTERVAL = 1000; // 1秒
const RATE_LIMIT_MAX_EVENTS = 1; // 1秒間に1イベントまで
const lastEventTime = {}; // 各ソケットの最終イベント送信時刻を記録

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

    // ルーム名の検証
    if (!room || typeof room !== 'string' || room.length < 1 || room.length > 20 || !/^[a-zA-Z0-9]+$/.test(room)) {
      socket.emit("error_message", "ルーム名は1〜20文字の英数字で入力してください。");
      return;
    }

    // ニックネームの検証
    if (!nickname || typeof nickname !== 'string' || nickname.length < 1 || nickname.length > 20 || !/^[a-zA-Z0-9\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF]+$/.test(nickname)) {
      socket.emit("error_message", "ニックネームは1〜20文字の英数字、ひらがな、カタカナ、漢字で入力してください。");
      return;
    }

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
      nickname: sanitizeHtml(nickname, { allowedTags: [], allowedAttributes: {} }), // ニックネームをサニタイズ
      number: assignedNumber,
      answer: "",
      isReady: false
    };

    socket.emit("your_card", { number: assignedNumber });
    io.to(room).emit("game_update", rooms[room]);
  });

  socket.on("submit_answer", (data) => {
    // レートリミットチェック
    const now = Date.now();
    if (lastEventTime[socket.id] && (now - lastEventTime[socket.id] < RATE_LIMIT_INTERVAL)) {
      console.warn(`レートリミット超過: ${socket.id} が submit_answer を短期間に送信しようとしました`);
      return; // イベントを無視
    }
    lastEventTime[socket.id] = now;

    const { answer } = data;

    // 回答の検証
    if (!answer || typeof answer !== 'string' || answer.length < 1 || answer.length > 100) {
      socket.emit("error_message", "回答は1〜100文字で入力してください。");
      return;
    }

    for (const roomName in rooms) {
      if (rooms[roomName].players[socket.id]) {
        const room = rooms[roomName];
        const player = room.players[socket.id];
        const sanitizedAnswer = sanitizeHtml(answer, { allowedTags: [], allowedAttributes: {} }); // 回答をサニタイズ
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
    try {
      for (const roomName in rooms) {
        const room = rooms[roomName];
        if (room.players[socket.id]) {
          if (socket.id === room.hostId) { // ホストのみ実行可能
            room.isResultShown = true;
            io.to(roomName).emit("game_update", room);
            return; // 処理完了
          } else {
            socket.emit("error_message", "ホストのみが結果を表示できます。");
            return; // 権限なし
          }
        }
      }
      socket.emit("error_message", "参加中のルームが見つかりません。");
    } catch (error) {
      console.error(`show_result エラー: ${error.message}`);
      socket.emit("error_message", "サーバーでエラーが発生しました。");
    }
  });

  socket.on("reset_game", () => {
    try {
      for (const roomName in rooms) {
        const room = rooms[roomName];
        if (room.players[socket.id]) {
          if (socket.id === room.hostId) { // ホストのみ実行可能
            console.log(`ルーム ${roomName} のゲームをリセットします`);
            const newAvailableNumbers = generateNumbers();
            
            let newTheme = room.theme;
            // 直前のお題と同じにならないように再抽選
            while (newTheme === room.theme) {
              newTheme = themes[Math.floor(Math.random() * themes.length)];
            }
            room.theme = newTheme;

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
            return; // 処理完了
          } else {
            socket.emit("error_message", "ホストのみがゲームをリセットできます。");
            return; // 権限なし
          }
        }
      }
      socket.emit("error_message", "参加中のルームが見つかりません。");
    } catch (error) {
      console.error(`reset_game エラー: ${error.message}`);
      socket.emit("error_message", "サーバーでエラーが発生しました。");
    }
  });

  // 新しい解散イベント
  socket.on("disband_room", () => {
    try {
      for (const roomName in rooms) {
        const room = rooms[roomName];
        if (room.players[socket.id]) {
          if (socket.id === room.hostId) { // ホストのみ実行可能
            console.log(`ホストがルーム ${roomName} を解散しました`);
            io.to(roomName).emit("room_disbanded"); // 全員に解散を通知
            delete rooms[roomName]; // サーバーからルーム情報を削除
            return; // 処理完了
          } else {
            socket.emit("error_message", "ホストのみがルームを解散できます。");
            return; // 権限なし
          }
        }
      }
      socket.emit("error_message", "参加中のルームが見つかりません。");
    } catch (error) {
      console.error(`disband_room エラー: ${error.message}`);
      socket.emit("error_message", "サーバーでエラーが発生しました。");
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
import React, { useState, useEffect } from 'react';
import io from 'socket.io-client';
import { DragDropContext, Droppable, Draggable } from 'react-beautiful-dnd';

const socket = io.connect("http://localhost:3001");

// --- ゲームルーム画面のコンポーネント ---
function GameRoom({ nickname, room, gameState, myCard, resetGame }) {
  const [answer, setAnswer] = useState("");

  const submitAnswer = () => {
    if (answer.trim() === "") {
      alert("回答を入力してください。");
      return;
    }
    socket.emit("submit_answer", { answer });
    setAnswer("");
  };

  const handleOnDragEnd = (result) => {
    if (!result.destination) return;

    const items = Array.from(gameState.orderedPlayerIds);
    const [reorderedItem] = items.splice(result.source.index, 1);
    items.splice(result.destination.index, 0, reorderedItem);

    socket.emit("update_order", { orderedIds: items });
  };

  const showResult = () => {
    socket.emit("show_result");
  };

  const startNewGame = () => {
    socket.emit("reset_game");
  };

  const disbandRoom = () => {
    if (window.confirm("本当にルームを解散しますか？全員が最初の画面に戻ります。")) {
      socket.emit("disband_room");
    }
  };

  if (!gameState) {
    return <div>Loading...</div>;
  }

  const me = gameState.players[socket.id];
  const allPlayersReady = Object.values(gameState.players).every(p => p.isReady);
  const orderedPlayers = gameState.orderedPlayerIds.map(id => gameState.players[id]);
  const isHost = socket.id === gameState.hostId;

  let isCorrect = true;
  for (let i = 0; i < orderedPlayers.length - 1; i++) {
    if (orderedPlayers[i].number > orderedPlayers[i+1].number) {
      isCorrect = false;
      break;
    }
  }

  return (
    <div>
      <div className={`alert ${gameState.isResultShown ? (isCorrect ? 'alert-success' : 'alert-danger') : 'alert-info'}`}>
        <h4 className="alert-heading">お題: {gameState.theme}</h4>
        {gameState.isResultShown ? (
          <p>結果発表！並び順は {isCorrect ? "成功です！" : "失敗です..."}</p>
        ) : (
          <p>自分のカードの数字の強さを、このお題に沿った言葉で表現してください。</p>
        )}
      </div>

      <div className="row">
        {/* 左側 */}
        <div className="col-md-4">
          <div className="card mb-3">
            <div className="card-header">あなたのカード</div>
            <div className="card-body text-center">
              <h1 className="display-1">{myCard !== null ? myCard : '？'}</h1>
            </div>
          </div>

          {me && !me.isReady && (
            <div className="card mb-3">
              <div className="card-header">回答する</div>
              <div className="card-body">
                <textarea className="form-control" rows="3" placeholder="お題に沿った回答を入力" value={answer} onChange={(e) => setAnswer(e.target.value)}></textarea>
                <button className="btn btn-primary w-100 mt-2" onClick={submitAnswer}>これで決定！</button>
              </div>
            </div>
          )}

          <div className="card">
            <div className="card-header">参加者一覧</div>
            <ul className="list-group list-group-flush">
              {Object.values(gameState.players).map((player) => (
                <li key={player.id} className="list-group-item d-flex justify-content-between align-items-center">
                  {player.nickname} {player.id === gameState.hostId && <span className="badge bg-primary">ホスト</span>}
                  {player.isReady ? <span className="badge bg-success">回答済み</span> : <span className="badge bg-secondary">回答待ち</span>}
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* 右側: ゲームボード */}
        <div className="col-md-8">
          <div className="d-flex justify-content-between align-items-center mb-2">
            <h4>ゲームボード</h4>
            {allPlayersReady && !gameState.isResultShown && isHost && (
              <button className="btn btn-success" onClick={showResult}>結果を見る！</button>
            )}
            {allPlayersReady && !gameState.isResultShown && !isHost && (
              <span className="text-muted">ホストが結果発表するのを待っています...</span>
            )}
            {gameState.isResultShown && isHost && (
              <div>
                <button className="btn btn-warning me-2" onClick={startNewGame}>新しいゲームを始める</button>
                <button className="btn btn-danger" onClick={disbandRoom}>ルームを解散する</button>
              </div>
            )}
            {gameState.isResultShown && !isHost && (
              <span className="text-muted">ホストが次のゲームを開始するか、ルームを解散するのを待っています...</span>
            )}
          </div>
          <DragDropContext onDragEnd={handleOnDragEnd}>
            <Droppable droppableId="players">
              {(provided) => (
                <div {...provided.droppableProps} ref={provided.innerRef} className="p-3 border rounded bg-light d-flex flex-column" style={{ minHeight: '400px' }}>
                  <div className="text-center text-muted small fw-bold">小さい（と予想） ▲</div>
                  <div className="mt-2 mb-2 flex-grow-1">
                    {orderedPlayers.map((player, index) => (
                      <Draggable key={player.id} draggableId={player.id} index={index} isDragDisabled={gameState.isResultShown}>
                        {(provided) => (
                          <div ref={provided.innerRef} {...provided.draggableProps} {...provided.dragHandleProps} className="mb-2">
                            <div className="p-3 border rounded d-flex justify-content-between align-items-center">
                            <div>
                              {index + 1}. <span className="fw-bold text-primary">ニックネーム</span>: <span className="text-dark">{player.nickname}</span> <span className="fw-bold text-success ms-3">回答</span>: <span className="text-dark">{player.answer}</span>
                            </div>
                            {gameState.isResultShown && (
                              <span className="badge bg-info fs-6">数字: {player.number}</span>
                            )}
                          </div>
                          </div>
                        )}
                      </Draggable>
                    ))}
                  </div>
                  {provided.placeholder}
                  <div className="text-center text-muted small fw-bold">大きい（と予想） ▼</div>
                </div>
              )}
            </Droppable>
          </DragDropContext>
        </div>
      </div>
    </div>
  );
}

// --- アプリケーション全体のコンポーネント ---
function App() {
  const [nickname, setNickname] = useState('');
  const [room, setRoom] = useState('');
  const [showGame, setShowGame] = useState(false);
  const [gameState, setGameState] = useState(null);
  const [myCard, setMyCard] = useState(null);

  useEffect(() => {
    socket.on("your_card", (data) => setMyCard(data.number));
    socket.on("game_update", (data) => setGameState(data));
    socket.on("room_disbanded", () => {
      alert("ホストがルームを解散しました。");
      setShowGame(false); // 最初の画面に戻る
      setGameState(null);
      setMyCard(null);
    });
    socket.on("error_message", (message) => alert(message));

    return () => {
      socket.off("your_card");
      socket.off("game_update");
      socket.off("room_disbanded");
      socket.off("error_message");
    };
  }, []);

  const joinRoom = () => {
    const cleanNickname = nickname.trim().replace(/[<>]/g, '');
    const cleanRoom = room.trim().replace(/[<>]/g, '');
    if (cleanNickname !== "" && cleanRoom !== "") {
      socket.emit("join_room", { room: cleanRoom, nickname: cleanNickname });
      setShowGame(true);
    } else {
      alert("ニックネームとルーム名を入力してください。");
    }
  };

  return (
    <div className="container mt-4 mb-4">
      <header className="text-center mb-4">
        <h1>ito デジタル</h1>
      </header>
      {!showGame ? (
        <div className="row justify-content-center">
          <div className="col-md-6">
            <div className="card">
              <div className="card-body">
                <h3 className="card-title text-center">ゲームに参加</h3>
                <div className="mb-3">
                  <label htmlFor="nickname" className="form-label">ニックネーム</label>
                  <input type="text" className="form-control" id="nickname" maxLength="15" placeholder="15文字以内" onChange={(e) => setNickname(e.target.value)} onKeyPress={(e) => e.key === 'Enter' && joinRoom()} />
                </div>
                <div className="mb-3">
                  <label htmlFor="room" className="form-label">ルーム名</label>
                  <input type="text" className="form-control" id="room" maxLength="15" placeholder="参加したい部屋の名前" onChange={(e) => setRoom(e.target.value)} onKeyPress={(e) => e.key === 'Enter' && joinRoom()} />
                </div>
                <div className="d-grid">
                  <button className="btn btn-primary" onClick={joinRoom}>参加する</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <GameRoom 
          nickname={nickname} 
          room={room} 
          gameState={gameState} 
          myCard={myCard} 
        />
      )}
    </div>
  );
}

export default App;

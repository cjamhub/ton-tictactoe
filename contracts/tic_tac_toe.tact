// Since v1.6.0, Tact has a contract parameters syntax that can supersede
// lazy initialization by init() for all contracts that do not require specific on-chain
// deployment logic that must be run only once in the `init()` function.
//
// Note that the empty parameter list above is still a parameter list,
// meaning that the contract won't have an implicit or explicit `init(){:tact}` function
// and will enjoy storage write optimizations and use less gas overall.
//
// See: https://docs.tact-lang.org/book/contracts/#parameters

import "@stdlib/deploy";

// game status
const GAME_WAITING: Int = 0;
const GAME_ACTIVE: Int = 1;
const GAME_X_WON: Int = 2;
const GAME_O_WON: Int = 3;
const GAME_DRAW: Int = 4;

// piece types
const EMPTY: Int = 0;
const PLAYER_X: Int = 1;
const PLAYER_O: Int = 2;

// win mask (9 bits)
const WIN_ROW_1: Int = 0x1C0;    // 0b111000000 - position 6,7,8
const WIN_ROW_2: Int = 0x38;     // 0b000111000 - position 3,4,5
const WIN_ROW_3: Int = 0x7;      // 0b000000111 - position 0,1,2
const WIN_COL_1: Int = 0x124;    // 0b100100100 - position 2,5,8
const WIN_COL_2: Int = 0x92;     // 0b010010010 - position 1,4,7
const WIN_COL_3: Int = 0x49;     // 0b001001001 - position 0,3,6
const WIN_DIAG_1: Int = 0x111;   // 0b100010001 - position 0,4,8
const WIN_DIAG_2: Int = 0x54;    // 0b001010100 - position 2,4,6

// game messages
message(0x01) JoinGame {
    gameId: Int as uint32;
}

message(0x02) MakeMove {
    gameId: Int as uint32;
    position: Int as uint8;
}

message(0x03) GetGameState {
    gameId: Int as uint32;
    queryId: Int as uint64;
}

message(0x04) ForfeitGame {
    gameId: Int as uint32;
}

// response messages
message(0x11) GameStateResponse {
    queryId: Int as uint64;
    gameId: Int as uint32;
    gameState: Int as uint8;
    playerX: Address?;
    playerO: Address?;
    currentTurn: Int as uint8;
    totalMoves: Int as uint8;
    winner: Address?;
    xBoard: Int as uint16;
    oBoard: Int as uint16;
}

message(0x12) GameCreated {
    gameId: Int as uint32;
    creator: Address;
}

message(0x13) PlayerJoined {
    gameId: Int as uint32;
    player: Address;
}

message(0x14) MoveMade {
    gameId: Int as uint32;
    player: Address;
    position: Int as uint8;
    xBoard: Int as uint16;
    oBoard: Int as uint16;
}

message(0x15) GameEnded {
    gameId: Int as uint32;
    winner: Address?;
    gameState: Int as uint8;
}

// main contract
contract TicTacToe with Deployable {
    nextGameId: Int as uint32;
    
    init() {
        self.nextGameId = 1;
    }
    
    receive(msg: GameCreated) {
        let gameId: Int = self.nextGameId;
        self.nextGameId += 1;
        
        let init: StateInit = initOf GameInstance(gameId, sender());
        let gameAddress: Address = contractAddress(init);
        
        // deploy game instance
        send(SendParameters{
            to: gameAddress,
            value: 0,
            mode: SendRemainingValue,
            bounce: false,
            body: Deploy{queryId: 0}.toCell(),
            code: init.code,
            data: init.data
        });
        
        // send game created message to creator
        send(SendParameters{
            to: sender(),
            value: 0,
            mode: SendRemainingValue + SendIgnoreErrors,
            bounce: false,
            body: GameCreated{gameId: gameId, creator: sender()}.toCell()
        });
    }

    get fun getNextGameId(): Int {
        return self.nextGameId;
    }
    
    get fun getGameAddress(gameId: Int): Address {
        let init: StateInit = initOf GameInstance(gameId, myAddress());
        return contractAddress(init);
    }
}

// game instance contract
contract GameInstance with Deployable {
    gameId: Int as uint32;
    creator: Address;
    gameState: Int as uint8 = GAME_WAITING;
    
    // bitmask board
    xBoard: Int as uint16 = 0;
    oBoard: Int as uint16 = 0;
    
    playerX: Address?;
    playerO: Address?;
    currentTurn: Int as uint8 = PLAYER_X;
    totalMoves: Int as uint8 = 0;
    winner: Address?;
    createdAt: Int as uint32;
    
    init(gameId: Int, creator: Address) {
        self.gameId = gameId;
        self.creator = creator;
        self.playerX = creator;
        self.createdAt = now();
    }
    
    receive(msg: JoinGame) {
        // check game state
        require(self.gameState == GAME_WAITING, "Game not waiting");
        require(self.playerO == null, "Game full");
        require(sender() != self.playerX, "Cannot play yourself");
        
        // set player O
        self.playerO = sender();
        self.gameState = GAME_ACTIVE;
        
        // send player joined message to player
        send(SendParameters{
            to: sender(),
            value: 0,
            mode: SendRemainingValue + SendIgnoreErrors,
            bounce: false,
            body: PlayerJoined{gameId: self.gameId, player: sender()}.toCell()
        });
    }
    
    receive(msg: MakeMove) {
        // check game state
        require(self.gameState == GAME_ACTIVE, "Game not active");
        require(msg.position <= 8, "Invalid position");
        require(self.isPositionEmpty(msg.position), "Position occupied");
        
        // get player
        let player: Address = sender();
        
        // check turn
        if (self.currentTurn == PLAYER_X) {
            require(player == self.playerX, "Not your turn");
            self.xBoard = self.xBoard | (1 << msg.position);
        } else {
            require(player == self.playerO, "Not your turn");
            self.oBoard = self.oBoard | (1 << msg.position);
        }
        
        self.totalMoves += 1;
        
        // check game result
        let winner: Int = self.checkWinner();
        if (winner == PLAYER_X) {
            self.gameState = GAME_X_WON;
            self.winner = self.playerX;
        } else if (winner == PLAYER_O) {
            self.gameState = GAME_O_WON;
            self.winner = self.playerO;
        } else if (self.totalMoves == 9) {
            self.gameState = GAME_DRAW;
        } else {
            self.currentTurn = (self.currentTurn == PLAYER_X) ? PLAYER_O : PLAYER_X;
        }
        
        // send move made message to player
        send(SendParameters{
            to: sender(),
            value: 0,
            mode: SendRemainingValue + SendIgnoreErrors,
            bounce: false,
            body: MoveMade{
                gameId: self.gameId,
                player: player,
                position: msg.position,
                xBoard: self.xBoard,
                oBoard: self.oBoard
            }.toCell()
        });
        
        if (self.gameState != GAME_ACTIVE) {
            self.notifyGameEnd();
        }
    }
    
    receive(msg: ForfeitGame) {
        // check game status
        require(self.gameState == GAME_ACTIVE, "Game not active");
        require(sender() == self.playerX || sender() == self.playerO, "Not a player");
        
        // set game state and winner
        if (sender() == self.playerX) {
            self.gameState = GAME_O_WON;
            self.winner = self.playerO;
        } else {
            self.gameState = GAME_X_WON;
            self.winner = self.playerX;
        }
        
        self.notifyGameEnd();
    }
    
    receive(msg: GetGameState) {
        send(SendParameters{
            to: sender(),
            value: 0,
            mode: SendRemainingValue + SendIgnoreErrors,
            bounce: false,
            body: GameStateResponse{
                queryId: msg.queryId,
                gameId: self.gameId,
                gameState: self.gameState,
                playerX: self.playerX,
                playerO: self.playerO,
                currentTurn: self.currentTurn,
                totalMoves: self.totalMoves,
                winner: self.winner,
                xBoard: self.xBoard,
                oBoard: self.oBoard
            }.toCell()
        });
    }
    
    // internal functions
    fun isPositionEmpty(position: Int): Bool {
        let mask: Int = 1 << position;
        return (self.xBoard & mask) == 0 && (self.oBoard & mask) == 0;
    }
    
    // check winner
    fun checkWinner(): Int {
        // check X wins
        if ((self.xBoard & WIN_ROW_1) == WIN_ROW_1) { return PLAYER_X; }
        if ((self.xBoard & WIN_ROW_2) == WIN_ROW_2) { return PLAYER_X; }
        if ((self.xBoard & WIN_ROW_3) == WIN_ROW_3) { return PLAYER_X; }
        if ((self.xBoard & WIN_COL_1) == WIN_COL_1) { return PLAYER_X; }
        if ((self.xBoard & WIN_COL_2) == WIN_COL_2) { return PLAYER_X; }
        if ((self.xBoard & WIN_COL_3) == WIN_COL_3) { return PLAYER_X; }
        if ((self.xBoard & WIN_DIAG_1) == WIN_DIAG_1) { return PLAYER_X; }
        if ((self.xBoard & WIN_DIAG_2) == WIN_DIAG_2) { return PLAYER_X; }
        
        // check O wins
        if ((self.oBoard & WIN_ROW_1) == WIN_ROW_1) { return PLAYER_O; }
        if ((self.oBoard & WIN_ROW_2) == WIN_ROW_2) { return PLAYER_O; }
        if ((self.oBoard & WIN_ROW_3) == WIN_ROW_3) { return PLAYER_O; }
        if ((self.oBoard & WIN_COL_1) == WIN_COL_1) { return PLAYER_O; }
        if ((self.oBoard & WIN_COL_2) == WIN_COL_2) { return PLAYER_O; }
        if ((self.oBoard & WIN_COL_3) == WIN_COL_3) { return PLAYER_O; }
        if ((self.oBoard & WIN_DIAG_1) == WIN_DIAG_1) { return PLAYER_O; }
        if ((self.oBoard & WIN_DIAG_2) == WIN_DIAG_2) { return PLAYER_O; }
        
        return EMPTY;
    }
    
    // notify game end
    fun notifyGameEnd() {
        send(SendParameters{
            to: self.playerX!!,
            value: 0,
            mode: SendRemainingValue + SendIgnoreErrors,
            bounce: false,
            body: GameEnded{
                gameId: self.gameId,
                winner: self.winner,
                gameState: self.gameState
            }.toCell()
        });
        
        if (self.playerO != null) {
            send(SendParameters{
                to: self.playerO!!,
                value: 0,
                mode: SendRemainingValue + SendIgnoreErrors,
                bounce: false,
                body: GameEnded{
                    gameId: self.gameId,
                    winner: self.winner,
                    gameState: self.gameState
                }.toCell()
            });
        }
    }
    
    // getters
    get fun gameId(): Int { return self.gameId; }
    get fun gameState(): Int { return self.gameState; }
    get fun xBoard(): Int { return self.xBoard; }
    get fun oBoard(): Int { return self.oBoard; }
    get fun playerX(): Address? { return self.playerX; }
    get fun playerO(): Address? { return self.playerO; }
    get fun currentTurn(): Int { return self.currentTurn; }
    get fun totalMoves(): Int { return self.totalMoves; }
    get fun winner(): Address? { return self.winner; }
}
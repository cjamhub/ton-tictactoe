import { Blockchain, SandboxContract, TreasuryContract } from '@ton/sandbox';
import { toNano, Cell, Address } from '@ton/core';
import { TicTacToe } from '../build/TicTacToe/TicTacToe_TicTacToe';
import { GameInstance } from '../build/TicTacToe/TicTacToe_GameInstance';
import '@ton/test-utils';

describe('TicTacToe', () => {
    let blockchain: Blockchain;
    let deployer: SandboxContract<TreasuryContract>;
    let playerX: SandboxContract<TreasuryContract>;
    let playerO: SandboxContract<TreasuryContract>;
    let ticTacToe: SandboxContract<TicTacToe>;

    // create a new blockchain and deploy the tic tac toe contract
    beforeEach(async () => {
        blockchain = await Blockchain.create();
        deployer = await blockchain.treasury('deployer');
        playerX = await blockchain.treasury('playerX');
        playerO = await blockchain.treasury('playerO');

        ticTacToe = blockchain.openContract(await TicTacToe.fromInit());

        const deployResult = await ticTacToe.send(
            deployer.getSender(),
            {
                value: toNano('0.05'),
            },
            {
                $$type: 'Deploy',
                queryId: 0n,
            }
        );

        expect(deployResult.transactions).toHaveTransaction({
            from: deployer.address,
            to: ticTacToe.address,
            deploy: true,
            success: true,
        });
    });

    // test the next game id
    it('should deploy successfully', async () => {
        expect(await ticTacToe.getGetNextGameId()).toBe(1n);
    });

    // test the create game
    it('should create a new game', async () => {
        const result = await ticTacToe.send(
            playerX.getSender(),
            {
                value: toNano('0.02'),
            },
            {
                $$type: 'GameCreated',
                gameId: 1n,
                creator: playerX.address,
            }
        );

        expect(result.transactions).toHaveTransaction({
            from: playerX.address,
            to: ticTacToe.address,
            success: true,
        });

        expect(await ticTacToe.getGetNextGameId()).toBe(2n);
    });

    // test the game instance
    describe('Game Instance', () => {
        let gameInstance: SandboxContract<GameInstance>;
        let gameId: bigint;

        beforeEach(async () => {
            gameId = 1n;
            gameInstance = blockchain.openContract(
                await GameInstance.fromInit(gameId, playerX.address)
            );

            await gameInstance.send(
                deployer.getSender(),
                {
                    value: toNano('0.02'),
                },
                {
                    $$type: 'Deploy',
                    queryId: 0n,
                }
            );
        });

        // check the game instance status
        it('should initialize game correctly', async () => {
            expect(await gameInstance.getGameId()).toBe(gameId);
            expect(await gameInstance.getGameState()).toBe(0n); // GAME_WAITING
            expect(await gameInstance.getXBoard()).toBe(0n);
            expect(await gameInstance.getOBoard()).toBe(0n);
            expect(await gameInstance.getPlayerX()).toEqualAddress(playerX.address);
            expect(await gameInstance.getPlayerO()).toBe(null);
            expect(await gameInstance.getCurrentTurn()).toBe(1n); // PLAYER_X
            expect(await gameInstance.getTotalMoves()).toBe(0n);
        });

        // test the join game
        it('should allow second player to join', async () => {
            const result = await gameInstance.send(
                playerO.getSender(),
                {
                    value: toNano('0.01'),
                },
                {
                    $$type: 'JoinGame',
                    gameId: gameId,
                }
            );

            expect(result.transactions).toHaveTransaction({
                from: playerO.address,
                to: gameInstance.address,
                success: true,
            });

            expect(await gameInstance.getGameState()).toBe(1n); // GAME_ACTIVE
            expect(await gameInstance.getPlayerO()).toEqualAddress(playerO.address);
        });

        // test join game twice
        it('should reject same player joining twice', async () => {
            const result = await gameInstance.send(
                playerX.getSender(),
                {
                    value: toNano('0.01'),
                },
                {
                    $$type: 'JoinGame',
                    gameId: gameId,
                }
            );

            expect(result.transactions).toHaveTransaction({
                from: playerX.address,
                to: gameInstance.address,
                success: false,
            });
        });

        // test normal gameplay process
        describe('Gameplay', () => {
            beforeEach(async () => {
                // playerO joins the game
                await gameInstance.send(
                    playerO.getSender(),
                    {
                        value: toNano('0.01'),
                    },
                    {
                        $$type: 'JoinGame',
                        gameId: gameId,
                    }
                );
            });

            it('should allow valid moves and update bitmasks', async () => {
                // X plays at position 0
                const result = await gameInstance.send(
                    playerX.getSender(),
                    {
                        value: toNano('0.01'),
                    },
                    {
                        $$type: 'MakeMove',
                        gameId: gameId,
                        position: 0n,
                    }
                );

                expect(result.transactions).toHaveTransaction({
                    from: playerX.address,
                    to: gameInstance.address,
                    success: true,
                });

                expect(await gameInstance.getTotalMoves()).toBe(1n);
                expect(await gameInstance.getCurrentTurn()).toBe(2n); // PLAYER_O
                expect(await gameInstance.getXBoard()).toBe(1n); // 1 << 0 = 1
                expect(await gameInstance.getOBoard()).toBe(0n);
            });

            // test multiple moves
            it('should handle multiple moves correctly', async () => {
                // X at position 0: bit 0 = 1
                await gameInstance.send(
                    playerX.getSender(),
                    { value: toNano('0.01') },
                    { $$type: 'MakeMove', gameId: gameId, position: 0n }
                );

                // O at position 4: bit 4 = 16
                await gameInstance.send(
                    playerO.getSender(),
                    { value: toNano('0.01') },
                    { $$type: 'MakeMove', gameId: gameId, position: 4n }
                );

                // X at position 8: bit 8 = 256
                await gameInstance.send(
                    playerX.getSender(),
                    { value: toNano('0.01') },
                    { $$type: 'MakeMove', gameId: gameId, position: 8n }
                );

                expect(await gameInstance.getXBoard()).toBe(257n); // 1 + 256 = 257
                expect(await gameInstance.getOBoard()).toBe(16n);  // 1 << 4 = 16
                expect(await gameInstance.getTotalMoves()).toBe(3n);
            });

            // test reject moves on occupied positions
            it('should reject moves on occupied positions', async () => {
                // X plays at position 0
                await gameInstance.send(
                    playerX.getSender(),
                    { value: toNano('0.01') },
                    { $$type: 'MakeMove', gameId: gameId, position: 0n }
                );

                // O tries to play at the same position
                const result = await gameInstance.send(
                    playerO.getSender(),
                    { value: toNano('0.01') },
                    { $$type: 'MakeMove', gameId: gameId, position: 0n }
                );

                expect(result.transactions).toHaveTransaction({
                    from: playerO.address,
                    to: gameInstance.address,
                    success: false,
                });
            });

            // test reject moves out of turn
            it('should reject moves out of turn', async () => {
                // O tries to move first (should be X's turn)
                const result = await gameInstance.send(
                    playerO.getSender(),
                    { value: toNano('0.01') },
                    { $$type: 'MakeMove', gameId: gameId, position: 0n }
                );

                expect(result.transactions).toHaveTransaction({
                    from: playerO.address,
                    to: gameInstance.address,
                    success: false,
                });
            });

            // test reject invalid positions
            it('should reject invalid positions', async () => {
                const result = await gameInstance.send(
                    playerX.getSender(),
                    { value: toNano('0.01') },
                    { $$type: 'MakeMove', gameId: gameId, position: 9n }
                );

                expect(result.transactions).toHaveTransaction({
                    from: playerX.address,
                    to: gameInstance.address,
                    success: false,
                });
            });

            // test win detection
            describe('Win Detection', () => {
                it('should detect row 1 win (positions 6,7,8)', async () => {
                    // X wins top row: positions 6,7,8 = bits 6,7,8
                    const moves = [
                        { player: playerX, position: 6n }, // X
                        { player: playerO, position: 0n }, // O
                        { player: playerX, position: 7n }, // X
                        { player: playerO, position: 1n }, // O
                        { player: playerX, position: 8n }, // X wins
                    ];

                    for (const move of moves) {
                        await gameInstance.send(
                            move.player.getSender(),
                            { value: toNano('0.01') },
                            { $$type: 'MakeMove', gameId: gameId, position: move.position }
                        );
                    }

                    expect(await gameInstance.getGameState()).toBe(2n); // GAME_X_WON
                    expect(await gameInstance.getWinner()).toEqualAddress(playerX.address);
                    // X board should have bits 6,7,8 set: 64 + 128 + 256 = 448
                    expect(await gameInstance.getXBoard()).toBe(448n);
                });

                it('should detect row 2 win (positions 3,4,5)', async () => {
                    // O wins middle row: positions 3,4,5
                    const moves = [
                        { player: playerX, position: 0n }, // X
                        { player: playerO, position: 3n }, // O
                        { player: playerX, position: 1n }, // X
                        { player: playerO, position: 4n }, // O
                        { player: playerX, position: 6n }, // X
                        { player: playerO, position: 5n }, // O wins
                    ];

                    for (const move of moves) {
                        await gameInstance.send(
                            move.player.getSender(),
                            { value: toNano('0.01') },
                            { $$type: 'MakeMove', gameId: gameId, position: move.position }
                        );
                    }

                    expect(await gameInstance.getGameState()).toBe(3n); // GAME_O_WON
                    expect(await gameInstance.getWinner()).toEqualAddress(playerO.address);
                    // O board should have bits 3,4,5 set: 8 + 16 + 32 = 56
                    expect(await gameInstance.getOBoard()).toBe(56n);
                });

                it('should detect row 3 win (positions 0,1,2)', async () => {
                    // X wins bottom row: positions 0,1,2
                    const moves = [
                        { player: playerX, position: 0n }, // X
                        { player: playerO, position: 3n }, // O
                        { player: playerX, position: 1n }, // X
                        { player: playerO, position: 4n }, // O
                        { player: playerX, position: 2n }, // X wins
                    ];

                    for (const move of moves) {
                        await gameInstance.send(
                            move.player.getSender(),
                            { value: toNano('0.01') },
                            { $$type: 'MakeMove', gameId: gameId, position: move.position }
                        );
                    }

                    expect(await gameInstance.getGameState()).toBe(2n); // GAME_X_WON
                    // X board should have bits 0,1,2 set: 1 + 2 + 4 = 7
                    expect(await gameInstance.getXBoard()).toBe(7n);
                });

                it('should detect column 1 win (positions 0,3,6)', async () => {
                    // O wins left column: positions 0,3,6
                    const moves = [
                        { player: playerX, position: 1n }, // X
                        { player: playerO, position: 0n }, // O
                        { player: playerX, position: 2n }, // X
                        { player: playerO, position: 3n }, // O
                        { player: playerX, position: 4n }, // X
                        { player: playerO, position: 6n }, // O wins
                    ];

                    for (const move of moves) {
                        await gameInstance.send(
                            move.player.getSender(),
                            { value: toNano('0.01') },
                            { $$type: 'MakeMove', gameId: gameId, position: move.position }
                        );
                    }

                    expect(await gameInstance.getGameState()).toBe(3n); // GAME_O_WON
                    // O board should have bits 0,3,6 set: 1 + 8 + 64 = 73
                    expect(await gameInstance.getOBoard()).toBe(73n);
                });

                it('should detect main diagonal win (positions 0,4,8)', async () => {
                    // X wins main diagonal: positions 0,4,8
                    const moves = [
                        { player: playerX, position: 0n }, // X
                        { player: playerO, position: 1n }, // O
                        { player: playerX, position: 4n }, // X
                        { player: playerO, position: 2n }, // O
                        { player: playerX, position: 8n }, // X wins
                    ];

                    for (const move of moves) {
                        await gameInstance.send(
                            move.player.getSender(),
                            { value: toNano('0.01') },
                            { $$type: 'MakeMove', gameId: gameId, position: move.position }
                        );
                    }

                    expect(await gameInstance.getGameState()).toBe(2n); // GAME_X_WON
                    // X board should have bits 0,4,8 set: 1 + 16 + 256 = 273
                    expect(await gameInstance.getXBoard()).toBe(273n);
                });

                it('should detect anti-diagonal win (positions 2,4,6)', async () => {
                    // O wins anti-diagonal: positions 2,4,6
                    const moves = [
                        { player: playerX, position: 0n }, // X
                        { player: playerO, position: 2n }, // O
                        { player: playerX, position: 1n }, // X
                        { player: playerO, position: 4n }, // O
                        { player: playerX, position: 3n }, // X
                        { player: playerO, position: 6n }, // O wins
                    ];

                    for (const move of moves) {
                        await gameInstance.send(
                            move.player.getSender(),
                            { value: toNano('0.01') },
                            { $$type: 'MakeMove', gameId: gameId, position: move.position }
                        );
                    }

                    expect(await gameInstance.getGameState()).toBe(3n); // GAME_O_WON
                    // O board should have bits 2,4,6 set: 4 + 16 + 64 = 84
                    expect(await gameInstance.getOBoard()).toBe(84n);
                });
            });

            // test detect draw
            it('should detect draw', async () => {
                // Create a draw scenario
                const moves = [
                    { player: playerX, position: 0n }, // X
                    { player: playerO, position: 1n }, // O
                    { player: playerX, position: 2n }, // X
                    { player: playerO, position: 4n }, // O
                    { player: playerX, position: 3n }, // X
                    { player: playerO, position: 5n }, // O
                    { player: playerX, position: 7n }, // X
                    { player: playerO, position: 6n }, // O
                    { player: playerX, position: 8n }, // X - draw
                ];

                for (const move of moves) {
                    await gameInstance.send(
                        move.player.getSender(),
                        { value: toNano('0.01') },
                        { $$type: 'MakeMove', gameId: gameId, position: move.position }
                    );
                }

                expect(await gameInstance.getGameState()).toBe(4n); // GAME_DRAW
                expect(await gameInstance.getWinner()).toBe(null);
                expect(await gameInstance.getTotalMoves()).toBe(9n);
            });

            // test forfeit game
            it('should handle forfeit correctly', async () => {
                // X forfeits
                const result = await gameInstance.send(
                    playerX.getSender(),
                    { value: toNano('0.01') },
                    { $$type: 'ForfeitGame', gameId: gameId }
                );

                expect(result.transactions).toHaveTransaction({
                    from: playerX.address,
                    to: gameInstance.address,
                    success: true,
                });

                expect(await gameInstance.getGameState()).toBe(3n); // GAME_O_WON
                expect(await gameInstance.getWinner()).toEqualAddress(playerO.address);
            });

            it('should not allow moves after game ends', async () => {
                // Let X win first
                const moves = [
                    { player: playerX, position: 0n },
                    { player: playerO, position: 3n },
                    { player: playerX, position: 1n },
                    { player: playerO, position: 4n },
                    { player: playerX, position: 2n }, // X wins
                ];

                for (const move of moves) {
                    await gameInstance.send(
                        move.player.getSender(),
                        { value: toNano('0.01') },
                        { $$type: 'MakeMove', gameId: gameId, position: move.position }
                    );
                }

                // Try to make another move
                const result = await gameInstance.send(
                    playerO.getSender(),
                    { value: toNano('0.01') },
                    { $$type: 'MakeMove', gameId: gameId, position: 5n }
                );

                expect(result.transactions).toHaveTransaction({
                    from: playerO.address,
                    to: gameInstance.address,
                    success: false,
                });
            });

            // test response to game state queries
            it('should respond to game state queries', async () => {
                // Make a move
                await gameInstance.send(
                    playerX.getSender(),
                    { value: toNano('0.01') },
                    { $$type: 'MakeMove', gameId: gameId, position: 0n }
                );

                // Query game state
                const queryResult = await gameInstance.send(
                    playerX.getSender(),
                    { value: toNano('0.01') },
                    { $$type: 'GetGameState', gameId: gameId, queryId: 12345n }
                );

                expect(queryResult.transactions).toHaveTransaction({
                    from: playerX.address,
                    to: gameInstance.address,
                    success: true,
                });
            });
        });

        // test reject third player joining
        it('should reject third player joining', async () => {
            const thirdPlayer = await blockchain.treasury('thirdPlayer');

            // PlayerO joins first
            await gameInstance.send(
                playerO.getSender(),
                { value: toNano('0.01') },
                { $$type: 'JoinGame', gameId: gameId }
            );

            // Third player tries to join
            const result = await gameInstance.send(
                thirdPlayer.getSender(),
                { value: toNano('0.01') },
                { $$type: 'JoinGame', gameId: gameId }
            );

            expect(result.transactions).toHaveTransaction({
                from: thirdPlayer.address,
                to: gameInstance.address,
                success: false,
            });
        });
    });
});
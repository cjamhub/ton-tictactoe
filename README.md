# ton-tictactoe

## Project structure

-   `contracts` - source code of all the smart contracts of the project and their dependencies.
-   `wrappers` - wrapper classes (implementing `Contract` from ton-core) for the contracts, including any [de]serialization primitives and compilation functions.
-   `tests` - tests for the contracts.
-   `scripts` - scripts used by the project, mainly the deployment scripts.

## How to use

### Build

`npx blueprint build` or `yarn blueprint build`

### Test

`npx blueprint test` or `yarn blueprint test`

### Deploy or run another script

`npx blueprint run` or `yarn blueprint run`

### Add a new contract

`npx blueprint create ContractName` or `yarn blueprint create ContractName`


# TicTacToe Contract

## Core Function
1. Create Game
2. Join Game
3. Make Move
4. Query Sate
5. Forfeit Game

## Key Features
1. Bitmask Board
2. Win Detection
3. Game Status

# Unit Test
1. Contract Deployment Tests
2. Game Creation Tests
3. Game Joining Tests
4. Move Making Tests
5. Win Detection Tests
6. Draw Game Tests
7. Error Handling Tests
8. State Query Tests
9. Forfeit Tests
import { toNano } from '@ton/core';
import { TicTacToe } from '../build/TicTacToe/TicTacToe_TicTacToe';
import { NetworkProvider } from '@ton/blueprint';

export async function run(provider: NetworkProvider) {
    const ticTacToe = provider.open(await TicTacToe.fromInit());

    await ticTacToe.send(
        provider.sender(),
        {
            value: toNano('0.05'),
        },
        {
            $$type: 'Deploy',
            queryId: 0n,
        },
    );

    await provider.waitForDeploy(ticTacToe.address);

    // run methods on `ticTacToe`
}
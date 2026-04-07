import { describe, expect, it } from 'vitest'
import { EvmChainId } from '../chain/index.js'
import { WNATIVE_ADDRESS } from '../config/tokens/index.js'
import { getQuote } from './quote.js'
import { getSwap, type SwapRequest } from './swap.js'
import { QuoteAmountSide } from './types.js'

const baseSwapRequest = {
  chainId: EvmChainId.ETHEREUM,
  tokenIn: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
  tokenOut: '0x6b3595068778dd592e39a122f4f5a5cf09c90fe2',
  amount: 100000000000000000n,
  maxSlippage: 0.005,
  sender: WNATIVE_ADDRESS[EvmChainId.ETHEREUM],
} as const satisfies SwapRequest

describe('getSwap', () => {
  it('should return a swap when recipient is included', async () => {
    const result = await getSwap({
      ...baseSwapRequest,
      recipient: WNATIVE_ADDRESS[EvmChainId.ETHEREUM],
    })

    expect(result).include({ status: 'Success' })
    if (result.status === 'Success') {
      expect(result.tx.gasPrice).toBeGreaterThan(0)
    }
  })

  it('should include a swap with tx.gas when simulate is true', async () => {
    const result = await getSwap({
      ...baseSwapRequest,
      simulate: true,
    })

    expect(result).include({ status: 'Success' })
    if (result.status === 'Success') {
      expect(result.tx).include.keys('gas')
    }
  })

  it(
    'should return a swap when amountSide is exact-out',
    async () => {
      const ref = await getQuote({
        chainId: baseSwapRequest.chainId,
        tokenIn: baseSwapRequest.tokenIn,
        tokenOut: baseSwapRequest.tokenOut,
        amount: baseSwapRequest.amount,
        maxSlippage: baseSwapRequest.maxSlippage,
      })
      expect(['Success', 'Partial']).toContain(ref.status)
      if (ref.status === 'NoWay') {
        return
      }
      const targetOut = BigInt(ref.assumedAmountOut)
      const result = await getSwap({
        ...baseSwapRequest,
        amount: targetOut,
        amountSide: QuoteAmountSide.To,
      })
      expect(result).include({ status: 'Success' })
      if (result.status === 'Success') {
        expect(BigInt(result.amountIn)).toBeGreaterThan(0n)
      }
    },
    60_000,
  )

  it.skip('should return a swap when url is set to staging', async () => {
    const result = await getSwap({
      ...baseSwapRequest,
      baseUrl: 'https://staging.sushi.com',
    })

    expect(result).include({ status: 'Success' })
  })
})

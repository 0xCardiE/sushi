import { describe, expect, it } from 'vitest'
import { getQuote, type QuoteRequest } from './quote.js'
import { QuoteAmountSide } from './types.js'

const baseQuoteRequest = {
  chainId: 1,
  tokenIn: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
  tokenOut: '0x6b3595068778dd592e39a122f4f5a5cf09c90fe2',
  amount: 1000000000000000000n,
  maxSlippage: 0.005,
} as const satisfies QuoteRequest

describe('getQuote', () => {
  it('should return a quote', async () => {
    const result = await getQuote(baseQuoteRequest)

    expect(result).include({ status: 'Success' })
  })

  it('should return a quote with visualize when true', async () => {
    const result = await getQuote({
      ...baseQuoteRequest,
      visualize: true,
    })

    expect(result).include({ status: 'Success' })
    if (result.status === 'Success') {
      expect(result.visualization).include.keys([
        'liquidityProviders',
        'nodes',
        'links',
      ])
    }
  })

  it(
    'should resolve amountSide "to" to a quote that delivers at least the target out',
    async () => {
      const ref = await getQuote(baseQuoteRequest)
      expect(['Success', 'Partial']).toContain(ref.status)
      if (ref.status === 'NoWay') {
        return
      }
      const targetOut = BigInt(ref.assumedAmountOut)
      const result = await getQuote({
        ...baseQuoteRequest,
        amount: targetOut,
        amountSide: QuoteAmountSide.To,
      })
      expect(['Success', 'Partial']).toContain(result.status)
      if (result.status !== 'NoWay') {
        expect(BigInt(result.assumedAmountOut)).toBeGreaterThanOrEqual(targetOut)
        expect(BigInt(result.amountIn)).toBeGreaterThan(0n)
      }
    },
    60_000,
  )

  it.skip('should return a quote when url is set to staging', async () => {
    const result = await getQuote({
      ...baseQuoteRequest,
      baseUrl: 'https://staging.sushi.com',
    })
    expect(result).include({ status: 'Success' })
  })
})

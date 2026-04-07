import type { Address } from 'viem'
import * as z from 'zod'
import { version } from '../../version.js'
import type { SwapApiSupportedChainId } from '../config/index.js'
import { szevm } from '../validate/zod.js'
import { QuoteAmountSide, RouteStatus, type TransferValue } from './types.js'

export type QuoteRequest<Vizualize extends boolean = false> = {
  chainId: SwapApiSupportedChainId
  tokenIn: Address
  tokenOut: Address
  amount: bigint
  maxSlippage: number
  maxPriceImpact?: number
  fee?: bigint
  feeReceiver?: Address
  feeBy?: TransferValue
  referrer?: string
  visualize?: Vizualize
  baseUrl?: string
  /**
   * `from` (default): `amount` is the exact token-in amount (current API behaviour).
   * `to`: `amount` is the desired token-out amount; the SDK resolves the required token-in amount via iterative quotes (slower, multiple HTTP calls).
   */
  amountSide?: QuoteAmountSide
}

function quoteResponseSchema<Visualize extends boolean>(visualize?: Visualize) {
  const tokenSchema = z.object({
    address: szevm.address(),
    decimals: z.number(),
    symbol: z.string(),
    name: z.string(),
  })

  const baseSuccessPartial = z
    .object({
      status: z.literal(RouteStatus.Success).or(z.literal(RouteStatus.Partial)),
      tokens: z.array(tokenSchema),
      tokenFrom: z.number(),
      tokenTo: z.number(),

      swapPrice: z.number(),
      priceImpact: z.number(),

      amountIn: z.string(),
      assumedAmountOut: z.string(),
    })
    .transform((data) => ({
      ...data,
      tokenFrom: data.tokens[data.tokenFrom]!,
      tokenTo: data.tokens[data.tokenTo]!,
    }))

  const baseNoWay = z.object({
    status: z.literal(RouteStatus.NoWay),
  })

  const baseSchema = baseSuccessPartial.or(baseNoWay)

  const baseVisualizeSchema = baseSchema
    .and(
      z.object({
        visualization: z.object({
          liquidityProviders: z.array(z.string()),
          nodes: z.array(tokenSchema),
          links: z.array(
            z.object({
              source: z.number(),
              target: z.number(),
              liquidityProvider: z.number(),
              amountIn: z.string(),
              amountOut: z.string(),
              value: z.number(),
            }),
          ),
        }),
      }),
    )
    .or(baseNoWay)

  type Schema = Visualize extends true
    ? typeof baseVisualizeSchema
    : typeof baseSchema

  return (visualize ? baseVisualizeSchema : baseSchema) as Schema
}

export type QuoteResponse<Visualize extends boolean = false> = z.infer<
  ReturnType<typeof quoteResponseSchema<Visualize>>
>

/** Shared optional fields for `getQuote` / exact-out resolution (`exactOptionalPropertyTypes`-safe). */
export function quoteRequestSharedFields(
  params: Pick<
    QuoteRequest,
    | 'chainId'
    | 'tokenIn'
    | 'tokenOut'
    | 'maxSlippage'
    | 'maxPriceImpact'
    | 'fee'
    | 'feeReceiver'
    | 'feeBy'
    | 'referrer'
    | 'baseUrl'
  >,
) {
  return {
    chainId: params.chainId,
    tokenIn: params.tokenIn,
    tokenOut: params.tokenOut,
    maxSlippage: params.maxSlippage,
    ...(params.maxPriceImpact !== undefined
      ? { maxPriceImpact: params.maxPriceImpact }
      : {}),
    ...(typeof params.fee === 'bigint' &&
    params.fee > 0n &&
    params.feeReceiver !== undefined
      ? { fee: params.fee, feeReceiver: params.feeReceiver }
      : {}),
    ...(params.feeBy !== undefined ? { feeBy: params.feeBy } : {}),
    ...(params.referrer !== undefined ? { referrer: params.referrer } : {}),
    ...(params.baseUrl !== undefined ? { baseUrl: params.baseUrl } : {}),
  }
}

async function requestQuote<Visualize extends boolean>(
  params: QuoteRequest<Visualize>,
  options?: RequestInit,
): Promise<QuoteResponse<Visualize>> {
  const url = new URL(
    `quote/v7/${params.chainId}`,
    params.baseUrl ?? 'https://api.sushi.com',
  )

  url.searchParams.append('tokenIn', params.tokenIn)
  url.searchParams.append('tokenOut', params.tokenOut)
  url.searchParams.append('amount', params.amount.toString())
  url.searchParams.append('maxSlippage', params.maxSlippage.toString())

  if (params.maxPriceImpact) {
    url.searchParams.append('maxPriceImpact', params.maxPriceImpact.toString())
  }

  if (
    typeof params.fee === 'bigint' &&
    params.fee > 0n &&
    params.feeReceiver !== undefined
  ) {
    url.searchParams.append('fee', params.fee.toString())
    url.searchParams.append('feeReceiver', params.feeReceiver)
    if (params.feeBy !== undefined) {
      url.searchParams.append('feeBy', params.feeBy)
    }
  }

  if (params?.visualize) {
    url.searchParams.append('visualize', params.visualize.toString())
  }

  if (params.referrer) {
    url.searchParams.append('referrer', params.referrer)
  } else {
    url.searchParams.append('referrer', `sushi-sdk/${version}`)
  }

  const res = await fetch(url.toString(), options)

  if (!res.ok) {
    throw new Error(`Failed to fetch quote: ${await res.text()}`)
  }

  return quoteResponseSchema(params.visualize).parse(
    await res.json(),
  ) as QuoteResponse<Visualize>
}

const MAX_EXACT_OUT_INPUT = 2n ** 200n
const MAX_EXACT_OUT_BRACKET_STEPS = 96

function quoteAssumedOut(response: QuoteResponse<boolean>): bigint | undefined {
  if (response.status === RouteStatus.NoWay) {
    return undefined
  }
  return BigInt(response.assumedAmountOut)
}

async function quoteExactOut<Visualize extends boolean>(
  params: QuoteRequest<Visualize>,
  options?: RequestInit,
): Promise<QuoteResponse<Visualize>> {
  const targetOut = params.amount
  if (targetOut <= 0n) {
    throw new Error('amount must be positive when amountSide is "to"')
  }

  const searchBase = quoteRequestSharedFields(params)

  let high = 1n
  let foundUpper = false
  for (let step = 0; step < MAX_EXACT_OUT_BRACKET_STEPS; step++) {
    if (high > MAX_EXACT_OUT_INPUT) {
      break
    }
    const res = await requestQuote(
      { ...searchBase, amount: high } as QuoteRequest<false>,
      options,
    )
    const out = quoteAssumedOut(res)
    if (out !== undefined && out >= targetOut) {
      foundUpper = true
      break
    }
    high *= 2n
  }

  if (!foundUpper) {
    throw new Error(
      'Could not satisfy exact-out quote: increase liquidity or lower target amount',
    )
  }

  let lo = 1n
  let hi = high
  while (lo < hi) {
    const mid = (lo + hi) / 2n
    const res = await requestQuote(
      { ...searchBase, amount: mid } as QuoteRequest<false>,
      options,
    )
    const out = quoteAssumedOut(res)
    if (out === undefined || out < targetOut) {
      lo = mid + 1n
    } else {
      hi = mid
    }
  }

  return requestQuote(
    {
      ...quoteRequestSharedFields(params),
      amount: lo,
      ...(params.visualize === true ? { visualize: true } : {}),
    } as QuoteRequest<Visualize>,
    options,
  )
}

export async function getQuote<Visualize extends boolean = false>(
  params: QuoteRequest<Visualize>,
  options?: RequestInit,
): Promise<QuoteResponse<Visualize>> {
  // TODO: VALIDATE PARAMS
  if (params.amountSide === QuoteAmountSide.To) {
    return quoteExactOut(params, options)
  }
  return requestQuote(params, options)
}

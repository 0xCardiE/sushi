export enum RouteStatus {
  Success = 'Success',
  NoWay = 'NoWay',
  Partial = 'Partial',
}

export enum TransferValue {
  Input = 'input',
  Output = 'output',
}

export enum RouterLiquiditySource {
  Sender = 'sender', // msg.sender
  Self = 'self',
}

/** Whether `amount` on quote/swap requests is spent (token in) or desired received (token out). */
export enum QuoteAmountSide {
  From = 'from',
  To = 'to',
}

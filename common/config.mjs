import path from 'node:path';

export function config(name, defaultPort) {
  return {
    port: Number(process.env.PORT || defaultPort),
    host: process.env.HOST || '127.0.0.1',
    dbPath: process.env.DB_PATH || path.resolve('data', `${name}.sqlite`),
    orderUrl: process.env.ORDER_URL || 'http://127.0.0.1:3101',
    queryUrl: process.env.QUERY_URL || 'http://127.0.0.1:3102',
    driverUrl: process.env.DRIVER_URL || 'http://127.0.0.1:3103',
    dispatchUrl: process.env.DISPATCH_URL || 'http://127.0.0.1:3104',
    pricingUrl: process.env.PRICING_URL || 'http://127.0.0.1:3105',
    internalToken: process.env.INTERNAL_TOKEN || 'lab3-local-internal',
  };
}

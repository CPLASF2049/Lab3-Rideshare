import { AppError } from './errors.mjs';

const states = new Set(['MATCHING', 'ASSIGNING', 'ACCEPTED', 'ARRIVED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'FAILED']);
const types = new Set(['order.created.v1', 'order.changed.v1']);
const validId = value => typeof value === 'string' && value.trim().length > 0 && value.length <= 200;
const validTime = value => typeof value === 'string' && Number.isFinite(Date.parse(value));

// Both consumers validate before writing an inbox row so corrected events remain retryable.
export function validateOrderEvent(event) {
  const order = event?.data;
  if (!validId(event?.event_id) || !validId(event?.aggregate_id) || !types.has(event?.event_type)
      || !Number.isSafeInteger(event?.version) || event.version < 1 || !validTime(event?.occurred_at)
      || !order || typeof order !== 'object' || Array.isArray(order)
      || order.id !== event.aggregate_id || order.version !== event.version
      || !validId(order.rider_id) || !states.has(order.status) || !validTime(order.created_at)
      || (order.driver_id != null && !validId(order.driver_id))
      || (order.pending_driver_id != null && !validId(order.pending_driver_id))) {
    throw new AppError(400, 'INVALID_EVENT', '订单事件类型、标识、时间或快照格式不正确');
  }
}

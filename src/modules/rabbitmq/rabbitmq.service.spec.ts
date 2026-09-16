import { EventEmitter } from 'node:events';
import { RabbitMQService } from './rabbitmq.service';

function setup() {
  const channel = Object.assign(new EventEmitter(), {
    assertQueue: jest.fn().mockResolvedValue(undefined),
    sendToQueue: jest.fn(),
  });
  const service = new RabbitMQService({} as never);
  Object.defineProperty(service, 'channel', { value: channel });
  return { service, channel };
}
function confirm(
  channel: ReturnType<typeof setup>['channel'],
  error: Error | null = null,
) {
  const callback = (channel.sendToQueue.mock.calls[0] as unknown[])[3] as (
    e: Error | null,
  ) => void;
  callback(error);
}
describe('RabbitMQ publisher confirms của Auth', () => {
  it('chờ confirm dù sendToQueue trả false do backpressure', async () => {
    const { service, channel } = setup();
    channel.sendToQueue.mockReturnValue(false);
    let completed = false;
    const publish = service
      .publish('user-profile-sync', { action: 'CREATE' }, 'req')
      .then(() => {
        completed = true;
      });
    await new Promise((resolve) => setImmediate(resolve));
    expect(completed).toBe(false);
    expect(channel.sendToQueue).toHaveBeenCalledWith(
      'user-profile-sync',
      expect.any(Buffer),
      expect.objectContaining({ persistent: true, mandatory: true }),
      expect.any(Function),
    );
    confirm(channel);
    await publish;
    expect(completed).toBe(true);
    expect(channel.listenerCount('return')).toBe(0);
  });
  it('broker nack thì publish thất bại để relay retry', async () => {
    const { service, channel } = setup();
    const publish = service.publish('user-profile-sync', {});
    const expected = expect(publish).rejects.toThrow('Broker nack');
    await new Promise((resolve) => setImmediate(resolve));
    confirm(channel, new Error('Broker nack'));
    await expected;
  });
  it('message không route được thì không coi confirm là gửi thành công', async () => {
    const { service, channel } = setup();
    const publish = service.publish('user-profile-sync', {});
    const expected = expect(publish).rejects.toThrow('not routed');
    await new Promise((resolve) => setImmediate(resolve));
    const options = (channel.sendToQueue.mock.calls[0] as unknown[])[2] as {
      messageId: string;
    };
    channel.emit('return', { properties: { messageId: options.messageId } });
    confirm(channel);
    await expected;
  });
  it('broker chưa kết nối thì báo lỗi ngay', async () => {
    await expect(
      new RabbitMQService({} as never).publish('send-otp', {}),
    ).rejects.toThrow('not initialized');
  });
});

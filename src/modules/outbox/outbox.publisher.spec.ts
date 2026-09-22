import { OutboxPublisher } from './outbox.publisher';

describe('Auth outbox relay', () => {
  function setup() {
    const event = {
      eventId: 'event-1',
      payload: { action: 'CREATE' },
      attempts: 2,
      requestId: 'req',
    };
    const model = {
      findOneAndUpdate: jest
        .fn()
        .mockReturnValueOnce({ exec: jest.fn().mockResolvedValue(event) })
        .mockReturnValue({ exec: jest.fn().mockResolvedValue(null) }),
      updateOne: jest
        .fn()
        .mockReturnValue({ exec: jest.fn().mockResolvedValue({}) }),
    };
    const rabbit = {
      isReady: jest.fn().mockReturnValue(true),
      publish: jest.fn().mockResolvedValue(undefined),
    };
    const publisher = new OutboxPublisher(
      model as never,
      rabbit as never,
      { get: jest.fn() } as never,
    );
    return { publisher, model, rabbit };
  }
  it('chỉ đánh dấu published sau khi broker confirm', async () => {
    const { publisher, model, rabbit } = setup();
    let confirm!: () => void;
    rabbit.publish.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          confirm = resolve;
        }),
    );
    const flush = publisher.flush();
    await new Promise((resolve) => setImmediate(resolve));
    expect(model.updateOne).not.toHaveBeenCalled();
    confirm();
    await flush;
    expect(model.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: 'event-1',
        leaseToken: expect.any(String) as string,
      }),
      {
        $set: {
          publishedAt: expect.any(Date) as Date,
          leaseToken: null,
          lastError: null,
        },
      },
    );
  });
  it('giữ record pending và backoff khi publish thất bại', async () => {
    const { publisher, model, rabbit } = setup();
    rabbit.publish.mockRejectedValue(new Error('Broker down'));
    await publisher.flush();
    expect(model.updateOne).toHaveBeenCalledWith(expect.anything(), {
      $set: {
        leaseToken: null,
        nextAttemptAt: expect.any(Date) as Date,
        lastError: 'Error',
      },
    });
  });
  it('không claim khi broker chưa sẵn sàng', async () => {
    const { publisher, model, rabbit } = setup();
    rabbit.isReady.mockReturnValue(false);
    await publisher.flush();
    expect(model.findOneAndUpdate).not.toHaveBeenCalled();
  });
  it('không chạy hai batch cùng lúc trong một worker', async () => {
    const { publisher, model, rabbit } = setup();
    let confirm!: () => void;
    rabbit.publish.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          confirm = resolve;
        }),
    );
    const first = publisher.flush();
    await new Promise((resolve) => setImmediate(resolve));
    await publisher.flush();
    expect(model.findOneAndUpdate).toHaveBeenCalledTimes(1);
    confirm();
    await first;
  });
});

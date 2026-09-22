import { randomUUID } from 'node:crypto';
import { createConnection, Connection, Model } from 'mongoose';
import { AuthService } from '../auth/auth.service';
import {
  Credential,
  CredentialDocument,
  CredentialSchema,
} from '../../schemas/credential.schema';
import {
  OutboxEvent,
  OutboxEventDocument,
  OutboxEventSchema,
} from '../../schemas/outbox-event.schema';
import { OutboxService } from './outbox.service';

const integration = process.env.OUTBOX_TEST_MONGO_URL
  ? describe
  : describe.skip;
integration('Auth outbox với MongoDB replica set thật', () => {
  let connection: Connection;
  let credentials: Model<CredentialDocument>;
  let events: Model<OutboxEventDocument>;
  let outbox: OutboxService;
  let auth: AuthService;
  const redis = { del: jest.fn().mockResolvedValue(undefined) };
  beforeAll(async () => {
    connection = await createConnection(process.env.OUTBOX_TEST_MONGO_URL!, {
      dbName: `auth_outbox_test_${randomUUID().replaceAll('-', '')}`,
    }).asPromise();
    credentials = connection.model<CredentialDocument>(
      Credential.name,
      CredentialSchema,
    );
    events = connection.model<OutboxEventDocument>(
      OutboxEvent.name,
      OutboxEventSchema,
    );
    await credentials.init();
    outbox = new OutboxService(events);
    await outbox.onModuleInit();
    auth = new AuthService(
      credentials,
      {} as never,
      redis as never,
      {} as never,
      {} as never,
      outbox,
    );
  }, 30000);
  afterEach(() => jest.restoreAllMocks());
  afterAll(async () => {
    if (connection) {
      await connection.dropDatabase();
      await connection.close();
    }
  });
  it('rollback credential khi insert outbox lỗi', async () => {
    jest
      .spyOn(outbox, 'enqueue')
      .mockRejectedValueOnce(new Error('Injected failure'));
    await expect(
      auth.register(
        {
          email: 'rollback@example.com',
          username: 'Rollback',
          password: 'password123',
        },
        'req',
      ),
    ).rejects.toThrow('Injected failure');
    expect(
      await credentials.countDocuments({ email: 'rollback@example.com' }),
    ).toBe(0);
    expect(await events.countDocuments()).toBe(0);
  });
  it('tạo credential + CREATE cùng commit và tăng version khi cập nhật đồng thời', async () => {
    const result = await auth.register(
      { email: 'ok@example.com', username: 'Name', password: 'password123' },
      'req',
    );
    const userId = String(result.userId);
    await Promise.all([
      auth.updateUserRole(userId, 'user', 'req-2'),
      auth.updateUserRole(userId, 'admin', 'req-3'),
    ]);
    const stored = await events
      .find({ aggregateId: userId })
      .sort({ 'payload.version': 1 })
      .lean();
    expect(stored.map((e) => e.payload.version)).toEqual([1, 2, 3]);
    expect(stored.every((e) => e.publishedAt === null)).toBe(true);
    const credential = await credentials.findById(userId).lean();
    expect(credential?.syncVersion).toBe(3);
    expect(stored[2].payload.role).toBe(credential?.role);
    expect(stored[0].payload).not.toHaveProperty('passwordHash');
  });
  it('rollback đổi role nếu không lưu được sự kiện', async () => {
    const credential = await credentials
      .findOne({ email: 'ok@example.com' })
      .lean();
    jest
      .spyOn(outbox, 'enqueue')
      .mockRejectedValueOnce(new Error('Injected failure'));
    await expect(
      auth.updateUserRole(String(credential!._id), 'admin', 'req'),
    ).rejects.toThrow('Injected failure');
    const after = await credentials.findById(credential!._id).lean();
    expect(after?.role).toBe(credential?.role);
    expect(after?.syncVersion).toBe(3);
  });
  it('DELETE đã commit trước lỗi Redis và còn event để relay gửi lại', async () => {
    const credential = await credentials
      .findOne({ email: 'ok@example.com' })
      .lean();
    redis.del.mockRejectedValueOnce(new Error('Redis down'));
    await expect(
      auth.deleteUserByAdmin(String(credential!._id), 'req'),
    ).rejects.toThrow('Redis down');
    expect(await credentials.findById(credential!._id)).toBeNull();
    const event = await events.findOne({ 'payload.action': 'DELETE' }).lean();
    expect(event?.payload.version).toBe(4);
    expect(event?.publishedAt).toBeNull();
  });
});

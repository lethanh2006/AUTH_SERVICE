import axios from 'axios';
import { AuthService } from './auth.service';

describe('Auth ghi outbox chung transaction', () => {
  const userId = '507f1f77bcf86cd799439011';
  const cred = {
    _id: userId,
    email: 'test@example.com',
    role: 'user',
    syncVersion: 3,
    syncUsername: 'Tên ban đầu',
  };
  const payload = Buffer.from(
    JSON.stringify({ _id: userId, role: 'user' }),
  ).toString('base64');
  function setup() {
    const session = { transaction: true };
    const model = {
      db: {
        transaction: jest.fn((fn: (s: unknown) => Promise<unknown>) =>
          fn(session),
        ),
      },
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue([{ ...cred, syncVersion: 1 }]),
      findByIdAndUpdate: jest.fn().mockResolvedValue(cred),
      findByIdAndDelete: jest.fn().mockResolvedValue(cred),
    };
    const outbox = { enqueue: jest.fn().mockResolvedValue(undefined) };
    const rabbit = {
      publish: jest.fn().mockRejectedValue(new Error('RabbitMQ down')),
    };
    const redis = {
      set: jest.fn().mockResolvedValue(undefined),
      del: jest.fn().mockResolvedValue(undefined),
    };
    const service = new AuthService(
      model as never,
      { sign: jest.fn().mockReturnValue('token') } as never,
      redis as never,
      rabbit as never,
      { get: jest.fn().mockReturnValue('http://user.test') } as never,
      outbox as never,
    );
    return { service, model, outbox, rabbit, redis, session };
  }
  afterEach(() => jest.restoreAllMocks());

  it('đăng ký vẫn thành công khi broker hỏng và không publish trong request', async () => {
    const { service, model, outbox, rabbit, session } = setup();
    await service.register(
      { email: cred.email, password: 'password123', username: 'Tên ban đầu' },
      'req',
    );
    expect(model.create).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          syncVersion: 1,
          syncUsername: 'Tên ban đầu',
        }),
      ],
      { session },
    );
    expect(outbox.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'CREATE',
        userId,
        version: 1,
        email: cred.email,
        username: 'Tên ban đầu',
      }),
      session,
      'req',
    );
    expect(rabbit.publish).not.toHaveBeenCalled();
  });

  it.each(['role', 'email', 'self-delete', 'admin-delete'])(
    'lưu sự kiện %s cùng session với credential',
    async (operation) => {
      const { service, model, outbox, rabbit, session } = setup();
      if (operation === 'role')
        await service.updateUserRole(userId, 'VIP', 'req');
      if (operation === 'email')
        await service.updateMyEmail(payload, 'new@example.com', 'req');
      if (operation === 'self-delete')
        await service.deleteMyAccount(payload, 'req');
      if (operation === 'admin-delete')
        await service.deleteUserByAdmin(userId, 'req');
      const deleting = operation.includes('delete');
      expect(outbox.enqueue).toHaveBeenCalledWith(
        expect.objectContaining({
          userId,
          version: deleting ? 4 : 3,
          action: deleting
            ? 'DELETE'
            : operation === 'role'
              ? 'UPDATE_ROLE'
              : 'UPDATE_EMAIL',
        }),
        session,
        'req',
      );
      if (deleting)
        expect(model.findByIdAndDelete).toHaveBeenCalledWith(userId, {
          session,
        });
      else
        expect(model.findByIdAndUpdate).toHaveBeenCalledWith(
          userId,
          expect.objectContaining({ $inc: { syncVersion: 1 } }),
          expect.objectContaining({ session }),
        );
      expect(rabbit.publish).not.toHaveBeenCalled();
    },
  );

  it('không trả thành công nếu ghi outbox thất bại', async () => {
    const { service, outbox } = setup();
    outbox.enqueue.mockRejectedValue(new Error('DB failed'));
    await expect(
      service.register(
        { email: cred.email, password: 'password123', username: 'Name' },
        'req',
      ),
    ).rejects.toThrow('DB failed');
  });

  it('xóa tài khoản vẫn lưu DELETE trước khi Redis thất bại', async () => {
    const { service, outbox, redis } = setup();
    redis.del.mockRejectedValue(new Error('Redis down'));
    await expect(service.deleteUserByAdmin(userId, 'req')).rejects.toThrow(
      'Redis down',
    );
    expect(outbox.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'DELETE' }),
      expect.anything(),
      'req',
    );
  });

  it('tài khoản Google mới cũng lưu CREATE vào outbox', async () => {
    jest
      .spyOn(axios, 'get')
      .mockResolvedValueOnce({
        data: { email: cred.email, name: 'Google Name' },
      })
      .mockRejectedValueOnce(new Error('Profile not synced yet'));
    const { service, outbox, rabbit } = setup();
    await service.loginWithGoogle('google-token', 'req');
    expect(outbox.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'CREATE', version: 1 }),
      expect.anything(),
      'req',
    );
    expect(rabbit.publish).not.toHaveBeenCalled();
  });
});

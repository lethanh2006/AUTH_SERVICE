import { AuthService } from './auth.service';

describe('Auth introspection concurrent reads', () => {
  const userId = '507f1f77bcf86cd799439011';
  const original = {
    _id: userId,
    email: 'user@example.com',
    role: 'user',
    syncVersion: 1,
  };

  function setup(cacheTtlMs = 0) {
    let credential: typeof original | null = { ...original };
    const lean = jest.fn(() => Promise.resolve(credential));
    const select = jest.fn().mockReturnValue({ lean });
    const model = {
      findById: jest.fn().mockReturnValue({ select }),
      findByIdAndUpdate: jest.fn(
        (_id: string, update: { $set: Partial<typeof original> }) => {
          credential = { ...original, ...update.$set };
          return Promise.resolve(credential);
        },
      ),
      findByIdAndDelete: jest.fn(() => {
        const previous = credential;
        credential = null;
        return Promise.resolve(previous);
      }),
      db: {
        transaction: jest.fn(
          (callback: (session: object) => Promise<unknown>) => callback({}),
        ),
      },
    };
    const jwt = {
      verify: jest.fn((token: string) => {
        if (token === 'expired') throw new Error('jwt expired');
        return {
          tokenType: 'access',
          user: { _id: userId, username: token, role: 'admin' },
        };
      }),
    };
    const service = new AuthService(
      model as never,
      jwt as never,
      { del: jest.fn().mockResolvedValue(undefined) } as never,
      {} as never,
      { get: jest.fn().mockReturnValue(cacheTtlMs) } as never,
      { enqueue: jest.fn().mockResolvedValue(undefined) } as never,
    );
    return { service, model, jwt, lean, select };
  }

  it('verifies every token, coalesces DB reads, and preserves each token username', async () => {
    const { service, model, jwt, select } = setup();
    const result = await Promise.all([
      service.validateToken('name-1'),
      service.validateToken('name-2'),
    ]);
    expect(jwt.verify).toHaveBeenCalledTimes(2);
    expect(model.findById).toHaveBeenCalledTimes(1);
    expect(select).toHaveBeenCalledWith({ _id: 1, email: 1, role: 1 });
    expect(result.map((value) => value.user?.username)).toEqual([
      'name-1',
      'name-2',
    ]);
    expect(result.map((value) => value.user?.role)).toEqual(['user', 'user']);
    await service.validateToken('name-3');
    expect(model.findById).toHaveBeenCalledTimes(2);
  });

  it('rejects an expired token even while a valid token read is pending', async () => {
    const { service, lean, model } = setup();
    let resolve!: (value: typeof original) => void;
    lean.mockReturnValueOnce(
      new Promise((accept) => {
        resolve = accept;
      }),
    );
    const valid = service.validateToken('valid');
    await expect(service.validateToken('expired')).resolves.toEqual({
      valid: false,
      message: 'jwt expired',
    });
    expect(model.findById).toHaveBeenCalledTimes(1);
    resolve(original);
    expect((await valid).valid).toBe(true);
  });

  it('a role change fences off a pending old credential read', async () => {
    const { service, lean, model } = setup();
    let resolve!: (value: typeof original) => void;
    lean.mockReturnValueOnce(
      new Promise((accept) => {
        resolve = accept;
      }),
    );
    const oldRead = service.validateToken('old');
    await Promise.resolve();
    await service.updateUserRole(userId, 'admin', 'request-id');
    const fresh = await service.validateToken('fresh');
    expect(fresh.user?.role).toBe('admin');
    expect(model.findById).toHaveBeenCalledTimes(2);
    resolve(original);
    await oldRead;
    expect((await service.validateToken('after')).user?.role).toBe('admin');
  });

  it('serves repeated reads from short cache but invalidates it after role change', async () => {
    const { service, model } = setup(2000);
    expect((await service.validateToken('one')).user?.role).toBe('user');
    expect((await service.validateToken('two')).user?.role).toBe('user');
    expect(model.findById).toHaveBeenCalledTimes(1);
    await service.updateUserRole(userId, 'admin', 'request-id');
    expect((await service.validateToken('three')).user?.role).toBe('admin');
    expect(model.findById).toHaveBeenCalledTimes(2);
  });

  it('invalidates a cached identity after deletion', async () => {
    const { service, model } = setup(2000);
    expect((await service.validateToken('one')).valid).toBe(true);
    await service.deleteUserByAdmin(userId, 'request-id');
    expect((await service.validateToken('two')).valid).toBe(false);
    expect(model.findById).toHaveBeenCalledTimes(2);
  });

  it('account deletion fences off a pending read and immediately rejects new requests', async () => {
    const { service, lean } = setup();
    let resolve!: (value: typeof original) => void;
    lean.mockReturnValueOnce(
      new Promise((accept) => {
        resolve = accept;
      }),
    );
    const oldRead = service.validateToken('old');
    await Promise.resolve();
    await service.deleteUserByAdmin(userId, 'request-id');
    expect(await service.validateToken('new')).toEqual({
      valid: false,
      message: 'Tài khoản không còn tồn tại',
    });
    resolve(original);
    await oldRead;
    expect((await service.validateToken('after')).valid).toBe(false);
  });
});

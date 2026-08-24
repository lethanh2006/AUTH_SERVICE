import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AppRole } from '../../../common/enums/app-role.enum';
import { UpdateUserRoleDto } from './update-user-role.dto';

describe('UpdateUserRoleDto', () => {
  it.each(Object.values(AppRole))('chấp nhận vai trò %s', async (role) => {
    const dto = plainToInstance(UpdateUserRoleDto, { role });

    await expect(validate(dto)).resolves.toHaveLength(0);
  });

  it('chuẩn hóa vai trò trước khi kiểm tra', async () => {
    const dto = plainToInstance(UpdateUserRoleDto, { role: '  CHEF ' });

    await expect(validate(dto)).resolves.toHaveLength(0);
    expect(dto.role).toBe(AppRole.CHEF);
  });

  it('từ chối vai trò ngoài hợp đồng', async () => {
    const dto = plainToInstance(UpdateUserRoleDto, { role: 'owner' });

    await expect(validate(dto)).resolves.toHaveLength(1);
  });
});

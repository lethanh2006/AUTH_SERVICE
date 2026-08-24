import { Transform } from 'class-transformer';
import { IsEnum } from 'class-validator';
import { AppRole } from '../../../common/enums/app-role.enum';

export class UpdateUserRoleDto {
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEnum(AppRole, { message: 'Vai trò không hợp lệ' })
  role!: AppRole;
}

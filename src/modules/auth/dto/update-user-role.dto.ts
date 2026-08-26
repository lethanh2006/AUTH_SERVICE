import { Transform, type TransformFnParams } from 'class-transformer';
import { IsEnum } from 'class-validator';
import { AppRole } from '../../../common/enums/app-role.enum';

export class UpdateUserRoleDto {
  @Transform(({ value }: TransformFnParams): unknown => {
    const role: unknown = value;
    return typeof role === 'string' ? role.trim().toLowerCase() : role;
  })
  @IsEnum(AppRole, { message: 'Vai trò không hợp lệ' })
  role!: AppRole;
}

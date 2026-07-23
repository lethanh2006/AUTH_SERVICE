import { IsEmail, IsNotEmpty, MinLength } from 'class-validator';

export class RegisterDto {
    @IsEmail({}, { message: 'Email không đúng định dạng' })
    email: string;

    @IsNotEmpty({ message: 'Mật khẩu không được để trống' })
    @MinLength(6, { message: 'Mật khẩu phải chứa ít nhất 6 ký tự' })
    password: string;

    @IsNotEmpty({ message: 'Tên người dùng không được để trống' })
    username: string;
}

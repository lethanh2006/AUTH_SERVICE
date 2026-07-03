import { IsEmail, IsNotEmpty, Length } from 'class-validator';

export class VerifyOtpDto {
    @IsEmail({}, { message: 'Email không đúng định dạng' })
    email: string;

    @IsNotEmpty({ message: 'Mã OTP không được để trống' })
    @Length(6, 6, { message: 'Mã OTP phải có đúng 6 ký số' })
    otp: string;
}

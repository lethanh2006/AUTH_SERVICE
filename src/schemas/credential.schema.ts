import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { APP_ROLES, AppRole } from '../common/enums/app-role.enum';

export type CredentialDocument = Credential & Document;

@Schema({ timestamps: true })
export class Credential {
    @Prop({ required: true, unique: true, trim: true })
    email!: string;

    @Prop({ required: true })
    passwordHash!: string;

    @Prop({ required: true, default: AppRole.USER, enum: APP_ROLES })
    role!: string;
}

export const CredentialSchema = SchemaFactory.createForClass(Credential);

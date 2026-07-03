import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type CredentialDocument = Credential & Document;

@Schema({ timestamps: true })
export class Credential {
    @Prop({ required: true, unique: true, trim: true })
    email: string;

    @Prop({ required: true })
    passwordHash: string;

    @Prop({ required: true, default: 'user' })
    role: string;
}

export const CredentialSchema = SchemaFactory.createForClass(Credential);

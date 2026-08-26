import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfigModule, ConfigService } from '@nestjs/config';

@Module({
  imports: [
    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        uri:
          configService.get<string>('MONGO_URL') ||
          'mongodb://localhost:27017/chatapp',
        dbName: configService.get<string>('MONGO_DB_NAME') || 'nrapp',
      }),
      inject: [ConfigService],
    }),
  ],
})
export class DatabaseModule {}

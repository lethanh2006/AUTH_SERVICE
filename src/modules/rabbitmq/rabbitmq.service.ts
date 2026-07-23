import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as amqp from 'amqplib';

@Injectable()
export class RabbitMQService implements OnModuleInit, OnModuleDestroy {
    private connection: amqp.ChannelModel;
    private channel: amqp.Channel;
    private readonly logger = new Logger(RabbitMQService.name);

    constructor(private configService: ConfigService) { }

    async onModuleInit() {
        try {
            const host = this.configService.get<string>('Rabbitmq_Host') || 'localhost';
            const username = this.configService.get<string>('Rabbitmq_Username') || 'guest';
            const password = this.configService.get<string>('Rabbitmq_Password') || 'guest';

            this.connection = await amqp.connect({
                protocol: 'amqp',
                hostname: host,
                port: 5672,
                username: username,
                password: password,
            });
            this.channel = await this.connection.createChannel();
            this.logger.log('Connected to RabbitMQ successfully');
        } catch (error) {
            this.logger.error('Failed to connect to RabbitMQ:', error);
        }
    }

    async publish(queueName: string, message: any): Promise<void> {
        if (!this.channel) {
            throw new Error('RabbitMQ Channel is not initialized');
        }
        await this.channel.assertQueue(queueName, { durable: true });
        this.channel.sendToQueue(
            queueName,
            Buffer.from(JSON.stringify(message)),
            { persistent: true }
        );
        this.logger.log(`Published message to queue ${queueName}`);
    }

    async onModuleDestroy() {
        await this.channel?.close();
        await this.connection?.close();
    }
}

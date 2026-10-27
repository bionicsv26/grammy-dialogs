// src/logger.ts
import winston from 'winston';
import 'winston-daily-rotate-file'; // ✅ Обязательный импорт плагина ротации
import fs from 'fs';
import path from 'path';

const logDir = 'logs';
if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir);
}

// 📁 Транспорт для общих логов с ежедневной ротацией
const dailyRotateTransport = new winston.transports.DailyRotateFile({
    filename: path.join(logDir, 'application-%DATE%.log'),
    datePattern: 'YYYY-MM-DD',
    zippedArchive: true,      // Архивировать старые файлы в .gz
    maxSize: '10m',           // Максимальный размер одного файла перед ротацией
    maxFiles: '14d',          // Хранить логи за последние 14 дней
});

// 📁 Транспорт для ошибок с отдельной ротацией и долгим хранением
const dailyRotateErrorTransport = new winston.transports.DailyRotateFile({
    filename: path.join(logDir, 'error-%DATE%.log'),
    datePattern: 'YYYY-MM-DD',
    zippedArchive: true,
    maxSize: '10m',
    maxFiles: '30d',          // Ошибки храним 30 дней
    level: 'error',
});

export const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
        winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        winston.format.errors({ stack: true }),
        winston.format.json()
    ),
    defaultMeta: { service: 'telegram-dialog-bot' },
    transports: [
        dailyRotateTransport,
        dailyRotateErrorTransport,
    ],
});

// Вывод в консоль для разработки
if (process.env.NODE_ENV !== 'production') {
    logger.add(
        new winston.transports.Console({
            format: winston.format.combine(
                winston.format.colorize(),
                winston.format.printf(({ timestamp, level, message, ...meta }) => {
                    const metaStr = Object.keys(meta).length ? ` | ${JSON.stringify(meta)}` : '';
                    return `[${timestamp}] [${level}]: ${message}${metaStr}`;
                })
            ),
        })
    );
}